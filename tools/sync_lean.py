#!/usr/bin/env python3
"""Pull live Lean formalization data into data/lean.json.

Reads data/lean-map.json (which mathlib folders and which external Lean
projects belong to each field), then:

  * clones mathlib4 without file contents and with only recent history,
  * counts mathlib files per field and lists recent additions touching them
    (commits labelled "feat", i.e. new definitions and theorems; chores,
    refactors, fixes and docs are left out),
  * flags changes whose commit message credits an AI tool,
  * records the latest commit of each external project.

Everything in Lean's mathlib and in these projects is machine-checked by
Lean's kernel. The AI flag only says the commit message credits an AI tool.

Run from the repo root:  python3 tools/sync_lean.py
Needs git and network access to github.com. The scheduled GitHub Action
.github/workflows/sync-lean.yml runs it daily and commits the result.
"""
import datetime as dt
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WINDOW_DAYS = 60
RECENT_PER_FIELD = 5
FEED_SIZE = 60
MATHLIB = "https://github.com/leanprover-community/mathlib4"

# Words in a commit message that credit an AI system. Case-sensitive "AI"/"LLM",
# case-insensitive product names. "Gauss" is left out: Gauss sums are everywhere.
AI_PATTERNS = [
    re.compile(r"\b(AI|LLMs?)\b"),
    re.compile(r"\b(claude|chatgpt|gpt-[0-9o]|openai|gemini|alphaproof|alphageometry|aristotle|"
               r"deepseek|copilot|kimina|goedel-prover|seed-prover|autoformali[sz](?:ed|ation))\b", re.I),
]


def git(*args, cwd=None):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


def credits_ai(text):
    return any(p.search(text) for p in AI_PATTERNS)


# mathlib commit titles follow "type(scope): text (#PR)".
TITLE = re.compile(r"^(?P<type>[a-z]+)(?:\((?P<scope>[^)]*)\))?!?:\s*(?P<text>.*?)\s*(?:\(#\d+\))?\s*$")


def parse_title(subject):
    m = TITLE.match(subject.strip())
    if not m:
        return None, None, subject.strip()
    text = m.group("text")
    return m.group("type"), m.group("scope"), text[:1].upper() + text[1:]


def pr_url(subject, sha):
    m = re.search(r"\(#(\d+)\)\s*$", subject)
    return f"{MATHLIB}/pull/{m.group(1)}" if m else f"{MATHLIB}/commit/{sha}"


def under(path, prefix):
    return path.startswith(prefix + "/") or path == prefix + ".lean"


def sync_mathlib(lean_map, workdir):
    since = (dt.date.today() - dt.timedelta(days=WINDOW_DAYS + 1)).isoformat()
    repo = workdir / "mathlib4"
    git("clone", "--quiet", "--filter=blob:none", "--no-checkout", f"--shallow-since={since}", MATHLIB, str(repo))
    head = git("log", "-1", "--format=%H%x1f%cs", cwd=repo).strip().split("\x1f")
    files = [f for f in git("ls-tree", "-r", "--name-only", "HEAD", "--", "Mathlib", cwd=repo).splitlines()
             if f.endswith(".lean")]

    log = git("log", f"--since={WINDOW_DAYS}.days", "--format=%x1e%H%x1f%cs%x1f%s%x1f%b%x1d",
              "--name-only", "--", "Mathlib", cwd=repo)
    commits = []
    for chunk in log.split("\x1e")[1:]:
        meta, _, paths = chunk.partition("\x1d")
        sha, date, subject, body = meta.split("\x1f", 3)
        kind, scope, text = parse_title(subject)
        commits.append({
            "sha": sha, "date": date, "kind": kind, "scope": scope, "title": text,
            "url": pr_url(subject.strip(), sha),
            "ai": credits_ai(subject + "\n" + body),
            "paths": [p for p in paths.split("\n") if p.endswith(".lean")],
        })

    total_changes = len(commits)
    # Only new mathematics: drop chores, refactors, fixes, docs, style and CI work.
    commits = [c for c in commits if c["kind"] == "feat"]
    keys = ("date", "title", "scope", "url", "ai")

    fields = {}
    for fid, prefixes in lean_map["mathlib"].items():
        n_files = sum(1 for f in files if any(under(f, p) for p in prefixes))
        touching = [c for c in commits if any(under(p, q) for p in c["paths"] for q in prefixes)]
        fields[fid] = {
            "prefixes": prefixes,
            "files": n_files,
            "additions": len(touching),
            "ai_additions": sum(c["ai"] for c in touching),
            "recent": [{k: c[k] for k in keys} for c in touching[:RECENT_PER_FIELD]],
        }

    feed = []
    for c in commits:
        ids = [fid for fid, prefixes in lean_map["mathlib"].items()
               if any(under(p, q) for p in c["paths"] for q in prefixes)]
        if ids:
            feed.append({**{k: c[k] for k in keys}, "fields": ids})
    ai_feed = [c for c in feed if c["ai"]]
    # Keep every AI-credited change in the window, topped up with the newest of the rest.
    keep = {id(c) for c in ai_feed} | {id(c) for c in feed[:FEED_SIZE]}
    feed = [c for c in feed if id(c) in keep]

    mathlib = {"commit": head[0], "date": head[1], "files": len(files), "changes": total_changes,
               "additions": len(commits), "ai_additions": sum(c["ai"] for c in commits)}
    return mathlib, fields, feed


def sync_projects(lean_map, workdir):
    out = []
    for p in lean_map["projects"]:
        entry = {k: p[k] for k in ("name", "repo", "fields", "kind", "description")}
        entry["url"] = f"https://github.com/{p['repo']}"
        dest = workdir / p["repo"].replace("/", "__")
        try:
            git("clone", "--quiet", "--depth=1", "--filter=blob:none", "--no-checkout", entry["url"], str(dest))
            sha, date, subject = git("log", "-1", "--format=%H%x1f%cs%x1f%s", cwd=dest).strip().split("\x1f", 2)
            entry["updated"] = date
            entry["latest"] = {"title": subject, "url": f"{entry['url']}/commit/{sha}"}
        except subprocess.CalledProcessError as e:
            print(f"warning: could not read {p['repo']}: {e.stderr.strip()}", file=sys.stderr)
        out.append(entry)
    return out


def main():
    lean_map = json.loads((ROOT / "data" / "lean-map.json").read_text())
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        mathlib, fields, feed = sync_mathlib(lean_map, tmp)
        projects = sync_projects(lean_map, tmp)
    data = {
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "window_days": WINDOW_DAYS,
        "mathlib": mathlib,
        "fields": fields,
        "feed": feed,
        "projects": projects,
    }
    (ROOT / "data" / "lean.json").write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    print(f"mathlib {mathlib['commit'][:10]} ({mathlib['date']}): {mathlib['files']} files, "
          f"{mathlib['additions']} additions of {mathlib['changes']} changes in {WINDOW_DAYS} days, "
          f"{mathlib['ai_additions']} credit AI; "
          f"{len(feed)} feed items; {sum('updated' in p for p in projects)}/{len(projects)} projects read")


if __name__ == "__main__":
    main()
