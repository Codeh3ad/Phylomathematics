/* Lean proof viewer: opens a mathlib file inside the site.
 *
 * Left: the file's declarations as a dependency graph. Columns are dependency
 * depth, so a theorem sits to the right of everything it uses, the same way
 * fields sit to the right of their ancestors on the main map.
 * Right: the source, lightly highlighted. Clicking a node scrolls to its code;
 * clicking a declaration in the code selects its node.
 *
 * Usage: ProofViewer.open({ title, files: [path, ...], ref, link, start })
 */
(() => {
  "use strict";

  const RAW = "https://raw.githubusercontent.com/leanprover-community/mathlib4";
  const BLOB = "https://github.com/leanprover-community/mathlib4/blob";
  const DOCS = "https://leanprover-community.github.io/mathlib4_docs";

  const KIND = {
    theorem: "theorem", lemma: "theorem",
    def: "def", abbrev: "def", structure: "def", class: "def", inductive: "def", opaque: "def", axiom: "def",
    instance: "instance", example: "example",
  };
  const DECL = /^(?:(?:private|protected|noncomputable|nonrec|partial|unsafe|scoped|public)\s+)*(theorem|lemma|def|abbrev|instance|structure|class|inductive|example|opaque|axiom)\b\s*([^\s:({[⦃]*)/;
  const KEYWORDS = new Set(("theorem lemma def abbrev instance structure class inductive example opaque axiom where " +
    "namespace section end variable open import universe noncomputable private protected by have show from fun λ let in " +
    "match with at if then else do calc deriving extends mutual attribute local scoped set_option omit include").split(" "));
  const TACTICS = new Set(("simp simp_all simpa rw rwa exact apply intro intros refine obtain rcases rintro cases induction " +
    "linarith nlinarith omega norm_num ring ring_nf field_simp aesop gcongr positivity constructor use exists " +
    "specialize unfold dsimp change convert congr ext funext trivial decide rfl tauto contradiction exfalso by_contra " +
    "push_neg filter_upwards measurability continuity fun_prop bound grind").split(" "));

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cache = new Map();

  // ---- Parsing ------------------------------------------------------------
  function parse(text) {
    const lines = text.split("\n");
    const decls = [];
    const scopes = [];
    let pending = null;   // first line of a docstring or attribute block waiting for its declaration
    let inBlock = false;  // inside /- ... -/
    let inDoc = false;
    let cur = null;
    const close = (end) => { if (cur) { cur.end = Math.max(cur.start, end); cur = null; } };

    lines.forEach((line, i) => {
      const t = line.trim();
      if (inBlock) {
        if (t.includes("-/")) inBlock = false;
        return;
      }
      if (t.startsWith("/--")) { close(i - 1); pending ??= i; if (!t.includes("-/")) { inBlock = true; inDoc = true; } return; }
      if (t.startsWith("/-")) { if (!t.includes("-/")) inBlock = true; return; }
      if (inDoc) inDoc = false;
      if (/^@\[/.test(t) && !DECL.test(t.replace(/^(@\[[^\]]*\]\s*)+/, ""))) { close(i - 1); pending ??= i; return; }
      const body = t.replace(/^(@\[[^\]]*\]\s*)+/, "");
      const m = line.startsWith(" ") ? null : DECL.exec(body);
      if (m) {
        close((pending ?? i) - 1);
        const ns = scopes.filter((s) => s.ns).map((s) => s.name).join(".");
        let name = m[2] || "";
        const kw = m[1];
        if (!name || kw === "example") name = `${kw} (line ${i + 1})`;
        const anonymous = !m[2] || kw === "example";
        const full = anonymous ? name : name.startsWith("_root_.") ? name.slice(7) : ns ? `${ns}.${name}` : name;
        cur = { kw, kind: KIND[kw], name, full, short: anonymous ? null : name.split(".").pop(), start: pending ?? i, head: i, end: i };
        decls.push(cur);
        pending = null;
        return;
      }
      const sc = /^(?:(?:public|noncomputable)\s+)?(namespace|section|end)\b\s*(\S*)/.exec(t);
      if (sc && !line.startsWith(" ")) {
        close(i - 1);
        pending = null;
        if (sc[1] === "end") scopes.pop();
        else for (const part of sc[1] === "namespace" ? sc[2].split(".") : [sc[2]]) scopes.push({ ns: sc[1] === "namespace", name: part });
        return;
      }
      if (/^(variable|open|universe|set_option|import|attribute|noncomputable section|omit|include)\b/.test(t) && !line.startsWith(" ")) {
        close(i - 1);
        pending = null;
      }
    });
    close(lines.length - 1);
    for (const d of decls) {
      while (d.end > d.head && !lines[d.end].trim()) d.end--;
    }

    // A declaration depends on any earlier declaration in this file whose name it mentions.
    const byShort = new Map();
    decls.forEach((d, k) => {
      d.idx = k;
      d.deps = new Set();
      const body = lines.slice(d.head, d.end + 1).join("\n").replace(/--.*$/gm, "");
      for (const tok of body.match(/[\p{L}_][\p{L}\p{N}_'!?₀-₉.]*/gu) || []) {
        for (const cand of [tok, tok.split(".").pop()]) {
          const hit = cand.length >= 3 && byShort.get(cand);
          if (hit !== undefined && hit !== false && hit !== k) d.deps.add(hit);
        }
      }
      if (d.short && d.short.length >= 3) byShort.set(d.short, k);
      if (d.full && d.full !== d.short) byShort.set(d.full, k);
    });
    decls.forEach((d) => {
      d.depth = d.deps.size ? 1 + Math.max(...[...d.deps].map((j) => decls[j].depth)) : 0;
      d.users = [];
    });
    decls.forEach((d) => d.deps.forEach((j) => decls[j].users.push(d.idx)));
    return { lines, decls };
  }

  // ---- Highlighting -------------------------------------------------------
  function highlight(lines) {
    let block = false;
    return lines.map((line) => {
      let out = "", i = 0;
      while (i < line.length) {
        if (block) {
          const j = line.indexOf("-/", i);
          const stop = j < 0 ? line.length : j + 2;
          out += `<span class="tk-c">${esc(line.slice(i, stop))}</span>`;
          if (j >= 0) block = false;
          i = stop;
          continue;
        }
        const rest = line.slice(i);
        if (rest.startsWith("--")) { out += `<span class="tk-c">${esc(rest)}</span>`; break; }
        if (rest.startsWith("/-")) { block = true; continue; }
        if (rest[0] === '"') {
          const m = /^"(?:[^"\\]|\\.)*"?/.exec(rest);
          out += `<span class="tk-s">${esc(m[0])}</span>`; i += m[0].length; continue;
        }
        const w = /^[\p{L}_][\p{L}\p{N}_'!?₀-₉.]*/u.exec(rest);
        if (w) {
          const word = w[0];
          const cls = KEYWORDS.has(word) ? "tk-k" : TACTICS.has(word) ? "tk-t" : /^(Type|Prop|Sort)$/.test(word) ? "tk-y" : "";
          out += cls ? `<span class="${cls}">${esc(word)}</span>` : esc(word);
          i += word.length;
          continue;
        }
        const n = /^\d+/.exec(rest);
        if (n) { out += `<span class="tk-n">${n[0]}</span>`; i += n[0].length; continue; }
        out += esc(rest[0]); i += 1;
      }
      return out || " ";
    });
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
          <span class="viewer-eyebrow">Lean proof</span>
          <h2 id="viewer-title"></h2>
        </div>
        <div class="viewer-tools">
          <select id="viewer-file" aria-label="File"></select>
          <a id="viewer-gh" target="_blank" rel="noopener">GitHub</a>
          <a id="viewer-docs" target="_blank" rel="noopener">Docs</a>
          <button type="button" class="viewer-close" aria-label="Close proof viewer">×</button>
        </div>
      </header>
      <div class="viewer-body">
        <div class="viewer-graph">
          <div class="viewer-stats" id="viewer-stats"></div>
          <svg id="viewer-svg" role="img" aria-label="Declarations in this file and what they use"></svg>
          <div class="viewer-key">
            <span><i class="k-def"></i>Definition</span><span><i class="k-theorem"></i>Theorem</span><span><i class="k-instance"></i>Instance</span>
            <span class="viewer-hint">Arrows point from what is used to what uses it. Click a node.</span>
          </div>
        </div>
        <div class="viewer-code">
          <div class="viewer-decl" id="viewer-decl"></div>
          <pre id="viewer-pre" tabindex="0"></pre>
        </div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const $ = (id) => root.querySelector(`#${id}`);
  const fileSel = $("viewer-file"), pre = $("viewer-pre"), svgEl = $("viewer-svg");
  let state = null;
  let lastFocus = null;

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
  fileSel.addEventListener("change", () => load(fileSel.value));

  async function fetchFile(ref, path) {
    const key = `${ref}/${path}`;
    if (!cache.has(key)) {
      cache.set(key, fetch(`${RAW}/${ref}/${path}`).then((r) => {
        if (!r.ok) throw new Error(`GitHub returned ${r.status}`);
        return r.text();
      }));
    }
    return cache.get(key).catch((e) => { cache.delete(key); throw e; });
  }

  async function load(path) {
    const ref = state.ref;
    state.path = path;
    $("viewer-gh").href = `${BLOB}/${ref}/${path}`;
    $("viewer-docs").href = `${DOCS}/${path.replace(/\.lean$/, "")}.html`;
    $("viewer-stats").textContent = "Loading…";
    $("viewer-decl").innerHTML = "";
    pre.innerHTML = "";
    d3.select(svgEl).selectAll("*").remove();
    let text;
    try {
      text = await fetchFile(ref, path);
    } catch (e) {
      if (state?.path !== path) return;
      $("viewer-stats").textContent = "";
      pre.innerHTML = `<span class="viewer-error">Could not load this file (${esc(e.message)}). ` +
        `<a href="${BLOB}/${ref}/${esc(path)}" target="_blank" rel="noopener">Open it on GitHub</a> instead.</span>`;
      return;
    }
    if (state?.path !== path) return;
    const parsed = parse(text);
    state.parsed = parsed;
    renderCode(parsed);
    renderGraph(parsed);
    const counts = { theorem: 0, def: 0, instance: 0, example: 0 };
    parsed.decls.forEach((d) => counts[d.kind]++);
    $("viewer-stats").innerHTML = `<b>${counts.theorem}</b> theorems · <b>${counts.def}</b> definitions · <b>${counts.instance}</b> instances · ${parsed.lines.length.toLocaleString()} lines`;
    // Open on the newest-looking result: the last theorem in the file.
    const first = [...parsed.decls].reverse().find((d) => d.kind === "theorem") || parsed.decls[0];
    if (first) pick(first.idx, { scroll: true, center: true });
  }

  function renderCode({ lines, decls }) {
    const html = highlight(lines);
    const headAt = new Map(decls.map((d) => [d.head, d]));
    pre.innerHTML = html.map((h, i) => {
      const d = headAt.get(i);
      return `<div class="ln${d ? " head" : ""}" id="L${i + 1}"${d ? ` data-decl="${d.idx}"` : ""}><span class="no">${i + 1}</span><code>${h}</code></div>`;
    }).join("");
  }
  pre.addEventListener("click", (ev) => {
    const head = ev.target.closest(".ln.head");
    if (head) pick(+head.dataset.decl, { scroll: false, center: true });
  });

  let gNodes, gEdges, zoom, svg;
  function renderGraph({ decls }) {
    svg = d3.select(svgEl);
    const COL = 170, ROW = 26, PAD = 24;
    const cols = d3.groups(decls, (d) => d.depth).sort((a, b) => a[0] - b[0]);
    for (const [, list] of cols) list.forEach((d, r) => { d.x = PAD + d.depth * COL; d.y = PAD + r * ROW; });
    const world = svg.append("g");
    const edges = decls.flatMap((d) => [...d.deps].map((j) => ({ s: decls[j], t: d })));
    gEdges = world.append("g").selectAll("path").data(edges).join("path")
      .attr("class", "v-edge")
      .attr("d", (e) => {
        const x1 = e.s.x + COL - 22, y1 = e.s.y, x2 = e.t.x - 7, y2 = e.t.y, mx = (x1 + x2) / 2;
        return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
      });
    gNodes = world.append("g").selectAll("g").data(decls).join("g")
      .attr("class", (d) => `v-node k-${d.kind}`)
      .attr("transform", (d) => `translate(${d.x},${d.y})`)
      .on("click", (ev, d) => { ev.stopPropagation(); pick(d.idx, { scroll: true }); });
    gNodes.append("rect").attr("class", "v-hit").attr("x", -8).attr("y", -10).attr("width", COL - 14).attr("height", 20).attr("rx", 4);
    gNodes.each(function (d) {
      const g = d3.select(this);
      if (d.kind === "def") g.append("rect").attr("class", "v-mark").attr("x", -5).attr("y", -5).attr("width", 10).attr("height", 10).attr("rx", 2);
      else if (d.kind === "instance") g.append("path").attr("class", "v-mark").attr("d", "M0,-6 L6,0 L0,6 L-6,0 Z");
      else g.append("circle").attr("class", "v-mark").attr("r", 5);
    });
    const shortLabel = (d) => { const n = d.name.split(".").pop(); return n.length > 20 ? n.slice(0, 19) + "…" : n; };
    gNodes.append("text").attr("x", 10).attr("dy", "0.35em").text(shortLabel);
    gNodes.append("title").text((d) => `${d.kw} ${d.full}`);

    zoom = d3.zoom().scaleExtent([0.2, 2.5]).on("zoom", (ev) => world.attr("transform", ev.transform));
    svg.call(zoom).on("dblclick.zoom", null);
    const w = svgEl.clientWidth, h = svgEl.clientHeight;
    const maxX = d3.max(decls, (d) => d.x) + COL, maxY = d3.max(decls, (d) => d.y) + PAD;
    const k = Math.max(0.35, Math.min(1, w / maxX, h / maxY));
    svg.call(zoom.transform, d3.zoomIdentity.scale(k));
  }

  function pick(idx, { scroll = true, center = false } = {}) {
    const { decls } = state.parsed;
    const d = decls[idx];
    if (!d) return;
    // Everything this declaration rests on, and everything that rests on it.
    const up = new Set(), down = new Set();
    const walk = (k, key, seen) => { for (const j of key === "deps" ? decls[k].deps : decls[k].users) if (!seen.has(j)) { seen.add(j); walk(j, key, seen); } };
    walk(idx, "deps", up);
    walk(idx, "users", down);
    gNodes.classed("sel", (n) => n.idx === idx).classed("up", (n) => up.has(n.idx)).classed("down", (n) => down.has(n.idx))
      .classed("dim", (n) => n.idx !== idx && !up.has(n.idx) && !down.has(n.idx));
    gEdges.classed("up", (e) => (e.t.idx === idx || up.has(e.t.idx)) && up.has(e.s.idx))
      .classed("down", (e) => (e.s.idx === idx || down.has(e.s.idx)) && down.has(e.t.idx));
    pre.querySelectorAll(".ln.on").forEach((el) => el.classList.remove("on"));
    for (let i = d.start; i <= d.end; i++) pre.children[i]?.classList.add("on");
    if (scroll) pre.children[d.start]?.scrollIntoView({ block: "start", behavior: "smooth" });
    if (center && svg) {
      svg.transition().duration(400).call(zoom.translateTo, d.x + 60, d.y, [svgEl.clientWidth / 2, svgEl.clientHeight / 2]);
    }
    const docsHref = `${DOCS}/${state.path.replace(/\.lean$/, "")}.html#${encodeURIComponent(d.full)}`;
    const usesN = d.deps.size, usedN = d.users.length;
    $("viewer-decl").innerHTML =
      `<span class="vk k-${d.kind}">${esc(d.kw)}</span> <code>${esc(d.full)}</code>` +
      `<span class="vd-meta">lines ${d.start + 1}–${d.end + 1} · uses ${usesN} · used by ${usedN} in this file · ` +
      `<a href="${BLOB}/${state.ref}/${esc(state.path)}#L${d.start + 1}-L${d.end + 1}" target="_blank" rel="noopener">GitHub</a>` +
      (d.short ? ` · <a href="${docsHref}" target="_blank" rel="noopener">Docs</a>` : "") + `</span>`;
  }

  window.ProofViewer = {
    open({ title, files, ref = "master", start }) {
      if (!files?.length) return;
      lastFocus = document.activeElement;
      state = { ref, files };
      $("viewer-title").textContent = title;
      fileSel.innerHTML = files.map((f) => `<option value="${esc(f)}">${esc(f.replace(/^Mathlib\//, ""))}</option>`).join("");
      fileSel.hidden = files.length < 2;
      const first = start && files.includes(start) ? start : files[0];
      fileSel.value = first;
      root.hidden = false;
      document.body.classList.add("viewer-open");
      root.querySelector(".viewer-close").focus();
      load(first);
    },
    close,
  };
})();
