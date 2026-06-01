# scripts/

Operational tools, benches, and verify probes for Strand. Run from the repo
root with `bun run scripts/<name>.ts`. Most browser probes assume a dev
server at `localhost:3000` is already up (`bun run dev`); a few are pure
file/DB checks that need no server.

## Maintenance

| Script | Purpose | Needs dev server? |
|--------|---------|-------------------|
| `check-schema.ts` | One-shot schema sanity (table list, row counts, schema-vs-migration drift) | no |
| `wipe-batch.ts` | Drop `export_batches` for the local tenant + null out `people.source_batch_id` so a re-ingest exercises the full pipeline | no |
| `ingest-cli.ts` | Run `ingestLinkedInExport` on a `.zip` from disk — useful when the upload route is broken or for CI-style bulk ingest | no |
| `derive-cli.ts` | Rebuild `derived_edges` for the local tenant from scratch (idempotent — clear-then-rebuild). Hook this when positions change outside the normal ingest flow | no |
| `repair-owner-orphans.ts` | One-shot recovery for tenants that suffered the pre-v0.4.2 owner-rename orphaning bug — rewrites stranded FKs in connections / positions / manual_edges / messages onto the current `tenants.ownerPersonId`, re-derives shared-employer edges, then deletes the stranded people row. Default DRY-RUN; pass `--apply` to mutate | no |
| `sample-edges.ts` | Quick DB sample of derived edges (kinds, confidences, JSON evidence) for a sanity glance | no |

## Isolation gates (v0.3.3+)

| Script | Purpose | Needs dev server? |
|--------|---------|-------------------|
| `check-isolation.ts` | Run all three messages-category isolation probes (ISC-265 JS-import + ISC-289 SQL-keyword + ISC-301-extended ORM-symbol/alias-import). Exit 0 on clean, 1 on any violation, with file:line of each offending hit | no |
| `test-alias-probe.ts` | Self-test the ISC-301 alias-import regex against 3 violating + 3 benign fixtures. Loud failure if the regex stops distinguishing | no |

## Performance benches (v0.3.4)

| Script | Purpose | Needs dev server? |
|--------|---------|-------------------|
| `bench-graph.ts` | Time `assembleNetworkGraph()` end-to-end (5 runs × 2 filter scenarios) — direct SQL+composition path, no Next.js overhead | no |
| `bench-segments.ts` | Per-SQL-segment timing inside `assembleNetworkGraph` (candidates UNION, employer, people, derived edges). Useful when a future regression returns — localise which segment got slower | no |
| `verify-graph-perf.ts` | Equivalence check — every non-owner graph node's `company` matches a correlated-subquery probe with the same ORDER BY chain + deterministic tiebreaker (`po.id ASC`). Run after touching the employer-lookup query | no |

## Browser verify probes

Each runs a Playwright Firefox pass against `localhost:3000`, captures
screenshots to `/tmp/strand-verify-<slug>/`, and exits non-zero on any
assertion failure or `pageerror` / non-localhost request.

| Script | Covers | When to run |
|--------|--------|-------------|
| `verify-ui.ts` | Generic smoke (homepage + nav) | quick sanity after a UI tweak |
| `verify-upload-flow.ts` | `/upload` happy + duplicate panels via a real upload | after touching ingest or `/upload` |
| `verify-w3.ts` | W3 surfaces: `/people`, `/companies`, person detail, manual edges API | after touching people/companies routes or `manualEdges` |
| `verify-w4.ts` | W4: synthesised positions on `/companies/[id]`, derived-edges section on `/people/[id]`, profile clean, derived UI separate from manual | after touching positions or `derivedEdges` |
| `verify-w5.ts` | W5a: `/queries/at-company` across param combos + `/api/bookmarks` POST/DELETE | after touching at-company or bookmarks |
| `verify-w5b.ts` | W5b: `/queries/worked-with`, `/queries/by-year`, `/queries/reach` happy + sad paths + bookmark round-trip on each URL shape | after touching any /queries route |
| `verify-w6.ts` | `/graph` renders, Cytoscape mounts, ≥100 visible nodes on real data, bookmark for `/graph` | after touching `assembleNetworkGraph` or `GraphCanvas` |
| `verify-w7.ts` | Release artefacts on disk + content sanity (README, LICENSE, Dockerfile, CONTRIBUTING). No server needed | before cutting a release |
| `verify-v030b.ts` | v0.3.0-B Messages UI: section on `/people/[id]`, last-contact column on `/people`, `?sort=last_contact` ordering, empty-state stats row | after touching `/people` or `/people/[id]` |
| `verify-v030c.ts` | v0.3.0-C → v0.3.3 warm-path on `/queries/reach/[id]`: three-button sort (Epistemic ↔ Warmth ↔ Mutuality), aria-pressed sum-is-1, warmth + mutuality pills, back-button + default-elision + epistemic-bookmark cases. 34/34 assertions | after touching `/queries/reach` or `reach.ts` |
| `screenshots.ts` | Capture the six README screenshots to `docs/screenshots/` | after a UI change that affects the README's visible surfaces |

## Conventions

- All probes use `data-testid` selectors — never visible text or CSS classes (which churn) — so they survive design-system migrations like v0.2.0.
- Exit code 0 = clean pass, 1 = at least one assertion failed. Stderr carries the failure summary.
- Screenshots land in `/tmp/strand-verify-<slug>/` (transient — gitignored by virtue of being outside the repo).
- The `verify-w[3-7]` series is the historical W-week baseline; the `verify-v03*` series is per-slice. New slices add a `verify-v<slug>.ts` rather than mutating the W files.
