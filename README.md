# Phylomathematics

The evolutionary history of mathematics, drawn as a phylogenetic network.

Math doesn't evolve as a strict tree, so this site doesn't draw one:

- **Hybridization**: algebraic geometry, analytic number theory and algebraic topology each have several parents.
- **Convergent evolution**: Newton and Leibniz both found calculus; Bolyai and Lobachevsky both found non-Euclidean geometry; Church and Turing both defined computability; the Maya and Indian mathematicians each invented zero.
- **Dormancy and revival**: projective geometry slept from Desargues to Poncelet; invariant theory went quiet after Hilbert and returned as geometric invariant theory.

Time runs left to right on a compressed axis from Babylonian arithmetic to the present. Rows group 107 fields into nine broad clades (Number, Algebra, Geometry, Topology, Analysis, Applied, Chance, Discrete, Foundations). Click a field to see its description, key results and MSC2020 code, with its full ancestry highlighted. Links are shareable: `/#algebraic_geometry`.

## Run locally

It's a static site with no build step. Serve the folder (opening `index.html` directly won't work because the page fetches its data):

```sh
python3 -m http.server
# open http://localhost:8000
```

## Data

Everything lives in [`data/nodes.json`](data/nodes.json).

```jsonc
{
  "clades": [{ "id": "geometry", "name": "Geometry", "color": "#0369a1" }],
  "nodes": [{
    "id": "riemannian_geometry",
    "name": "Riemannian geometry",
    "year": 1854,                 // negative = BCE
    "clade": "geometry",
    "msc": "53B20",               // MSC2020 code (optional)
    "status": "active",           // active | dormant | revived (optional)
    "description": "…",
    "results": ["Riemann curvature tensor", "…"],
    "papers": [{                  // optional
      "title": "Ueber die Hypothesen, welche der Geometrie zu Grunde liegen",
      "authors": "Bernhard Riemann",
      "year": 1854,
      "url": "https://…"          // DOI or arXiv when known; otherwise Wikipedia or a Scholar search
    }]
  }],
  "edges": [
    { "source": "bolyai", "target": "riemannian_geometry", "type": "merges" }
  ]
}
```

Paper links are a mix. A few go straight to the paper (DOI, arXiv). Many go to a Wikipedia article about the work, through Wikipedia's "Go" search so a renamed article still resolves. The rest are Google Scholar searches for the exact title. The panel labels each link with its kind. Replacing Scholar searches with DOIs is an easy way to contribute.

Edge types:

| type | meaning |
| --- | --- |
| `inherits` | the target's only parent |
| `merges` | one of several parents of a hybrid field |
| `convergent` | the two nodes were found independently; not descent |

After changing anything in `css/` or `js/`, run `python3 tools/bump_version.py` so visitors get the new files instead of cached ones (CI checks this).

Before committing, run the validator. It checks for unknown IDs, cycles, parents younger than children, and `inherits`/`merges` labels that don't match the parent count. CI runs it on every push.

```sh
python3 tools/validate.py
```

## Lean formalization

Each field links to where it lives in [Lean's mathlib](https://github.com/leanprover-community/mathlib4) and to Lean projects that formalize it, including AI-generated ones such as Math Inc's strong prime number theorem (Gauss) and Harmonic's Aristotle solutions to IMO 2025. The **Lean** button opens a feed of recent mathlib changes, filterable to those whose commit message credits an AI tool.

- `data/lean-map.json` is hand-curated: mathlib folders per field, plus the list of external projects. Add a new AI-proof repository by adding one entry to `projects` (`kind` is `ai`, `automated`, `human` or `benchmark`).
- `tools/sync_lean.py` reads the map, clones mathlib (history only, no file contents) and each project, and writes `data/lean.json`.
- `.github/workflows/sync-lean.yml` runs the sync daily and commits the result. Run it by hand from the Actions tab with "Run workflow".

The "AI" flag is a self-report: it means the commit message credits an AI tool (an AI-use disclosure or a co-author line). Lean checks every proof the same way either way.

## Deploy

**GitHub Pages:** go to Settings → Pages, set Source to "Deploy from a branch", and choose `main` / root. The `.nojekyll` file makes Pages serve the files exactly as they are.

**Custom domain:** buy `phylomathematics.com` (or `.org`) at a registrar, then:

1. In Settings → Pages → Custom domain, enter the domain. This commits a `CNAME` file.
2. At the registrar, add DNS records:
   - apex: `A` records to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `www`: `CNAME` to `<your-user>.github.io`
3. Once the certificate is issued, tick "Enforce HTTPS".

Cloudflare Pages or Netlify also work: connect the repo with no build command and the output directory set to `/`.

## Roadmap

- MSC2020 view: show the subject classification as a radial tree next to the descent network, to compare classification with ancestry.
- Scale past hand-curation with Wikidata relations.
- Infer a tree of fields from Lean mathlib's dependency graph (distance matrix → neighbor-joining) and compare it with the historical one.
- An optional people layer from the Mathematics Genealogy Project (check their terms before reusing the data).
