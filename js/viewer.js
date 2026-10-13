/* Lean project explorer: a human-readable overview of formalized mathematics.
 *
 * Instead of code, it shows a project as a map of its files (each file sits to
 * the right of the files it builds on, like fields on the main map), and for
 * each file the English its authors wrote: a title, a summary, and the main
 * results with their descriptions. The Lean source stays one click away on GitHub.
 *
 *   ProofViewer.openOverview({ title, eyebrow, description, url, link })  // precomputed summaries
 *   ProofViewer.openChange({ title, files, ref, repo, link })            // a single change, read live
 */
(() => {
  "use strict";

  const MATHLIB = "leanprover-community/mathlib4";
  const RAW = (repo) => `https://raw.githubusercontent.com/${repo}`;
  const BLOB = (repo) => `https://github.com/${repo}/blob`;
  const FOLDER_COLORS = ["#0369a1", "#15803d", "#7c3aed", "#c2410c", "#be185d", "#0d9488", "#a16207", "#475569", "#65a30d", "#b91c1c"];

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Backticks in Lean docstrings mark code; show them as code, everything else as text.
  const prose = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : darkQuery.matches);
  const tone = (c) => (isDark() ? d3.color(c).brighter(0.9).formatHex() : c);

  // "FreyPackage.freyCurve" -> "Frey package › frey curve"
  function humanName(name) {
    if (!name) return "";
    return name.replace(/^_root_\./, "").split(".").map((part) => part
      .replace(/_/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(" ").map((w, i) => (/^[A-Z]{2,}/.test(w) ? w : i === 0 ? w : w.toLowerCase())).join(" "),
    ).join(" › ");
  }
  const fileLabel = (f) => f.t || f.p.split("/").pop().replace(/\.lean$/, "");
  // Group files by the first folder below whatever path they all share,
  // e.g. FLT/Patching/… -> "Patching", Mathlib/NumberTheory/LSeries/… -> "LSeries".
  function folderNamer(paths) {
    const dirs = paths.map((p) => p.split("/").slice(0, -1));
    let common = 0;
    while (dirs.length && dirs.every((d) => d.length > common && d[common] === dirs[0][common])) common++;
    // If one folder still holds most files (FLT/…), look one level inside it.
    const dominant = [];
    for (;;) {
      const name = (p) => {
        const d = p.split("/").slice(0, -1);
        let lvl = common;
        while (lvl < d.length && dominant[lvl - common] === d[lvl]) lvl++;
        return d[lvl] ?? (lvl > common ? d[lvl - 1] : "Main files");
      };
      const counts = d3.rollup(paths, (v) => v.length, name);
      const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0] || [];
      const deeper = paths.some((p) => p.split("/").length - 1 > common + dominant.length + 1);
      if (!top || n < paths.length * 0.6 || !deeper || dominant.length >= 3) return name;
      dominant.push(top);
    }
  }
  const KIND_LABEL = { result: "Main result", theorem: "Theorem", def: "Definition", instance: "Instance" };

  // ---- Live summaries for a single change (same shape as tools/lean_summary.py) ----
  const DECL = /^(?:@\[[^\]]*\]\s*)*(?:(?:private|protected|noncomputable|nonrec|partial|unsafe|scoped|public)\s+)*(theorem|lemma|def|abbrev|instance|structure|class|inductive|opaque|axiom)\b\s*([^\s:({[⦃]*)/;
  const clean = (t, n) => {
    t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n).replace(/\s\S*$/, "") + "…" : t;
  };
  function summarize(path, text) {
    const m = /\/-!([\s\S]*?)-\//.exec(text);
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
      para = clean(body.join(" ").trim().split("\n")[0], 380);
    }
    const h = mains.slice(0, 6).map((it) => {
      const x = /^`([^`]+)`\s*[:：\-–—]?\s*(.*)/.exec(it);
      return { k: "result", n: x ? x[1] : "", d: clean(x ? x[2] || it : it, 220) };
    });
    const n = [0, 0, 0];
    const decls = [];
    let doc = null, open = null;
    for (const line of text.split("\n")) {
      const s = line.trim();
      if (open) { open.push(line); if (line.includes("-/")) { doc = open.join(" ").split("-/")[0]; open = null; } continue; }
      if (s.startsWith("/--")) { const f = s.slice(3); if (f.includes("-/")) doc = f.split("-/")[0]; else open = [f]; continue; }
      if (!s) continue;
      const d = /^\s/.test(line) ? null : DECL.exec(s);
      if (d) {
        const k = /^(theorem|lemma)$/.test(d[1]) ? "theorem" : d[1] === "instance" ? "instance" : "def";
        n[k === "theorem" ? 0 : k === "def" ? 1 : 2]++;
        decls.push({ k, n: d[2], d: clean(doc || "", 220) });
        doc = null;
      } else if (!s.startsWith("@[")) doc = null;
    }
    const seen = new Set(h.map((x) => x.n));
    const pool = [...decls].reverse().filter((d) => d.d && d.k === "theorem").concat(decls.filter((d) => d.d && d.k === "def"));
    for (const d of pool) {
      if (h.length >= 6) break;
      if (d.n && !seen.has(d.n)) { h.push(d); seen.add(d.n); }
    }
    if (!h.length) h.push(...[...decls].reverse().filter((d) => d.k === "theorem" && d.n).slice(0, 2));
    return { p: path, t: title, s: para, i: [], l: text.split("\n").length, n, h };
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
          <a id="viewer-gh" target="_blank" rel="noopener">View on GitHub ↗</a>
          <button type="button" class="viewer-close" aria-label="Close">×</button>
        </div>
      </header>
      <div class="viewer-stats" id="viewer-stats"></div>
      <div class="viewer-body">
        <div class="viewer-graph">
          <div class="viewer-map-head">
            <span class="viewer-map-title">How the files build on each other</span>
            <input id="viewer-filter" type="search" placeholder="Find a file or result…" aria-label="Find a file or result" autocomplete="off">
          </div>
          <svg id="viewer-svg" role="img" aria-label="Map of the project's files"></svg>
          <div class="viewer-key" id="viewer-key"></div>
        </div>
        <div class="viewer-side" id="viewer-side" aria-live="polite"></div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const $ = (id) => root.querySelector(`#${id}`);
  const svgEl = $("viewer-svg"), side = $("viewer-side"), filterIn = $("viewer-filter");
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
    $("viewer-title").textContent = title;
    $("viewer-eyebrow").textContent = eyebrow || "Lean";
    $("viewer-desc").innerHTML = description ? prose(description) : "";
    $("viewer-desc").hidden = !description;
    $("viewer-gh").href = link || "#";
    $("viewer-gh").hidden = !link;
    $("viewer-stats").innerHTML = "";
    $("viewer-key").innerHTML = "";
    filterIn.value = "";
    side.innerHTML = `<p class="viewer-loading">Loading…</p>`;
    d3.select(svgEl).selectAll("*").remove();
    root.hidden = false;
    document.body.classList.add("viewer-open");
    root.querySelector(".viewer-close").focus();
  }

  function setData(data) {
    const folderOf = folderNamer(data.files.map((f) => f.p));
    const files = data.files.map((f, idx) => ({ ...f, idx, folder: folderOf(f.p) }));
    const byPath = new Map(files.map((f) => [f.p, f]));
    files.forEach((f) => { f.deps = f.i.map((p) => byPath.get(p)).filter(Boolean); f.users = []; });
    files.forEach((f) => f.deps.forEach((d) => d.users.push(f)));
    // Depth = how many layers of the project a file rests on.
    const depth = new Map();
    const depthOf = (f, seen = new Set()) => {
      if (depth.has(f)) return depth.get(f);
      if (seen.has(f)) return 0;
      seen.add(f);
      const v = f.deps.length ? 1 + Math.max(...f.deps.map((d) => depthOf(d, seen))) : 0;
      depth.set(f, v);
      return v;
    };
    files.forEach((f) => { f.depth = depthOf(f); });
    const folders = d3.rollups(files, (v) => v.length, (f) => f.folder).sort((a, b) => b[1] - a[1]);
    const color = new Map(folders.map(([name], k) => [name, FOLDER_COLORS[k % FOLDER_COLORS.length]]));
    files.forEach((f) => { f.color = color.get(f.folder); });
    state = { ...data, files, byPath, folders, color, focusFolder: null };

    const sum = (k) => d3.sum(files, (f) => f.n[k]);
    const documented = files.filter((f) => f.s || f.h.some((x) => x.d)).length;
    $("viewer-stats").innerHTML = [
      [files.length, files.length === 1 ? "file" : "files"],
      [sum(0), "theorems"],
      [sum(1), "definitions"],
      [d3.sum(files, (f) => f.l), "lines of Lean"],
      [Math.round((100 * documented) / Math.max(files.length, 1)) + "%", "described in English"],
    ].map(([v, l]) => `<div class="vstat"><b>${typeof v === "number" ? v.toLocaleString() : v}</b><span>${l}</span></div>`).join("");

    renderMap();
    renderKey();
    renderOverview();
  }

  function renderKey() {
    const shown = state.folders.slice(0, 8);
    $("viewer-key").innerHTML = shown.map(([name, count]) =>
      `<button type="button" class="vfolder${state.focusFolder === name ? " on" : ""}" data-folder="${esc(name)}">` +
      `<i style="background:${tone(state.color.get(name))}"></i>${esc(name)} <span>${count}</span></button>`).join("") +
      (state.folders.length > 8 ? `<span class="vmore">+${state.folders.length - 8} more folders</span>` : "") +
      `<span class="viewer-hint">Each dot is a file, sized by how much it proves. Files on the right build on files to their left. Click a folder to highlight it.</span>`;
  }
  $("viewer-key").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-folder]");
    if (!b || !state) return;
    state.focusFolder = state.focusFolder === b.dataset.folder ? null : b.dataset.folder;
    renderKey();
    applyFocus();
  });

  function renderMap() {
    svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    const { files } = state;
    const COL = 200, ROW = 30, PAD = 30;
    const cols = d3.groups(files, (f) => f.depth).sort((a, b) => a[0] - b[0]);
    for (const [, list] of cols) {
      // Keep folders together within a column so the colors read as regions.
      list.sort((a, b) => a.folder.localeCompare(b.folder) || a.p.localeCompare(b.p));
      list.forEach((f, r) => { f.x = PAD + f.depth * COL; f.y = PAD + r * ROW; });
    }
    const weight = (f) => f.n[0] + f.n[1];
    const r = d3.scaleSqrt().domain([0, d3.max(files, weight) || 1]).range([4, 13]);
    const world = svg.append("g");
    const edges = files.flatMap((f) => f.deps.map((d) => ({ s: d, t: f })));
    gEdges = world.append("g").selectAll("path").data(edges).join("path").attr("class", "v-edge")
      .attr("d", (e) => {
        const x1 = e.s.x + COL - 30, x2 = e.t.x - r(weight(e.t)) - 3, mx = (x1 + x2) / 2;
        return `M${x1},${e.s.y} C${mx},${e.s.y} ${mx},${e.t.y} ${x2},${e.t.y}`;
      });
    gNodes = world.append("g").selectAll("g").data(files).join("g")
      .attr("class", "v-node").attr("transform", (f) => `translate(${f.x},${f.y})`)
      .attr("tabindex", 0).attr("role", "button").attr("aria-label", (f) => fileLabel(f))
      .on("click", (ev, f) => { ev.stopPropagation(); pick(f); })
      .on("keydown", (ev, f) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(f); } });
    gNodes.append("rect").attr("class", "v-hit").attr("x", -16).attr("y", -13).attr("width", COL - 10).attr("height", 26).attr("rx", 6);
    gNodes.append("circle").attr("r", (f) => r(weight(f))).attr("fill", (f) => tone(f.color));
    gNodes.append("text").attr("x", (f) => r(weight(f)) + 6).attr("dy", "0.35em")
      .text((f) => { const t = fileLabel(f).replace(/`/g, ""); return t.length > 24 ? t.slice(0, 23) + "…" : t; });
    gNodes.append("title").text((f) => `${fileLabel(f)}\n${f.p}`);
    svg.on("click", () => renderOverview());

    // Zoomed far out, names are unreadable: show the project as colored clusters instead.
    zoom = d3.zoom().scaleExtent([0.15, 2.5]).on("zoom", (ev) => {
      world.attr("transform", ev.transform);
      svg.classed("far", ev.transform.k < 0.55);
    });
    svg.call(zoom).on("dblclick.zoom", null);
    const w = svgEl.clientWidth || 600, h = svgEl.clientHeight || 400;
    const maxX = d3.max(files, (f) => f.x) + COL, maxY = d3.max(files, (f) => f.y) + PAD;
    const k = Math.max(0.3, Math.min(1.2, w / maxX, h / maxY));
    svg.call(zoom.transform, d3.zoomIdentity.translate(Math.max(0, (w - maxX * k) / 2), Math.max(0, (h - maxY * k) / 2)).scale(k));
  }

  function applyFocus() {
    const q = filterIn.value.trim().toLowerCase();
    const match = (f) => (!state.focusFolder || f.folder === state.focusFolder) &&
      (!q || fileLabel(f).toLowerCase().includes(q) || f.p.toLowerCase().includes(q) || f.s.toLowerCase().includes(q) ||
        f.h.some((x) => x.n.toLowerCase().includes(q) || x.d.toLowerCase().includes(q)));
    const active = state.focusFolder || q;
    gNodes.classed("faded", (f) => active && !match(f));
    gEdges.classed("faded", (e) => active && !(match(e.s) && match(e.t)));
  }
  filterIn.addEventListener("input", () => { if (state) applyFocus(); });

  const fileChip = (f) => `<button type="button" class="vchip" data-file="${f.idx}"><i style="background:${tone(f.color)}"></i>${esc(fileLabel(f).replace(/`/g, ""))}</button>`;

  // With nothing selected: where to start reading.
  function renderOverview() {
    if (!state) return;
    gNodes?.classed("sel up down dim", false);
    gEdges?.classed("up down", false);
    const { files } = state;
    const tops = files.filter((f) => !f.users.length && f.n[0] > 0).sort((a, b) => b.n[0] - a.n[0]).slice(0, 6);
    const bases = files.filter((f) => f.users.length).sort((a, b) => b.users.length - a.users.length).slice(0, 6);
    const described = files.filter((f) => f.s).sort((a, b) => b.n[0] - a.n[0]).slice(0, 4);
    side.innerHTML = `
      <h3 class="vs-head">Where to start</h3>
      <p class="vs-intro">Click any dot on the map to read what that file proves, in its authors' own words.</p>
      ${tops.length ? `<h4>Main results</h4><p class="vs-note">Files nothing else builds on: usually where the project's goals live.</p><div class="vchips">${tops.map(fileChip).join("")}</div>` : ""}
      ${bases.length ? `<h4>Foundations</h4><p class="vs-note">Files the most others build on.</p><div class="vchips">${bases.map(fileChip).join("")}</div>` : ""}
      ${described.length ? `<h4>Well described</h4><div class="vcards">${described.map((f) =>
        `<button type="button" class="vcard" data-file="${f.idx}"><b>${prose(fileLabel(f))}</b><span>${prose(f.s)}</span></button>`).join("")}</div>` : ""}`;
    side.scrollTop = 0;
  }

  function pick(f) {
    const up = new Set(), down = new Set();
    const walk = (x, key, seen) => { for (const y of x[key]) if (!seen.has(y)) { seen.add(y); walk(y, key, seen); } };
    walk(f, "deps", up);
    walk(f, "users", down);
    gNodes.classed("sel", (n) => n === f).classed("up", (n) => up.has(n)).classed("down", (n) => down.has(n))
      .classed("dim", (n) => n !== f && !up.has(n) && !down.has(n));
    gEdges.classed("up", (e) => (e.t === f || up.has(e.t)) && up.has(e.s)).classed("down", (e) => (e.s === f || down.has(e.s)) && down.has(e.t));
    const k = Math.max(d3.zoomTransform(svgEl).k, 0.8);
    svg.transition().duration(450).call(zoom.transform,
      d3.zoomIdentity.translate(svgEl.clientWidth / 2 - (f.x + 60) * k, svgEl.clientHeight / 2 - f.y * k).scale(k));

    const src = `${BLOB(state.repo)}/${state.ref}/${f.p}`;
    const crumbs = f.p.replace(/\.lean$/, "").split("/");
    side.innerHTML = `
      <button type="button" class="vs-back">← Where to start</button>
      <div class="vs-crumbs" style="--fc:${tone(f.color)}">${crumbs.slice(0, -1).map(esc).join(" / ") || esc(crumbs[0])}</div>
      <h3 class="vs-title">${prose(fileLabel(f))}</h3>
      ${f.s ? `<p class="vs-summary">${prose(f.s)}</p>` : `<p class="vs-summary muted">The authors didn't add a description to this file.</p>`}
      <div class="vs-counts"><span><b>${f.n[0]}</b> theorems</span><span><b>${f.n[1]}</b> definitions</span>${f.n[2] ? `<span><b>${f.n[2]}</b> instances</span>` : ""}<span><b>${f.l.toLocaleString()}</b> lines</span></div>
      ${f.h.length ? `<h4>What it establishes</h4><ol class="vresults">${f.h.map((x) => `
        <li class="vr k-${x.k}"><span class="vr-kind">${KIND_LABEL[x.k] || x.k}</span>
          ${x.n ? `<span class="vr-name" title="${esc(x.n)}">${esc(humanName(x.n))}</span>` : ""}
          ${x.d ? `<p>${prose(x.d)}</p>` : ""}</li>`).join("")}</ol>` : ""}
      ${f.deps.length ? `<h4>Builds on</h4><div class="vchips">${f.deps.map(fileChip).join("")}</div>` : ""}
      ${f.users.length ? `<h4>Used by</h4><div class="vchips">${f.users.slice(0, 12).map(fileChip).join("")}${f.users.length > 12 ? `<span class="vmore">+${f.users.length - 12} more</span>` : ""}</div>` : ""}
      <a class="vs-source" href="${src}" target="_blank" rel="noopener">Read the Lean source on GitHub ↗</a>`;
    side.scrollTop = 0;
  }
  side.addEventListener("click", (ev) => {
    if (!state) return;
    const b = ev.target.closest("[data-file]");
    if (b) { pick(state.files[+b.dataset.file]); return; }
    if (ev.target.closest(".vs-back")) renderOverview();
  });
  darkQuery.addEventListener("change", () => { if (state) { renderMap(); renderKey(); renderOverview(); } });

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
        side.innerHTML = `<p class="viewer-error">Could not load this overview (${esc(e.message)}).</p>`;
      }
    },
    async openChange({ title, files, ref, repo = MATHLIB, link, scope }) {
      show({ title, eyebrow: "New in mathlib · what it proves", link });
      try {
        const texts = await Promise.all(files.map((p) => fetch(`${RAW(repo)}/${ref}/${p}`).then((r) => (r.ok ? r.text() : null))));
        if (root.hidden) return;
        const sums = files.map((p, k) => texts[k] && summarize(p, texts[k])).filter(Boolean);
        if (!sums.length) throw new Error("GitHub did not return the files");
        setData({ repo, ref, files: sums });
        // Open on the file the change is about (its scope), else the one with the most results.
        const main = (scope && state.files.find((f) => f.p.includes(`/${scope}`))) ||
          [...state.files].sort((a, b) => b.n[0] - a.n[0])[0];
        if (main) pick(main);
      } catch (e) {
        side.innerHTML = `<p class="viewer-error">Could not load this change (${esc(e.message)}).</p>`;
      }
    },
    close,
  };
})();
