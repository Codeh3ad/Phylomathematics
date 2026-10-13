#!/usr/bin/env python3
"""Stamp index.html's stylesheet and script URLs with a version so browsers
fetch the new files after a deploy instead of serving cached copies.

Run before committing changes to css/ or js/:  python3 tools/bump_version.py
"""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
html = ROOT / "index.html"
text = html.read_text()
for path in ("css/style.css", "js/viewer.js", "js/app.js"):
    digest = hashlib.sha256((ROOT / path).read_bytes()).hexdigest()[:8]
    text = re.sub(re.escape(path) + r'(\?v=[^"]*)?"', f'{path}?v={digest}"', text)
html.write_text(text)
print("stamped", ", ".join(re.findall(r'(?:css/style\.css|js/viewer\.js|js/app\.js)\?v=\w+', text)))
