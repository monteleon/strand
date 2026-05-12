# Strand

> Your professional network, your data. Self-hostable. Local-first.

Strand ingests your LinkedIn data export and lets you query your professional
network — who you know at X, who has worked with whom, who is closest to
person Y — without anything leaving your machine.

**Status:** v0.0.0 — skeleton. Targeting v0.1.0 by end of June 2026.
**Visibility:** private until v0.1.0; public release at v0.1.0.

## Why this exists

LinkedIn lets you see your network through its UI, on its terms. Strand is the
opposite posture: your network sits in a SQLite file on your machine, and you
query it however you like — through the web UI, through SQL, or by exporting
slices.

## The load-bearing constraint

The LinkedIn data export contains your **first-degree connections only**. It
does **not** export how those connections are connected to each other —
LinkedIn has never exposed the second-degree graph and almost certainly never
will.

Strand derives second-degree signal from what it *can* see:

| Signal | Strength | Interpretation |
| --- | --- | --- |
| Shared employer + overlapping employment dates | strong | They almost certainly worked together |
| Shared employer, non-overlapping dates | weak | They may have heard of each other |
| Connection-date cluster (you connected with both around the same window) | very weak | You probably met them at the same event |

Edges are stored in `derived_edges` with a `confidence` score and an
`evidence_json` payload you can inspect.

## Quick start (self-host)

Prereqs: [Bun](https://bun.sh) (≥1.3).

```bash
git clone <repo-url> strand
cd strand
bun install
bun run db:generate     # generate the initial Drizzle migration
bun run db:migrate      # apply the migration; creates data/strand.db
bun dev                 # http://localhost:3000
```

Then in the browser:

1. Request your LinkedIn data export at [linkedin.com/psettings/member-data](https://www.linkedin.com/psettings/member-data) — it arrives by email within ~24 hours.
2. Open Strand, go to **Upload**, drop the `.zip` in.
3. Browse **People**, **Companies**, **Queries**, **Graph**.

Strand is single-tenant by default. Every row carries a `tenant_id` so a
multi-tenant fork is a one-pass migration when/if it ships.

## Data lives in one place

The whole database is one file: `data/strand.db`. To back up: copy it. To wipe
and re-ingest: delete it and re-run `bun run db:migrate`. Nothing leaves your
machine in normal operation.

## Roadmap

| Wk | Goal | What lands |
| --- | --- | --- |
| W1 | Skeleton | This. Next.js + Bun + SQLite + Drizzle wired up. |
| W2 | Ingest | LinkedIn `.zip` parser. Drag-drop upload. Idempotent re-import. |
| W3 | Browse | People + companies list / detail pages. Filter and search. |
| W4 | Derive | Shared-employer + overlap detection. Confidence scoring. |
| W5 | Query | Saved business questions answered without SQL. |
| W6 | Visualise | Cytoscape graph view, clusterable. |
| W7 | Polish & ship | README, screenshots, v0.1.0 release. Repo flips to public. |
| W8 | Buffer | Slack week or scaffold the multi-tenant fork. |

## Stack

- **Runtime:** [Bun](https://bun.sh)
- **App framework:** Next.js 14 (App Router) + TypeScript
- **Database:** SQLite via [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)
- **ORM / migrations:** [Drizzle](https://orm.drizzle.team)
- **UI:** Tailwind + shadcn-style component primitives
- **Graph viz:** [Cytoscape.js](https://js.cytoscape.org)

## Privacy posture

- No telemetry. No analytics. No outbound network calls in normal operation.
- The `data/` directory is gitignored.
- LinkedIn `.zip` uploads land in `data/uploads/` (also gitignored) and are
  parsed in-process; nothing is forwarded anywhere.

## License

Not yet licensed. License will be set when the repo flips to public at v0.1.0.

## Project plan

The full plan — architecture rationale, schema design, phased build,
verification approach — lives outside the repo at
`Plans/swirling-floating-ripple.md`.
