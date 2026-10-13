/* Lean project explorer: a high-level, plain-English tour of formalized mathematics.
 *
 * No code is shown. A project is presented as a handful of topics (its main
 * areas), drawn as bubbles sized by how much each proves and placed to the
 * right of the topics they build on, like fields on the main map. Each topic
 * is described with the English its authors wrote: what it covers and its key
 * results. The Lean source is reachable through one link, never displayed.
 *
 *   ProofViewer.openOverview({ title, eyebrow, description, url, link })  // precomputed summaries
 *   ProofViewer.openChange({ title, files, ref, repo, link, scope })      // a single change, read live
 */
(() => {
  "use strict";

  const MATHLIB = "leanprover-community/mathlib4";
  const RAW = (repo) => `https://raw.githubusercontent.com/${repo}`;
  const PALETTE = ["#0369a1", "#15803d", "#7c3aed", "#c2410c", "#be185d", "#0d9488", "#a16207", "#475569", "#65a30d", "#b91c1c"];

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Plain reading text: drop code marks, Markdown and TeX delimiters, keep the words and the math symbols.
  const plain = (s) => String(s || "")
    .replace(/`+([^`]*)`+/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|\s)\*([^*]+)\*/g, "$1$2")
    .replace(/\$\$?([^$]+)\$\$?/g, "$1").replace(/\\mathbb\{([RCNZQ])\}/g, (m, l) => ({ R: "ℝ", C: "ℂ", N: "ℕ", Z: "ℤ", Q: "ℚ" }[l])).replace(/\\(mathbb|mathrm|mathcal|operatorname)\{([^}]*)\}/g, "$2")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
  const plainMath = (s) => untex(plain(s));
  // Common TeX commands authors use in docstrings, as the symbols a reader expects.
  const TEX = {
    C: "ℂ", R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", to: "→", mapsto: "↦", in: "∈", notin: "∉", sum: "∑", prod: "∏", int: "∫",
    leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", infty: "∞", cdot: "·", times: "×", emptyset: "∅",
    subseteq: "⊆", subset: "⊂", cup: "∪", cap: "∩", forall: "∀", exists: "∃", approx: "≈", sim: "∼", pm: "±",
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ",
    lambda: "λ", mu: "μ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
    Gamma: "Γ", Delta: "Δ", Lambda: "Λ", Sigma: "Σ", Phi: "Φ", Omega: "Ω", log: "log", exp: "exp", Re: "Re", Im: "Im",
    left: "", right: "", quad: " ", qquad: " ",
  };
  const untex = (s) => s.replace(/\\([A-Za-z]+)/g, (m, w) => (w in TEX ? TEX[w] : w))
    .replace(/_\{([^}]*)\}/g, "$1").replace(/\^\{([^}]*)\}/g, "^$1").replace(/[{}]/g, "").replace(/(\w)_ /g, "$1 ");
  const text = (s) => esc(plain(s));
  const firstSentence = (s) => { const t = untex(plain(s)); const m = /^(.{40,}?[.!?])\s/.exec(t + " "); return m ? m[1] : t; };
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : darkQuery.matches);
  const tone = (c) => (isDark() ? d3.color(c).brighter(0.9).formatHex() : c);
  // "KnownIn1980s" -> "Known in 1980s", "ErdosProblems" -> "Erdos problems"
  const humanize = (s) => {
    const words = s.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/([0-9])([A-Z][a-z])/g, "$1 $2").trim().split(/\s+/);
    return words.map((w, i) => (i === 0 || /^[A-Z0-9]{2,}/.test(w) ? w : w.toLowerCase())).join(" ");
  };
  // Folders of supporting material (upstreaming, scratch, utilities) matter less to a reader.
  const HELPER = /^(mathlib|for ?mathlib|slop|util|utils|aux|auxiliary|lemmas|misc|basic|test|tests|blueprint|imports|attrs|tactic|tactics|meta|to ?mathlib|upstream|main files|data|definitions|defs|instances|notation)$/i;
  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
  const fileTitle = (f) => plain(f.t) || humanize(f.p.split("/").pop().replace(/\.lean$/, ""));

  // ---- Live summaries for a single change (same shape as tools/lean_summary.py) ----
  const DECL = /^(?:@\[[^\]]*\]\s*)*(?:(?:private|protected|noncomputable|nonrec|partial|unsafe|scoped|public)\s+)*(theorem|lemma|def|abbrev|instance|structure|class|inductive|opaque|axiom)\b\s*([^\s:({[⦃]*)/;
  const clip = (t, n) => { t = t.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n).replace(/\s\S*$/, "") + "…" : t; };
  function summarize(path, src) {
    const m = /\/-!([\s\S]*?)-\//.exec(src);
    let title = null, para = "";
    const mains = [];
    if (m) {
      let inMain = false;
      const body = [];
      for (const raw of m[1].split("\n")) {
        const s = raw.trim();
        const h = /^#\s+(.*)/.exec(s);
        if (h && title === null) { title = h[1]; continue; }
        if (/^#+\s*(main (results?|statements?|theorems?|definitions?)|results)\s*$/i.test(s)) { inMain = true; continue; }
        if (s.startsWith("#")) { inMain = false; body.push("\n"); continue; }
        if (inMain) {
          const b = /^[*\-+]\s+(.*)/.exec(s);
          if (b) mains.push(b[1]);
          else if (s && mains.length) mains[mains.length - 1] += " " + s;
        } else body.push(s || "\n");
      }
      para = clip(body.join(" ").trim().split("\n")[0], 380);
    }
    const h = mains.slice(0, 6).map((it) => {
      const x = /^`([^`]+)`\s*[:：\-–—]?\s*(.*)/.exec(it);
      return { k: "result", n: x ? x[1] : "", d: clip(x ? x[2] || it : it, 220) };
    });
    const n = [0, 0, 0];
    const decls = [];
    let doc = null, open = null;
    for (const line of src.split("\n")) {
      const s = line.trim();
      if (open) { open.push(line); if (line.includes("-/")) { doc = open.join(" ").split("-/")[0]; open = null; } continue; }
      if (s.startsWith("/--")) { const f = s.slice(3); if (f.includes("-/")) doc = f.split("-/")[0]; else open = [f]; continue; }
      if (!s) continue;
      const d = /^\s/.test(line) ? null : DECL.exec(s);
      if (d) {
        const k = /^(theorem|lemma)$/.test(d[1]) ? "theorem" : d[1] === "instance" ? "instance" : "def";
        n[k === "theorem" ? 0 : k === "def" ? 1 : 2]++;
        decls.push({ k, n: d[2], d: clip(doc || "", 220) });
        doc = null;
      } else if (!s.startsWith("@[")) doc = null;
    }
    const seen = new Set(h.map((x) => x.n));
    for (const d of [...decls].reverse().filter((d) => d.d && d.k === "theorem").concat(decls.filter((d) => d.d && d.k === "def"))) {
      if (h.length >= 6) break;
      if (d.n && !seen.has(d.n)) { h.push(d); seen.add(d.n); }
    }
    return { p: path, t: title, s: para, i: [], l: src.split("\n").length, n, h };
  }

  // ---- Topics ---------------------------------------------------------------
  // A topic is a folder below the path every file shares (one level deeper when
  // one folder holds most files). Small projects use one topic per file.
  function topicKey(paths) {
    const dirs = paths.map((p) => p.split("/").slice(0, -1));
    let common = 0;
    while (dirs.length && dirs.every((d) => d.length > common && d[common] === dirs[0][common])) common++;
    const dominant = [];
    for (;;) {
      const name = (p) => {
        const d = p.split("/").slice(0, -1);
        let lvl = common;
        while (lvl < d.length && dominant[lvl - common] === d[lvl]) lvl++;
        return d[lvl] ?? (lvl > common ? d[lvl - 1] : null);
      };
      const counts = d3.rollup(paths, (v) => v.length, name);
      const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0] || [];
      const deeper = paths.some((p) => p.split("/").length - 1 > common + dominant.length + 1);
      if (!top || n < paths.length * 0.6 || !deeper || dominant.length >= 3) return name;
      dominant.push(top);
    }
  }

  function buildTopics(files) {
    const keyOf = topicKey(files.map((f) => f.p));
    let keys = files.map((f) => keyOf(f.p));
    const distinct = new Set(keys).size;
    const perFile = distinct < 3 || files.length <= 6;
    if (perFile) keys = files.map((f) => f.p);
    const byKey = d3.group(files.map((f, i) => ({ f, key: keys[i] })), (x) => x.key);
    const topics = [...byKey].map(([key, list]) => {
      const fs = list.map((x) => x.f);
      const name = perFile ? fileTitle(fs[0]) : key ? humanize(key) : "Core";
      const best = [...fs].filter((f) => f.s).sort((a, b) => b.n[0] - a.n[0])[0];
      return {
        key, name, files: fs,
        theorems: d3.sum(fs, (f) => f.n[0]), defs: d3.sum(fs, (f) => f.n[1]),
        described: fs.filter((f) => f.s || f.h.some((h) => h.d)).length,
        blurb: best ? firstSentence(best.s) : "",
      };
    }).sort((a, b) => (HELPER.test(a.name) - HELPER.test(b.name)) || b.theorems - a.theorems);
    topics.forEach((t) => { t.helper = HELPER.test(t.name); });
    const topicOf = new Map();
    topics.forEach((t, i) => { t.idx = i; t.color = PALETTE[i % PALETTE.length]; t.files.forEach((f) => topicOf.set(f.p, t)); });
    // Topic-level links: how many imports go from one topic to another.
    const links = new Map();
    for (const f of files) for (const p of f.i) {
      const a = topicOf.get(p), b = topicOf.get(f.p);
      if (a && b && a !== b) { const k = `${a.idx}>${b.idx}`; links.set(k, (links.get(k) || 0) + 1); }
    }
    topics.forEach((t) => { t.deps = []; t.users = []; });
    const edges = [...links].map(([k, w]) => { const [a, b] = k.split(">").map(Number); return { s: topics[a], t: topics[b], w }; });
    edges.forEach((e) => { e.t.deps.push(e.s); e.s.users.push(e.t); });
    const depth = new Map();
    const depthOf = (t, stack = new Set()) => {
      if (depth.has(t)) return depth.get(t);
      if (stack.has(t)) return 0;
      stack.add(t);
      const v = t.deps.length ? 1 + Math.max(...t.deps.map((d) => depthOf(d, stack))) : 0;
      stack.delete(t);
      depth.set(t, v);
      return v;
    };
    topics.forEach((t) => { t.depth = depthOf(t); });
    return { topics, edges, perFile };
  }

  // The project's headline results: described results, preferring the authors' own "main results".
  // Results from files nothing else builds on (where a project is heading) rank first.
  function headlines(files, topicOf, limit) {
    const imported = new Set(files.flatMap((f) => f.i));
    const items = [];
    for (const f of files) for (const h of f.h) {
      if (!h.d || plain(h.d).length < 25) continue;
      const t = topicOf.get(f.p);
      const score = (h.k === "result" ? 3 : h.k === "theorem" ? 2 : 1) * 1000 + (imported.has(f.p) ? 0 : 1500) -
        (t?.helper ? 4000 : 0) + Math.min(f.n[0], 300) + (/^(lemma|auxiliary|helper)\b/i.test(plain(h.d)) ? -800 : 0);
      items.push({ d: plainMath(h.d), topic: t, file: f, score });
    }
    // Spread the headlines across topics: at most two from any one.
    const seen = new Set(), perTopic = new Map();
    return items.sort((a, b) => b.score - a.score).filter((x) => {
      const n = perTopic.get(x.topic) || 0;
      if (seen.has(x.d) || n >= 2) return false;
      seen.add(x.d);
      perTopic.set(x.topic, n + 1);
      return true;
    }).slice(0, limit);
  }

  // ---- DOM ----------------------------------------------------------------
  const root = document.createElement("section");
  root.id = "viewer";
  root.className = "viewer";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "viewer-title");
  root.innerHTML = `
    <div class="viewer-card">
      <header class="viewer-head">
        <div class="viewer-titles">
          <span class="viewer-eyebrow" id="viewer-eyebrow"></span>
          <h2 id="viewer-title"></h2>
          <p class="viewer-desc" id="viewer-desc"></p>
        </div>
        <div class="viewer-tools">
          <a id="viewer-gh" target="_blank" rel="noopener">Source on GitHub ↗</a>
          <button type="button" class="viewer-close" aria-label="Close">×</button>
        </div>
      </header>
      <div class="viewer-stats" id="viewer-stats"></div>
      <div class="viewer-body">
        <div class="viewer-graph">
          <div class="viewer-map-head"><span class="viewer-map-title" id="viewer-map-title">The big picture</span></div>
          <svg id="viewer-svg" role="img" aria-label="Topics in this project and how they build on each other"></svg>
          <div class="viewer-key" id="viewer-key"></div>
        </div>
        <div class="viewer-side" id="viewer-side" aria-live="polite"></div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const $ = (id) => root.querySelector(`#${id}`);
  const svgEl = $("viewer-svg"), side = $("viewer-side");
  let state = null, lastFocus = null, gNodes, gEdges, svg, zoom;

  function close() {
    root.hidden = true;
    document.body.classList.remove("viewer-open");
    state = null;
    lastFocus?.focus?.();
  }
  root.querySelector(".viewer-close").addEventListener("click", close);
  root.addEventListener("click", (ev) => { if (ev.target === root) close(); });
  document.addEventListener("keydown", (ev) => {
    if (!root.hidden && ev.key === "Escape") { ev.stopImmediatePropagation(); close(); }
  }, true);

  function show({ title, eyebrow, description, link }) {
    lastFocus = document.activeElement;
    state = null;
    $("viewer-title").textContent = plain(title);
    $("viewer-eyebrow").textContent = eyebrow || "";
    $("viewer-desc").textContent = plain(description);
    $("viewer-desc").hidden = !description;
    $("viewer-gh").href = link || "#";
    $("viewer-gh").hidden = !link;
    $("viewer-stats").innerHTML = "";
    $("viewer-key").innerHTML = "";
    side.innerHTML = `<p class="viewer-loading">Loading…</p>`;
    d3.select(svgEl).selectAll("*").remove();
    root.hidden = false;
    document.body.classList.add("viewer-open");
    root.querySelector(".viewer-close").focus();
  }

  function setData(data) {
    const files = data.files;
    const { topics, edges, perFile } = buildTopics(files);
    const topicOf = new Map();
    topics.forEach((t) => t.files.forEach((f) => topicOf.set(f.p, t)));
    state = { topics, edges, perFile, files, topicOf };
    const described = files.filter((f) => f.s || f.h.some((h) => h.d)).length;
    $("viewer-stats").innerHTML = [
      [d3.sum(topics, (t) => t.theorems), "results proved"],
      [d3.sum(topics, (t) => t.defs), "concepts defined"],
      [topics.length, perFile ? (topics.length === 1 ? "part" : "parts") : "topics"],
      [Math.round((100 * described) / Math.max(files.length, 1)) + "%", "explained in plain English"],
    ].map(([v, l]) => `<div class="vstat"><b>${typeof v === "number" ? v.toLocaleString() : v}</b><span>${l}</span></div>`).join("");
    $("viewer-map-title").textContent = perFile ? "The parts and how they connect" : "The topics and how they build on each other";
    $("viewer-key").innerHTML = `<span class="viewer-hint">Each bubble is a ${perFile ? "part" : "topic"}, sized by how many results it proves. ` +
      `Topics on the right build on those to their left; grey ones are supporting material. Drag to explore, click to read.</span>`;
    renderMap();
    renderOverview();
  }

  function renderMap() {
    svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    const { topics, edges } = state;
    const r = d3.scaleSqrt().domain([0, d3.max(topics, (t) => t.theorems) || 1]).range([9, 38]);
    const COL = 210, GAP = 18, PAD = 50;
    const cols = d3.groups(topics, (t) => t.depth).sort((a, b) => a[0] - b[0]);
    let maxY = 0;
    for (const [, list] of cols) {
      let y = PAD;
      list.sort((a, b) => b.theorems - a.theorems).forEach((t) => {
        const rr = r(t.theorems);
        t.x = PAD + t.depth * COL + 40;
        t.y = y + rr;
        y += rr * 2 + GAP + 14;
      });
      maxY = Math.max(maxY, y);
    }
    const world = svg.append("g");
    const w = d3.scaleLinear().domain([1, d3.max(edges, (e) => e.w) || 1]).range([1, 6]);
    gEdges = world.append("g").selectAll("path").data(edges).join("path").attr("class", "v-edge")
      .attr("stroke-width", (e) => w(e.w))
      .attr("d", (e) => {
        const x1 = e.s.x + r(e.s.theorems), x2 = e.t.x - r(e.t.theorems), mx = (x1 + x2) / 2;
        return `M${x1},${e.s.y} C${mx},${e.s.y} ${mx},${e.t.y} ${x2},${e.t.y}`;
      });
    gNodes = world.append("g").selectAll("g").data(topics).join("g")
      .attr("class", "v-node").attr("transform", (t) => `translate(${t.x},${t.y})`)
      .attr("tabindex", 0).attr("role", "button").attr("aria-label", (t) => t.name)
      .on("click", (ev, t) => { ev.stopPropagation(); pick(t); })
      .on("keydown", (ev, t) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(t); } });
    gNodes.append("circle").attr("class", "v-bubble").attr("r", (t) => r(t.theorems))
      .attr("fill", (t) => tone(t.helper ? "#94a3b8" : t.color)).attr("stroke", (t) => tone(t.helper ? "#94a3b8" : t.color));
    gNodes.classed("helper", (t) => t.helper);
    const label = gNodes.append("text").attr("class", "v-label").attr("x", (t) => r(t.theorems) + 8).attr("dy", "-0.15em");
    label.text((t) => (t.name.length > 28 ? t.name.slice(0, 27) + "…" : t.name));
    gNodes.append("text").attr("class", "v-sub").attr("x", (t) => r(t.theorems) + 8).attr("dy", "1.05em")
      .text((t) => plural(t.theorems, "result"));
    gNodes.append("title").text((t) => t.name);
    svg.on("click", () => renderOverview());

    zoom = d3.zoom().scaleExtent([0.2, 2.5]).on("zoom", (ev) => world.attr("transform", ev.transform));
    svg.call(zoom).on("dblclick.zoom", null);
    const W = svgEl.clientWidth || 600, H = svgEl.clientHeight || 400;
    const maxX = d3.max(topics, (t) => t.x) + 230;
    // Start readable: never below 0.7, even if a wide project then needs a pan to see it all.
    const k = Math.max(0.7, Math.min(1.1, W / maxX, H / maxY));
    svg.call(zoom.transform, d3.zoomIdentity.translate(Math.max(0, (W - maxX * k) / 2), Math.max(10, (H - maxY * k) / 2)).scale(k));
  }

  const topicChip = (t) => `<button type="button" class="vchip" data-topic="${t.idx}"><i style="background:${tone(t.color)}"></i>${esc(t.name)}</button>`;
  const resultCard = (x, withTopic) => `<li class="vr"><p>${esc(x.d)}</p>${withTopic && x.topic ? `<span class="vr-from">${esc(x.topic.name)}</span>` : ""}</li>`;

  function renderOverview() {
    if (!state) return;
    gNodes?.classed("sel up down dim", false);
    gEdges?.classed("up down dim", false);
    const { topics, files, topicOf } = state;
    const heads = headlines(files, topicOf, 5);
    const ranked = topics.slice(0, 8);
    side.innerHTML = `
      ${heads.length ? `<h3 class="vs-head">Headline results</h3><ol class="vresults">${heads.map((x) => resultCard(x, true)).join("")}</ol>` : ""}
      <h3 class="vs-head">${state.perFile ? "What's inside" : "Main topics"}</h3>
      <div class="vtopics">${ranked.map((t) => `
        <button type="button" class="vtopic" data-topic="${t.idx}" style="--tc:${tone(t.color)}">
          <b>${esc(t.name)}</b>
          <span class="vt-num">${plural(t.theorems, "result")}${t.defs ? ` · ${plural(t.defs, "concept")}` : ""}${t.helper ? " · supporting material" : ""}</span>
          ${t.blurb ? `<span class="vt-blurb">${esc(t.blurb)}</span>` : ""}
        </button>`).join("")}</div>
      ${topics.length > ranked.length ? `<p class="vs-note">Plus ${topics.length - ranked.length} smaller ${state.perFile ? "parts" : "topics"} on the map.</p>` : ""}`;
    side.scrollTop = 0;
  }

  function pick(t) {
    const up = new Set(), down = new Set();
    const walk = (x, key, seen) => { for (const y of x[key]) if (!seen.has(y)) { seen.add(y); walk(y, key, seen); } };
    walk(t, "deps", up);
    walk(t, "users", down);
    gNodes.classed("sel", (n) => n === t).classed("up", (n) => up.has(n)).classed("down", (n) => down.has(n))
      .classed("dim", (n) => n !== t && !up.has(n) && !down.has(n));
    gEdges.classed("up", (e) => (e.t === t || up.has(e.t)) && up.has(e.s))
      .classed("down", (e) => (e.s === t || down.has(e.s)) && down.has(e.t))
      .classed("dim", (e) => !((e.t === t || up.has(e.t)) && up.has(e.s)) && !((e.s === t || down.has(e.s)) && down.has(e.t)));

    // What this topic covers: its best-described pieces, biggest first.
    const parts = [...t.files].filter((f) => f.s).sort((a, b) => b.n[0] - a.n[0]).slice(0, 6);
    const heads = headlines(t.files, state.topicOf, 6);
    const intro = state.perFile && t.files[0].s ? plainMath(t.files[0].s) : t.blurb;
    side.innerHTML = `
      <button type="button" class="vs-back">← The big picture</button>
      <div class="vs-tag" style="--tc:${tone(t.color)}">${state.perFile ? "Part" : "Topic"}</div>
      <h3 class="vs-title">${esc(t.name)}</h3>
      ${intro ? `<p class="vs-summary">${esc(intro)}</p>` : ""}
      <div class="vs-counts"><span>${plural(t.theorems, "result")} proved</span><span>${plural(t.defs, "concept")} defined</span></div>
      ${heads.length ? `<h4>Key results</h4><ol class="vresults">${heads.map((x) => resultCard(x, false)).join("")}</ol>` : ""}
      ${!state.perFile && parts.length ? `<h4>What it covers</h4><ul class="vparts">${parts.map((f) =>
        `<li><b>${esc(fileTitle(f))}</b><span>${esc(firstSentence(f.s))}</span></li>`).join("")}</ul>` : ""}
      ${!heads.length && !parts.length && !intro ? `<p class="vs-summary muted">The authors didn't describe this ${state.perFile ? "part" : "topic"} in plain English.</p>` : ""}
      ${t.deps.length ? `<h4>Builds on</h4><div class="vchips">${t.deps.map(topicChip).join("")}</div>` : ""}
      ${t.users.length ? `<h4>Leads to</h4><div class="vchips">${t.users.map(topicChip).join("")}</div>` : ""}`;
    side.scrollTop = 0;
  }
  side.addEventListener("click", (ev) => {
    if (!state) return;
    const b = ev.target.closest("[data-topic]");
    if (b) { pick(state.topics[+b.dataset.topic]); return; }
    if (ev.target.closest(".vs-back")) renderOverview();
  });
  darkQuery.addEventListener("change", () => { if (state) { renderMap(); renderOverview(); } });

  window.ProofViewer = {
    async openOverview({ title, eyebrow, description, url, link }) {
      show({ title, eyebrow, description, link });
      try {
        const r = await fetch(url, { cache: "no-cache" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (root.hidden) return;
        setData(data);
      } catch (e) {
        side.innerHTML = `<p class="viewer-error">Could not load this overview. Try again in a moment.</p>`;
      }
    },
    async openChange({ title, files, ref, repo = MATHLIB, link, scope }) {
      show({ title, eyebrow: "New in mathlib", link });
      try {
        const texts = await Promise.all(files.map((p) => fetch(`${RAW(repo)}/${ref}/${p}`).then((r) => (r.ok ? r.text() : null))));
        if (root.hidden) return;
        const sums = files.map((p, k) => texts[k] && summarize(p, texts[k])).filter(Boolean);
        if (!sums.length) throw new Error("no files");
        setData({ repo, ref, files: sums });
        // Open on the part the change is about.
        const main = (scope && state.topics.find((t) => t.files.some((f) => f.p.includes(`/${scope}`)))) || state.topics[0];
        if (main) pick(main);
      } catch (e) {
        side.innerHTML = `<p class="viewer-error">Could not load this result. Try again in a moment.</p>`;
      }
    },
    close,
  };
})();
