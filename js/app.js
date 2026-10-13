/* Phylomathematics: a time-axis phylogenetic network of mathematical fields.
 *
 * Layout: x is the year (piecewise-linear, compressed for antiquity), y is the
 * clade row. Within a row, nodes are packed into lanes so labels never overlap.
 */
(() => {
  "use strict";

  // Year -> x. Each segment of the domain gets its own pixels-per-year rate.
  const YEAR_STOPS = [-1900, -600, 0, 1400, 1600, 1700, 1800, 1900, 2000];
  const X_STOPS    = [0,     240,  540, 880, 1180, 1430, 1730, 2110, 2500];
  const TICK_YEARS = [-1800, -1500, -1000, -500, 0, 500, 1000, 1400, 1500, 1600, 1650,
                      1700, 1750, 1800, 1850, 1900, 1925, 1950, 1975, 2000];

  const AXIS_H = 34;
  const LANE_H = 30;
  const BAND_PAD = 18;
  const LEFT_PAD = 130;   // room for sticky clade labels
  const LABEL_GAP = 26;   // horizontal space between a label's end and the next node

  const chartEl = document.getElementById("chart");
  const panel = document.getElementById("panel");
  const panelBody = document.getElementById("panel-body");
  const about = document.getElementById("about");
  const aboutBtn = document.getElementById("about-btn");
  const leanPanel = document.getElementById("lean");
  const leanBody = document.getElementById("lean-body");
  const leanBtn = document.getElementById("lean-btn");
  const search = document.getElementById("search");
  const showConv = document.getElementById("show-convergent");

  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === "dark" : darkQuery.matches;
  };

  const fmtYear = (y) => {
    if (y < 0) return `c. ${-y} BCE`;
    if (y < 1400) return `c. ${y} CE`;
    return String(y);
  };
  const tickLabel = (y) => (y < 0 ? `${-y} BCE` : y === 0 ? "1 CE" : String(y));

  const getJSON = (url) => fetch(url, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

  // Lean data is optional: the network still works if data/lean.json is missing.
  Promise.all([getJSON("data/nodes.json"), getJSON("data/lean.json").catch(() => null)])
    .then(([data, lean]) => init(data, lean))
    .catch((err) => {
      chartEl.innerHTML =
        `<p style="padding:24px;color:var(--muted)">Could not load data/nodes.json (${err.message}). ` +
        `If you opened this file directly, serve the folder instead: <code>python3 -m http.server</code>.</p>`;
    });

  function init(data, lean) {
    const clades = data.clades;
    const cladeById = new Map(clades.map((c) => [c.id, c]));
    const nodes = data.nodes.map((n) => ({ status: "active", results: [], papers: [], ...n }));
    const byId = new Map(nodes.map((n) => [n.id, n]));

    const edges = data.edges.map((e) => ({ ...e, s: byId.get(e.source), t: byId.get(e.target) }));
    const descent = edges.filter((e) => e.type !== "convergent");
    const parents = new Map(nodes.map((n) => [n.id, []]));
    const children = new Map(nodes.map((n) => [n.id, []]));
    const convergent = new Map(nodes.map((n) => [n.id, []]));
    for (const e of descent) {
      parents.get(e.target).push(e);
      children.get(e.source).push(e);
    }
    for (const e of edges.filter((e) => e.type === "convergent")) {
      convergent.get(e.source).push(e.t);
      convergent.get(e.target).push(e.s);
    }

    const cladeColor = (id) => {
      const c = cladeById.get(id).color;
      return isDark() ? d3.color(c).brighter(1.1).formatHex() : c;
    };

    // ---- Layout -----------------------------------------------------------
    const x = d3.scaleLinear().domain(YEAR_STOPS).range(X_STOPS.map((v) => v + LEFT_PAD)).clamp(true);

    const measure = document.createElement("canvas").getContext("2d");
    measure.font = "12px Inter, system-ui, sans-serif";
    const labelWidth = (n) => measure.measureText(n.name).width + 12;

    let bandTop = AXIS_H + 14;
    const bands = [];
    for (const clade of clades) {
      const members = nodes.filter((n) => n.clade === clade.id).sort((a, b) => a.year - b.year);
      const laneEnds = [];
      for (const n of members) {
        n.x = x(n.year);
        let lane = laneEnds.findIndex((end) => end + LABEL_GAP <= n.x);
        if (lane === -1) lane = laneEnds.length;
        laneEnds[lane] = n.x + labelWidth(n);
        n.lane = lane;
      }
      const lanes = Math.max(1, laneEnds.length);
      const height = lanes * LANE_H + BAND_PAD * 2;
      for (const n of members) n.y = bandTop + BAND_PAD + n.lane * LANE_H + LANE_H / 2;
      bands.push({ clade, y: bandTop, height });
      bandTop += height + 6;
    }
    const contentW = X_STOPS[X_STOPS.length - 1] + LEFT_PAD + 180;
    const contentH = bandTop;

    // ---- SVG scaffold -----------------------------------------------------
    const svg = d3.select(chartEl).append("svg").attr("role", "img")
      .attr("aria-label", "Network of mathematical fields over time");
    const world = svg.append("g").attr("class", "world");
    const gBands = world.append("g");
    const gGrid = world.append("g");
    const gEdges = world.append("g");
    const gNodes = world.append("g");
    const gAxis = svg.append("g").attr("class", "axis");
    const gLabels = svg.append("g").attr("class", "band-labels");

    gBands.selectAll("rect").data(bands).join("rect")
      .attr("class", "band")
      .attr("x", 0).attr("width", contentW)
      .attr("y", (b) => b.y).attr("height", (b) => b.height);

    gGrid.selectAll("line").data(TICK_YEARS).join("line")
      .attr("class", "gridline")
      .attr("x1", (y) => x(y)).attr("x2", (y) => x(y))
      .attr("y1", AXIS_H).attr("y2", contentH);

    const edgePath = (e) => {
      const { x: x1, y: y1 } = e.s, { x: x2, y: y2 } = e.t;
      if (e.type === "convergent") {
        // Bow sideways so the arc reads as a link between peers, not descent.
        const mx = (x1 + x2) / 2 + 26, my = (y1 + y2) / 2;
        return `M${x1},${y1} Q${mx + Math.abs(y2 - y1) * 0.15},${my} ${x2},${y2}`;
      }
      const mx = x1 + Math.max(30, (x2 - x1) * 0.5);
      return `M${x1},${y1} C${mx},${y1} ${x2 - Math.max(30, (x2 - x1) * 0.5)},${y2} ${x2},${y2}`;
    };

    const edgeSel = gEdges.selectAll("path").data(edges).join("path")
      .attr("class", (e) => `edge ${e.type}`)
      .attr("d", edgePath);

    const nodeSel = gNodes.selectAll("g").data(nodes, (n) => n.id).join("g")
      .attr("class", (n) => `node ${n.status}`)
      .attr("transform", (n) => `translate(${n.x},${n.y})`)
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (n) => `${n.name}, ${fmtYear(n.year)}`)
      .on("click", (ev, n) => { ev.stopPropagation(); select(n.id, { center: false }); })
      .on("keydown", (ev, n) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(n.id); } });

    nodeSel.filter((n) => n.status === "revived").append("circle").attr("class", "ring").attr("r", 10);
    nodeSel.append("circle").attr("class", "dot").attr("r", 6);
    const label = nodeSel.append("text").attr("x", 10).attr("dy", "0.35em");
    label.append("tspan").text((n) => n.name);
    nodeSel.append("title").text((n) => `${n.name} (${fmtYear(n.year)})`);
    // SVG text only catches clicks on the glyphs themselves, so put a transparent
    // box behind each dot and name: the whole label, gaps included, opens the panel.
    nodeSel.each(function () {
      const box = this.querySelector("text").getBBox();
      const left = -10, right = box.x + box.width + 4;
      d3.select(this).insert("rect", ":first-child")
        .attr("class", "hit")
        .attr("x", left).attr("y", Math.min(-10, box.y - 3))
        .attr("width", right - left).attr("height", Math.max(20, box.height + 6))
        .attr("rx", 4);
    });

    function applyColors() {
      edgeSel.filter((e) => e.type !== "convergent").attr("stroke", (e) => cladeColor(e.s.clade));
      nodeSel.select("circle.dot").attr("fill", (n) => cladeColor(n.clade))
        .attr("stroke", (n) => (n.status === "dormant" ? cladeColor(n.clade) : null));
      nodeSel.select("circle.ring").attr("stroke", (n) => cladeColor(n.clade));
      gLabels.selectAll("text").attr("fill", (b) => cladeColor(b.clade.id));
    }

    // Axis background + sticky band labels (outside the zoomed group).
    gAxis.append("rect").attr("class", "axis-bg").attr("height", AXIS_H);
    gAxis.append("line").attr("class", "axis-line").attr("y1", AXIS_H).attr("y2", AXIS_H);
    const tickG = gAxis.append("g");
    const labelG = gLabels.selectAll("g").data(bands).join("g");
    labelG.append("rect").attr("class", "band-label-bg").attr("x", 6).attr("height", 22).attr("rx", 4);
    labelG.append("text").attr("class", "band-label").attr("x", 12).attr("dy", "1.05em")
      .text((b) => b.clade.name);
    labelG.each(function () {
      const w = this.querySelector("text").getComputedTextLength();
      this.querySelector("rect").setAttribute("width", w + 12);
    });
    applyColors();

    // ---- Zoom & pan -------------------------------------------------------
    let transform = d3.zoomIdentity;
    const zoom = d3.zoom().scaleExtent([0.2, 3]).on("zoom", (ev) => {
      transform = ev.transform;
      world.attr("transform", transform);
      drawOverlay();
    });
    svg.call(zoom).on("dblclick.zoom", null);
    svg.on("click", () => select(null));

    function drawOverlay() {
      const w = chartEl.clientWidth;
      gAxis.select(".axis-bg").attr("width", w);
      gAxis.select(".axis-line").attr("x2", w);
      // Drop ticks that would crowd their left neighbour at this zoom level.
      let last = -Infinity;
      const visible = [];
      for (const y of TICK_YEARS) {
        const px = transform.applyX(x(y));
        if (px - last >= 52) { visible.push({ y, px }); last = px; }
      }
      tickG.selectAll("g.tick").data(visible, (d) => d.y).join(
        (enter) => {
          const g = enter.append("g").attr("class", "tick");
          g.append("line").attr("y1", AXIS_H - 6).attr("y2", AXIS_H);
          g.append("text").attr("y", AXIS_H - 12).attr("text-anchor", "middle").text((d) => tickLabel(d.y));
          return g;
        }
      ).attr("transform", (d) => `translate(${d.px},0)`);
      labelG.attr("transform", (b) => `translate(0,${Math.max(AXIS_H + 4, transform.applyY(b.y) + 6)})`)
        .attr("display", (b) => (transform.applyY(b.y + b.height) < AXIS_H + 20 ? "none" : null));
    }

    function fit(duration = 0) {
      const w = chartEl.clientWidth, h = chartEl.clientHeight;
      // Fit every clade row vertically; the timeline scrolls horizontally.
      const k = Math.max(0.45, Math.min((h - AXIS_H) / (contentH - AXIS_H), 1));
      const t = d3.zoomIdentity.translate(Math.max(0, (w - contentW * k) / 2), AXIS_H * (1 - k)).scale(k);
      (duration ? svg.transition().duration(duration) : svg).call(zoom.transform, t);
    }

    function centerOn(n) {
      const w = chartEl.clientWidth, h = chartEl.clientHeight;
      const k = Math.max(transform.k, 0.9);
      const panelW = !panel.hidden && w > 720 ? 380 : 0;
      const visibleH = w > 720 ? h : h * 0.45;
      const t = d3.zoomIdentity
        .translate((w - panelW) / 2 - n.x * k, AXIS_H + (visibleH - AXIS_H) / 2 - n.y * k)
        .scale(k);
      svg.transition().duration(600).call(zoom.transform, t);
    }

    // ---- Selection --------------------------------------------------------
    // All nodes reachable from `start` along descent edges, upward or downward.
    const walk = (start, dir) => {
      const seen = new Set();
      const stack = [start];
      while (stack.length) {
        const id = stack.pop();
        const list = dir === "up" ? parents.get(id) : children.get(id);
        for (const e of list) {
          const next = dir === "up" ? e.source : e.target;
          if (!seen.has(next)) { seen.add(next); stack.push(next); }
        }
      }
      return seen;
    };

    // Shortest descent distance from `start` to every reachable node, with back-pointers.
    const bfs = (start, dir) => {
      const dist = new Map([[start, 0]]);
      const prev = new Map();
      const queue = [start];
      while (queue.length) {
        const id = queue.shift();
        const list = dir === "up" ? parents.get(id).map((e) => e.source) : children.get(id).map((e) => e.target);
        for (const next of list) {
          if (!dist.has(next)) { dist.set(next, dist.get(id) + 1); prev.set(next, id); queue.push(next); }
        }
      }
      return { dist, prev };
    };
    const chainTo = ({ prev }, start, end) => {
      const out = [end];
      while (out[0] !== start) out.unshift(prev.get(out[0]));
      return out;
    };

    // How two fields are related: one descends from the other, or both share an ancestor.
    function relate(a, b) {
      const down = bfs(a, "down");
      if (down.dist.has(b)) return { kind: "descends", chains: [chainTo(down, a, b)] };
      const up = bfs(a, "up");
      if (up.dist.has(b)) return { kind: "ancestor", chains: [chainTo(up, a, b).reverse()] };
      const upB = bfs(b, "up");
      let best = null;
      for (const [id, da] of up.dist) {
        if (!upB.dist.has(id)) continue;
        const score = da + upB.dist.get(id);
        // Prefer the closest shared ancestor; on ties, the most recent one.
        if (!best || score < best.score || (score === best.score && byId.get(id).year > byId.get(best.id).year)) best = { id, score };
      }
      if (!best) return { kind: "unrelated", chains: [] };
      return { kind: "common", via: best.id,
        chains: [chainTo(up, a, best.id).reverse(), chainTo(upB, b, best.id).reverse()] };
    }

    let selected = null;
    let traced = null;
    function select(id, { center = true, updateHash = true } = {}) {
      selected = id && byId.has(id) ? id : null;
      traced = null;
      svg.classed("tracing", false);
      nodeSel.classed("on-path", false);
      edgeSel.classed("on-path", false);
      if (updateHash) {
        history.replaceState(null, "", selected ? `#${selected}` : location.pathname + location.search);
      }
      if (!selected) {
        svg.classed("has-selection", false);
        nodeSel.classed("lit selected", false);
        edgeSel.classed("lit-up lit-down lit-conv", false);
        panel.hidden = true;
        return;
      }
      const anc = walk(selected, "up");
      const desc = walk(selected, "down");
      const conv = new Set(convergent.get(selected).map((n) => n.id));
      svg.classed("has-selection", true);
      nodeSel.classed("selected", (n) => n.id === selected)
        .classed("lit", (n) => n.id === selected || anc.has(n.id) || desc.has(n.id) || conv.has(n.id));
      edgeSel
        .classed("lit-up", (e) => e.type !== "convergent" && (e.target === selected || anc.has(e.target)) && (anc.has(e.source)))
        .classed("lit-down", (e) => e.type !== "convergent" && (e.source === selected || desc.has(e.source)) && desc.has(e.target))
        .classed("lit-conv", (e) => e.type === "convergent" && (e.source === selected || e.target === selected));
      renderPanel(byId.get(selected), anc.size, desc.size);
      closeOverlays();
      if (center) centerOn(byId.get(selected));
    }

    function trace(target, { updateHash = true } = {}) {
      const out = panelBody.querySelector("#trace-result");
      if (!selected || !byId.has(target) || target === selected) {
        traced = null;
        svg.classed("tracing", false);
        nodeSel.classed("on-path", false);
        edgeSel.classed("on-path", false);
        if (out) out.innerHTML = "";
        if (updateHash && selected) history.replaceState(null, "", `#${selected}`);
        return;
      }
      traced = target;
      const r = relate(selected, target);
      const onPath = new Set(r.chains.flat());
      const pairs = new Set(r.chains.flatMap((c) => c.slice(1).map((id, i) => `${c[i]}>${id}`)));
      svg.classed("tracing", r.chains.length > 0);
      nodeSel.classed("on-path", (n) => onPath.has(n.id));
      edgeSel.classed("on-path", (e) => pairs.has(`${e.source}>${e.target}`));
      const a = byId.get(selected), b = byId.get(target);
      const steps = (c) => `${c.length - 1} step${c.length === 2 ? "" : "s"}`;
      const chainHtml = (c) => `<div class="chain">${c.map((id) => chip(byId.get(id))).join('<span class="arrow" aria-hidden="true">→</span>')}</div>`;
      let html;
      if (r.kind === "descends") html = `<p class="trace-say"><b>${esc(b.name)}</b> descends from <b>${esc(a.name)}</b> in ${steps(r.chains[0])}:</p>${chainHtml(r.chains[0])}`;
      else if (r.kind === "ancestor") html = `<p class="trace-say"><b>${esc(a.name)}</b> descends from <b>${esc(b.name)}</b> in ${steps(r.chains[0])}:</p>${chainHtml(r.chains[0])}`;
      else if (r.kind === "common") html = `<p class="trace-say">Neither descends from the other. Their closest shared ancestor is <b>${esc(byId.get(r.via).name)}</b>:</p>${r.chains.map(chainHtml).join("")}`;
      else html = `<p class="trace-say">No line of descent connects these two fields in this dataset.</p>`;
      if (out) out.innerHTML = html + `<button type="button" class="trace-clear">Clear path</button>`;
      if (updateHash) history.replaceState(null, "", `#${selected}~${target}`);
    }

    function chip(n, kind) {
      return `<button type="button" data-id="${n.id}"><span class="sw" style="background:${cladeColor(n.clade)}"></span>` +
        `${esc(n.name)}${kind ? ` <span class="kind">${kind}</span>` : ""}</button>`;
    }

    // Name the kind of link so a search page is never mistaken for the paper itself.
    const linkKind = (url) => {
      const host = new URL(url).hostname;
      if (host.endsWith("wikipedia.org")) return "Wikipedia";
      if (host === "arxiv.org") return "arXiv";
      if (host === "doi.org") return "DOI";
      if (host === "scholar.google.com") return "Scholar search";
      return host.replace(/^www\./, "");
    };
    // Direct links read as solid, search fallbacks as dashed, so the kind shows at a glance.
    const KIND_CLASS = { DOI: "k-direct", arXiv: "k-direct", Wikipedia: "k-about", "Scholar search": "k-search" };
    const paperItem = (p) => {
      const kind = linkKind(p.url);
      return `<li class="paper-branch ${KIND_CLASS[kind] || "k-direct"}">` +
        `<span class="paper-year">${p.year < 0 ? `${-p.year}<small>BCE</small>` : p.year}</span>` +
        `<div class="paper-card"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` +
        `<span class="paper-meta">${esc(p.authors)}<span class="kind-pill">${kind}</span></span></div></li>`;
    };
    // A strip of document "spines" previews the papers while the section is folded.
    const paperSpines = (papers) => papers.map((p) =>
      `<span class="spine ${KIND_CLASS[linkKind(p.url)] || "k-direct"}" title="${esc(p.title)}"></span>`).join("");
    const yearSpan = (papers) => {
      const ys = papers.map((p) => p.year);
      const lo = Math.min(...ys), hi = Math.max(...ys);
      const f = (y) => (y < 0 ? `${-y} BCE` : String(y));
      return lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`;
    };

    // ---- Lean ---------------------------------------------------------------
    const MATHLIB_URL = "https://github.com/leanprover-community/mathlib4";
    const KIND_LABEL = { ai: "AI-generated", automated: "Automated provers", human: "Human-led", benchmark: "Open problems" };
    const projectsFor = (id) => (lean ? lean.projects.filter((p) => p.fields.includes(id)) : []);
    const fmtDate = (iso) => new Date(iso + "T00:00:00Z")
      .toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
    const aiBadge = '<span class="badge ai" title="The commit message credits an AI tool. Lean checked the proof either way.">AI</span>';
    const changeItem = (c, withFields) =>
      `<li><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a>` +
      `<span class="paper-meta">${fmtDate(c.date)}${c.scope ? ` · <code>${esc(c.scope)}</code>` : ""}${c.ai ? " · " + aiBadge : ""}</span>` +
      (withFields ? `<div class="links">${c.fields.slice(0, 6).map((id) => chip(byId.get(id))).join("")}` +
        `${c.fields.length > 6 ? `<span class="more">+${c.fields.length - 6} more</span>` : ""}</div>` : "") + "</li>";
    const projectItem = (p) =>
      `<li><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>` +
      `<span class="badge ${p.kind}">${KIND_LABEL[p.kind] || esc(p.kind)}</span>` +
      `<span class="paper-meta">${esc(p.description)}${p.updated ? ` Updated ${fmtDate(p.updated)}.` : ""}</span></li>`;
    const prefixLink = (prefix) => {
      const name = prefix.replace(/^Mathlib\//, "");
      // A prefix is either a folder or a single .lean file; GitHub redirects /tree/ to /blob/ for files.
      return `<a href="${MATHLIB_URL}/tree/master/${esc(prefix)}" target="_blank" rel="noopener"><code>${esc(name)}</code></a>`;
    };

    function leanSection(n) {
      if (!lean) return "";
      const f = lean.fields[n.id];
      const projects = projectsFor(n.id);
      if (!(f && f.files) && !projects.length) return "";
      let html = `<h3>Formalized in Lean</h3>`;
      if (f && f.files) {
        html += `<p class="lean-summary">${f.files.toLocaleString()} files in mathlib under ${f.prefixes.map(prefixLink).join(", ")}. ` +
          `${f.additions} new result${f.additions === 1 ? "" : "s"} in the last ${lean.window_days} days` +
          `${f.ai_additions ? `, ${f.ai_additions} crediting AI tools` : ""}.</p>`;
        if (f.recent.length) html += `<ul class="papers">${f.recent.map((c) => changeItem(c, false)).join("")}</ul>`;
      }
      if (projects.length) html += `<h3>Lean projects</h3><ul class="papers">${projects.map(projectItem).join("")}</ul>`;
      return html;
    }

    function renderLeanPanel() {
      if (!lean) {
        leanBody.innerHTML = `<h2>Lean formalization</h2><p>No Lean data yet. Run <code>python3 tools/sync_lean.py</code> to fetch it.</p>`;
        return;
      }
      const onlyAI = document.getElementById("lean-ai-only")?.checked ?? false;
      const feed = lean.feed.filter((c) => !onlyAI || c.ai).slice(0, 40);
      const m = lean.mathlib;
      leanBody.innerHTML = `
        <h2>Lean formalization</h2>
        <p class="lean-intro">Every proof in Lean's <a href="${MATHLIB_URL}" target="_blank" rel="noopener">mathlib</a> and in the projects below is checked by Lean's kernel, whoever or whatever wrote it. This page is refreshed daily from GitHub.</p>
        <div class="meta"><span>${m.files.toLocaleString()} mathlib files</span><span>${m.additions.toLocaleString()} new results in ${lean.window_days} days</span><span>${m.ai_additions} credit AI tools</span><span>Updated ${esc(lean.generated.slice(0, 10))}</span></div>
        <h3>AI-generated & automated</h3>
        <ul class="papers">${lean.projects.filter((p) => p.kind === "ai" || p.kind === "automated").map(projectItem).join("")}</ul>
        <h3 class="feed-head">New in mathlib
          <label class="toggle"><input id="lean-ai-only" type="checkbox"${onlyAI ? " checked" : ""}> Only AI-credited</label></h3>
        <ul class="papers">${feed.map((c) => changeItem(c, true)).join("") || "<li>No new results in this window.</li>"}</ul>
        <h3>Human-led projects & open problems</h3>
        <ul class="papers">${lean.projects.filter((p) => p.kind === "human" || p.kind === "benchmark").map(projectItem).join("")}</ul>
        <p class="counts">Only additions of new definitions and theorems are listed; maintenance work is left out. "AI" marks commits whose message credits an AI tool, such as an AI-use disclosure or a co-author line. It is a self-report, not detection.</p>`;
    }

    function closeOverlays() {
      about.hidden = true;
      leanPanel.hidden = true;
      aboutBtn.setAttribute("aria-expanded", "false");
      leanBtn.setAttribute("aria-expanded", "false");
    }

    function toggleOverlay(el, btn) {
      const open = el.hidden;
      select(null);
      closeOverlays();
      if (open) {
        if (el === leanPanel) renderLeanPanel();
        el.hidden = false;
        el.scrollTop = 0;
        btn.setAttribute("aria-expanded", "true");
      }
    }

    // The papers section folds away; remember the reader's choice between fields and visits.
    let papersOpen = false;
    try { papersOpen = localStorage.getItem("papersOpen") === "1"; } catch {}
    panelBody.addEventListener("toggle", (ev) => {
      if (ev.target.id === "papers-nest") {
        papersOpen = ev.target.open;
        try { localStorage.setItem("papersOpen", papersOpen ? "1" : "0"); } catch {}
      } else if (ev.target.id === "roadmap-nest") {
        roadmapOpen = ev.target.open;
        try { localStorage.setItem("roadmapOpen", roadmapOpen ? "1" : "0"); } catch {}
      }
    }, true);

    let roadmapOpen = false;
    try { roadmapOpen = localStorage.getItem("roadmapOpen") === "1"; } catch {}

    // Everything a field builds on, oldest first. Parents precede children in time,
    // so chronological order is also a valid order to learn them in.
    function roadmapSection(n) {
      const { dist } = bfs(n.id, "up");
      dist.delete(n.id);
      if (!dist.size) return "";
      const all = [...dist].map(([id, d]) => ({ n: byId.get(id), d })).sort((x, y) => x.n.year - y.n.year);
      const near = all.filter((x) => x.d <= 2);
      const item = (x) => `<li class="road-step${x.d <= 2 ? "" : " far"}"><span class="paper-year">${x.n.year < 0 ? `${-x.n.year}<small>BCE</small>` : x.n.year}</span>` +
        `<div class="links">${chip(x.n)}<span class="hops" title="Steps back along the lineage">${x.d === 1 ? "direct parent" : `${x.d} steps back`}</span></div></li>`;
      return `<details class="nest" id="roadmap-nest" style="--clade:${cladeColor(n.clade)}"${roadmapOpen ? " open" : ""}>` +
        `<summary><span class="nest-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M3 16.5c3-1 4-4 7-4s4 3 7 2"/><circle cx="3.5" cy="16.5" r="1.5"/><circle cx="16.5" cy="14.5" r="1.5"/><path d="M10 12.5V4m0 0 3 3m-3-3-3 3"/></svg></span>` +
        `<span class="nest-text"><span class="nest-label">Learning roadmap</span><span class="nest-sub">${near.length} close prerequisite${near.length === 1 ? "" : "s"} · ${all.length} in all</span></span>` +
        `<span class="nest-chev" aria-hidden="true"></span></summary>` +
        `<ol class="paper-tree road" data-showing="near">${all.map(item).join("")}</ol>` +
        (all.length > near.length ? `<button type="button" class="road-more">Show all ${all.length} ancestors</button>` : "") +
        `</details>`;
    }

    const traceSection = () => `
        <h3>Trace a path</h3>
        <div class="trace-box">
          <input id="trace-input" type="search" list="node-list" placeholder="Compare with another field…" aria-label="Trace a path to another field" autocomplete="off">
          <div id="trace-result" aria-live="polite"></div>
        </div>`;

    function renderPanel(n, ancCount, descCount) {
      const clade = cladeById.get(n.clade);
      const ps = parents.get(n.id);
      const cs = children.get(n.id);
      const cv = convergent.get(n.id);
      const statusText = { dormant: "Dormant lineage", revived: "Revived lineage" }[n.status];
      panelBody.innerHTML = `
        <h2>${esc(n.name)}</h2>
        <div class="meta">
          <span>${fmtYear(n.year)}</span>
          <span class="chip"><span class="sw" style="background:${cladeColor(n.clade)}"></span>${esc(clade.name)}</span>
          ${n.msc ? `<span title="Mathematics Subject Classification 2020">MSC ${esc(n.msc)}</span>` : ""}
          ${statusText ? `<span class="status">${statusText}</span>` : ""}
        </div>
        <p>${esc(n.description)}</p>
        ${n.results.length ? `<h3>Key results</h3><ul>${n.results.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
        ${n.papers.length ? `<details class="nest" id="papers-nest" style="--clade:${cladeColor(n.clade)}"${papersOpen ? " open" : ""}>` +
          `<summary><span class="nest-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M6 2.5h6l4 4v11H6z"/><path d="M12 2.5v4h4"/><path d="M3.5 5v12.5H13"/></svg></span>` +
          `<span class="nest-text"><span class="nest-label">Key papers</span><span class="nest-sub">${n.papers.length} work${n.papers.length === 1 ? "" : "s"} · ${yearSpan(n.papers)}</span></span>` +
          `<span class="nest-spines" aria-hidden="true">${paperSpines(n.papers)}</span>` +
          `<span class="nest-chev" aria-hidden="true"></span></summary>` +
          `<ol class="paper-tree">${n.papers.map(paperItem).join("")}</ol></details>` : ""}
        ${roadmapSection(n)}
        ${leanSection(n)}
        ${ps.length ? `<h3>${ps.length > 1 ? "Hybrid of" : "Descends from"}</h3><div class="links">${ps.map((e) => chip(e.s)).join("")}</div>` : ""}
        ${cv.length ? `<h3>Independently found alongside</h3><div class="links">${cv.map((m) => chip(m)).join("")}</div>` : ""}
        ${cs.length ? `<h3>Gave rise to</h3><div class="links">${cs.map((e) => chip(e.t, e.type === "merges" ? "hybrid" : "")).join("")}</div>` : ""}
        ${traceSection()}
        <div class="counts">${ancCount} ancestor${ancCount === 1 ? "" : "s"} · ${descCount} descendant${descCount === 1 ? "" : "s"}</div>`;
      panel.hidden = false;
      panel.scrollTop = 0;
    }

    for (const el of [panelBody, leanBody]) {
      el.addEventListener("click", (ev) => {
        const b = ev.target.closest("button[data-id]");
        if (b) select(b.dataset.id);
      });
    }
    panelBody.addEventListener("click", (ev) => {
      if (ev.target.closest(".trace-clear")) {
        trace(null);
        const input = panelBody.querySelector("#trace-input");
        if (input) input.value = "";
      } else if (ev.target.closest(".road-more")) {
        const list = panelBody.querySelector(".paper-tree.road");
        const showAll = list.dataset.showing === "near";
        list.dataset.showing = showAll ? "all" : "near";
        ev.target.textContent = showAll ? "Show close prerequisites only" : `Show all ${list.children.length} ancestors`;
      }
    });
    const runTrace = () => {
      const input = panelBody.querySelector("#trace-input");
      const n = input && findNode(input.value);
      if (n) { input.value = n.name; trace(n.id); }
    };
    panelBody.addEventListener("change", (ev) => { if (ev.target.id === "trace-input") runTrace(); });
    panelBody.addEventListener("keydown", (ev) => {
      if (ev.target.id === "trace-input" && ev.key === "Enter") { ev.preventDefault(); runTrace(); }
    });
    leanBody.addEventListener("change", (ev) => { if (ev.target.id === "lean-ai-only") renderLeanPanel(); });

    // ---- Controls ---------------------------------------------------------
    document.getElementById("node-list").innerHTML = nodes
      .slice().sort((a, b) => a.name.localeCompare(b.name))
      .map((n) => `<option value="${esc(n.name)}"></option>`).join("");

    const findNode = (q) => {
      q = q.trim().toLowerCase();
      if (!q) return null;
      return nodes.find((n) => n.name.toLowerCase() === q) ||
        nodes.find((n) => n.name.toLowerCase().startsWith(q)) ||
        nodes.find((n) => n.name.toLowerCase().includes(q) || n.description.toLowerCase().includes(q));
    };
    // Search names first, then key results, papers and descriptions, and say what matched.
    const searchBox = document.getElementById("search-results");
    const index = nodes.flatMap((n) => [
      { n, kind: "name", text: n.name, weight: 3 },
      ...n.results.map((r) => ({ n, kind: "Result", text: r, weight: 2 })),
      ...n.papers.map((p) => ({ n, kind: "Paper", text: `${p.title} (${p.authors})`, weight: 1.5 })),
      { n, kind: "About", text: n.description, weight: 1 },
    ]);
    const snippet = (text, q) => {
      const i = text.toLowerCase().indexOf(q);
      const from = Math.max(0, i - 30), to = Math.min(text.length, i + q.length + 40);
      return (from ? "…" : "") + esc(text.slice(from, i)) + `<mark>${esc(text.slice(i, i + q.length))}</mark>` +
        esc(text.slice(i + q.length, to)) + (to < text.length ? "…" : "");
    };
    let hits = [], active = -1;
    function runSearch() {
      const q = search.value.trim().toLowerCase();
      if (q.length < 2) { searchBox.hidden = true; hits = []; return; }
      const best = new Map();
      for (const e of index) {
        const t = e.text.toLowerCase();
        const at = t.indexOf(q);
        if (at < 0) continue;
        const score = e.weight * (at === 0 ? 2 : 1) + (e.kind === "name" && t === q ? 10 : 0);
        const cur = best.get(e.n.id);
        if (!cur || score > cur.score) best.set(e.n.id, { ...e, score });
      }
      hits = [...best.values()].sort((a, b) => b.score - a.score || a.n.year - b.n.year).slice(0, 8);
      active = hits.length ? 0 : -1;
      searchBox.innerHTML = hits.length ? hits.map((h, i) =>
        `<li role="option" id="hit-${i}" data-id="${h.n.id}"${i === active ? ' aria-selected="true"' : ""}>` +
        `<span class="sw" style="background:${cladeColor(h.n.clade)}"></span><span class="hit-text"><b>${h.kind === "name" ? snippet(h.n.name, q) : esc(h.n.name)}</b>` +
        `${h.kind === "name" ? "" : `<small><span class="hit-kind">${h.kind}</span> ${snippet(h.text, q)}</small>`}</span>` +
        `<span class="hit-year">${fmtYear(h.n.year)}</span></li>`).join("")
        : `<li class="empty">No field, result or paper matches “${esc(search.value.trim())}”.</li>`;
      searchBox.hidden = false;
      search.setAttribute("aria-expanded", "true");
    }
    const pick = (id) => { searchBox.hidden = true; search.setAttribute("aria-expanded", "false"); search.value = byId.get(id).name; select(id); };
    search.addEventListener("input", runSearch);
    search.addEventListener("focus", runSearch);
    search.addEventListener("keydown", (ev) => {
      if (searchBox.hidden || !hits.length) return;
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        active = (active + (ev.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
        searchBox.querySelectorAll("li").forEach((li, i) => li.toggleAttribute("aria-selected", i === active));
        search.setAttribute("aria-activedescendant", `hit-${active}`);
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        pick(hits[Math.max(active, 0)].n.id);
      }
    });
    searchBox.addEventListener("mousedown", (ev) => {
      const li = ev.target.closest("li[data-id]");
      if (li) { ev.preventDefault(); pick(li.dataset.id); }
    });
    search.addEventListener("blur", () => { searchBox.hidden = true; search.setAttribute("aria-expanded", "false"); });

    const legend = document.querySelector(".legend");
    const legendBtn = document.getElementById("legend-toggle");
    const setLegend = (open) => {
      legend.classList.toggle("collapsed", !open);
      legendBtn.setAttribute("aria-expanded", String(open));
      legendBtn.textContent = open ? "Hide" : "Legend";
      try { localStorage.setItem("legendOpen", open ? "1" : "0"); } catch {}
    };
    let legendOpen = true;
    try { legendOpen = localStorage.getItem("legendOpen") !== "0"; } catch {}
    setLegend(legendOpen);
    legendBtn.addEventListener("click", () => setLegend(legend.classList.contains("collapsed")));

    showConv.addEventListener("change", () => svg.classed("hide-convergent", !showConv.checked));
    document.getElementById("reset").addEventListener("click", () => { select(null); search.value = ""; fit(500); });
    document.querySelectorAll(".panel-close").forEach((b) => b.addEventListener("click", () => {
      if (b.closest("#about, #lean")) closeOverlays();
      else select(null);
    }));
    aboutBtn.addEventListener("click", () => toggleOverlay(about, aboutBtn));
    leanBtn.addEventListener("click", () => toggleOverlay(leanPanel, leanBtn));
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        if (!searchBox.hidden) { searchBox.hidden = true; return; }
        select(null); closeOverlays();
      }
    });
    // Links look like #field or #field~other (a traced path).
    const openHash = () => {
      const [a, b] = decodeURIComponent(location.hash.slice(1)).split("~");
      if (a === selected && b === traced) return;
      select(a, { updateHash: false });
      if (selected && b) {
        trace(b, { updateHash: false });
        const input = panelBody.querySelector("#trace-input");
        if (input && byId.has(b)) input.value = byId.get(b).name;
      }
    };
    window.addEventListener("hashchange", openHash);
    window.addEventListener("resize", drawOverlay);
    darkQuery.addEventListener("change", applyColors);

    fit();
    if (location.hash.length > 1) openHash();
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
