#!/usr/bin/env python3
"""Check data/nodes.json for structural errors.

Run from the repo root:  python3 tools/validate.py
Exits non-zero if anything is wrong, so it can run in CI.
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

EDGE_TYPES = {"inherits", "merges", "convergent"}
STATUSES = {"active", "dormant", "revived"}

data = json.loads((Path(__file__).resolve().parent.parent / "data" / "nodes.json").read_text())
errors = []

clades = {c["id"] for c in data["clades"]}
nodes = {}
for n in data["nodes"]:
    for key in ("id", "name", "year", "clade", "description"):
        if key not in n:
            errors.append(f"node {n.get('id', '?')}: missing '{key}'")
    if n["id"] in nodes:
        errors.append(f"duplicate node id: {n['id']}")
    nodes[n["id"]] = n
    if n.get("clade") not in clades:
        errors.append(f"node {n['id']}: unknown clade '{n.get('clade')}'")
    if n.get("status", "active") not in STATUSES:
        errors.append(f"node {n['id']}: unknown status '{n['status']}'")

for n in data["nodes"]:
    for p in n.get("papers", []):
        for key in ("title", "authors", "year", "url"):
            if key not in p:
                errors.append(f"node {n['id']}: paper missing '{key}'")
        if not str(p.get("url", "")).startswith("https://"):
            errors.append(f"node {n['id']}: paper url must be https: {p.get('url')}")

descent = defaultdict(list)  # target -> [(source, type)]
seen = set()
for e in data["edges"]:
    s, t, typ = e["source"], e["target"], e["type"]
    for end in (s, t):
        if end not in nodes:
            errors.append(f"edge {s} -> {t}: unknown node '{end}'")
    if typ not in EDGE_TYPES:
        errors.append(f"edge {s} -> {t}: unknown type '{typ}'")
    if (s, t) in seen:
        errors.append(f"duplicate edge {s} -> {t}")
    seen.add((s, t))
    if s in nodes and t in nodes and typ != "convergent":
        if nodes[s]["year"] > nodes[t]["year"]:
            errors.append(f"edge {s} -> {t}: parent is younger than child")
        descent[t].append((s, typ))

# A node with several parents is a hybrid: its edges should say "merges".
# A node with one parent should say "inherits".
for t, parents in descent.items():
    want = "merges" if len(parents) > 1 else "inherits"
    for s, typ in parents:
        if typ != want:
            errors.append(f"edge {s} -> {t}: is '{typ}', expected '{want}' ({len(parents)} parent(s))")

# Descent edges must form a DAG.
state = {}
def visit(v, path):
    state[v] = 1
    for s, _ in descent.get(v, []):
        if state.get(s) == 1:
            errors.append("cycle: " + " <- ".join(path + [s]))
        elif s not in state:
            visit(s, path + [s])
    state[v] = 2
for v in nodes:
    if v not in state:
        visit(v, [v])

for e in errors:
    print("ERROR:", e)
types = Counter(e["type"] for e in data["edges"])
print(f"{len(nodes)} nodes, {len(data['edges'])} edges ({dict(types)}), {len(errors)} error(s)")
sys.exit(1 if errors else 0)
