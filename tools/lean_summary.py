"""Turn a Lean source file into a short, human-readable summary.

Lean files carry their own English: a module docstring (/-! # Title ... -/)
that usually describes the file and often lists its main results, and
docstrings (/-- ... -/) on individual definitions and theorems. This module
pulls those out so the site can describe a project without showing code.

Summary shape (keys kept short because there are thousands of these):
  p  path            t  title                 s  summary paragraph
  i  internal imports (paths)                 l  line count
  n  [theorems, definitions, instances]       h  highlights: [{k, n, d}]
"""
import re

DECL = re.compile(
    r"^(?:@\[[^\]]*\]\s*)*(?:(?:private|protected|noncomputable|nonrec|partial|unsafe|scoped|public)\s+)*"
    r"(theorem|lemma|def|abbrev|instance|structure|class|inductive|opaque|axiom)\b\s*([^\s:({\[⦃]*)")
KIND = {"theorem": "theorem", "lemma": "theorem", "instance": "instance"}
IMPORT = re.compile(r"^(?:public\s+|meta\s+)*import\s+(\S+)", re.M)
MODULE_DOC = re.compile(r"/-!(.*?)-/", re.S)
MAIN_HEADING = re.compile(r"^#+\s*(main (results?|statements?|theorems?|definitions?)|results)\s*$", re.I)


def clean(text, limit):
    """Collapse whitespace, drop Markdown link targets, and trim to a sentence boundary."""
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    stop = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "))
    return (cut[:stop + 1] if stop > limit * 0.5 else cut.rsplit(" ", 1)[0] + "…")


def humanize(path):
    stem = path.rsplit("/", 1)[-1].removesuffix(".lean")
    stem = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", stem).replace("_", " ")
    return stem[:1].upper() + stem[1:]


def module_doc(text):
    """Title, first paragraph, and any 'Main results' bullets from the first module docstring."""
    m = MODULE_DOC.search(text)
    if not m:
        return None, "", []
    lines = m.group(1).strip("\n").splitlines()
    title = None
    body, mains, in_main = [], [], False
    for line in lines:
        s = line.strip()
        h = re.match(r"^#\s+(.*)", s)
        if h and title is None:
            title = h.group(1).strip()
            continue
        if MAIN_HEADING.match(s):
            in_main = True
            continue
        if s.startswith("#"):
            in_main = False
            if body:
                body.append("\n")  # a new section ends the opening paragraph
            continue
        if in_main:
            b = re.match(r"^[*\-+]\s+(.*)", s)
            if b:
                mains.append(b.group(1))
            elif s and mains:
                mains[-1] += " " + s
        else:
            body.append(s if s else "\n")
    para = " ".join(body).strip().split("\n")[0]
    highlights = []
    for item in mains[:8]:
        # Typical bullet: `Foo.bar`: description   or   `Foo.bar` : description
        nm = re.match(r"^`([^`]+)`\s*[:：\-–—]?\s*(.*)", item)
        name, desc = (nm.group(1), nm.group(2)) if nm else ("", item)
        if desc or name:
            highlights.append({"k": "result", "n": name, "d": clean(desc or item, 220)})
    return title, clean(para, 380), highlights


def summarize(path, text, project_modules):
    """project_modules maps a module name (Foo.Bar) to its path (Foo/Bar.lean) within the project."""
    title, para, mains = module_doc(text)
    lines = text.splitlines()
    counts = {"theorem": 0, "def": 0, "instance": 0}
    decls = []
    doc, doc_open = None, None
    for line in lines:
        s = line.strip()
        if doc_open is not None:
            doc_open.append(line)
            if "-/" in line:
                doc = " ".join(doc_open).split("-/")[0]
                doc_open = None
            continue
        if s.startswith("/--"):
            first = s[3:]
            if "-/" in first:
                doc = first.split("-/")[0]
            else:
                doc_open = [first]
            continue
        if line[:1].isspace() or not s:
            if not s:
                continue
        m = DECL.match(s) if not line[:1].isspace() else None
        if m:
            kind = KIND.get(m.group(1), "def")
            counts[kind] += 1
            decls.append({"k": kind, "n": m.group(2), "d": clean(doc or "", 220)})
            doc = None
        elif not s.startswith("@["):
            doc = None

    # Prefer the file's own "Main results" list; otherwise its documented theorems,
    # newest (last) first since files usually build up to their main statements.
    highlights = mains[:6]
    if len(highlights) < 6:
        named_main = [d for d in decls if re.search(r"(^|[._])main", d["n"], re.I) and (d["d"] or d["k"] == "theorem")]
        documented = [d for d in reversed(decls) if d["d"] and d["k"] == "theorem"]
        documented_defs = [d for d in decls if d["d"] and d["k"] == "def"]
        seen = {h["n"] for h in highlights}
        for d in named_main + documented + documented_defs:
            if d["n"] and d["n"] not in seen and len(highlights) < 6:
                highlights.append(d)
                seen.add(d["n"])
    # Nothing documented: name the file's last theorems, which are usually its point.
    if not highlights:
        highlights = [d for d in reversed(decls) if d["k"] == "theorem" and d["n"]][:2]

    imports = []
    for mod in IMPORT.findall(text):
        target = project_modules.get(mod)
        if target and target != path:
            imports.append(target)

    return {
        "p": path,
        "t": title or humanize(path),
        "s": para,
        "i": sorted(set(imports)),
        "l": len(lines),
        "n": [counts["theorem"], counts["def"], counts["instance"]],
        "h": highlights,
    }


def module_name(path):
    return path.removesuffix(".lean").replace("/", ".")
