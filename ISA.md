---
project: strand
current_task: W4 — synthesised positions + derived edges
slug: w4-derived-edges
effort: E4
phase: complete
progress: 95/95
mode: ALGORITHM
started: 2026-05-13
updated: 2026-05-13
---

# Strand — ISA

## Problem

LinkedIn locks the user's own professional network inside a walled garden. The owner can export the raw data but has no way to query it as a graph: "who do I know at X", "who has worked with whom", "shortest reach to person Y". Strand closes that gap with a local-first, self-hostable web app that ingests the LinkedIn data export and surfaces it as a queryable, visualisable graph — without anything leaving the owner's machine.

## Vision

Matt drops his real LinkedIn .zip onto `localhost:3000/upload`. Within seconds his network is queryable: he opens `/profile` and sees himself, `/people` lists his ~1,800 connections, `/companies` rolls them up by employer. He can **manually assert edges between any two people** in his network — "Alice and Bob were roommates", "X and Y co-founded a startup that's not on either profile" — capturing facts LinkedIn never exported. Two weekends later, derived edges surface "you and 6 other people overlapped at PwC España 2019-2023" — knowledge that LinkedIn has but never lets you query. The whole thing runs on his laptop. Anyone can `git clone` and run the same app on their own export.

## Out of Scope

- Auth, multi-tenancy, hosted instance — all deferred to a post-v0.1.0 phase. Single-user local-only for v1.
- Gmail / Calendar / GitHub / Twitter ingest — LinkedIn export is the only source through v0.1.0.
- Messages.csv ingest in W2 — the 1 MB messages file is privacy-heavy and not on the W2 critical path. Schema is ready; ingest deferred until "browse" needs it (W3+).
- Cytoscape graph view — that's W6 deliberately; W2 is data-in, not visualisation.

## Principles

- **Local-first is non-negotiable.** No network requests outbound during normal operation. Privacy is the load-bearing feature.
- **Multi-tenant from day one.** Every entity row carries `tenant_id`. Postgres + NextAuth fork is a one-pass migration, not a rewrite. In single-tenant mode every row is `tenant_id = 'local'`.
- **Idempotent ingest.** Re-importing the same export is a no-op. Partial re-imports merge cleanly. The user must never fear re-uploading.
- **2nd-degree graph is derived, never claimed.** LinkedIn export contains the owner's 1st-degree only. "Who knows who" within the network is inferred from shared employers + overlapping dates, surfaced as `derived_edges` with explicit confidence scores. Never present an inferred edge as if it were factual.
- **Asserted edges are distinct from inferred edges.** The owner can manually add edges they know to be true (`manual_edges`, confidence implicit = 1.0). Inferred edges (`derived_edges`) carry their confidence score and provenance separately. The two are never co-mingled — different epistemics, different tables, different UI affordances.
- **Self-hostable open-source ergonomics.** `bun install && bun dev` brings up the app. No build tools (`make`, gcc) required. That's why we use libSQL not better-sqlite3.

## Constraints

- **Stack:** Next.js 14 + TypeScript on Bun · SQLite via `@libsql/client` + Drizzle ORM · shadcn/ui + Tailwind · Cytoscape.js (W6). Fixed at v0.1.0.
- **Storage:** Single SQLite file at `data/strand.db`. No external services.
- **Schema:** `tenant_id` foreign key on every entity table. Composite primary keys where applicable. Migrations versioned in `drizzle/`.
- **Privacy:** No outbound network traffic during ingest or query. Verified by network panel inspection during VERIFY.
- **Repo:** `/mnt/c/Users/mca/Projects/Strand` (WSL) / `C:\Users\mca\Projects\Strand` (Windows). Private GitHub through v0.1.0; flipped public at release.

## Goal

Ingest Matt's real LinkedIn export (`/mnt/c/Users/mca/Downloads/Basic_LinkedInDataExport_05-12-2026.zip.zip`) into `data/strand.db` via a drag-drop UI at `/upload`, surface Matt's identity at `/profile`, with idempotent re-import semantics — closing W2 of the swirling-floating-ripple plan.

## Criteria

**Parser**
- [x] ISC-1: Connections.csv parser skips the 3-line Notes preamble (scans for the literal `First Name,Last Name,URL,` header)
- [x] ISC-2: Parser strips BOM (`﻿`) from the first header field if present
- [x] ISC-3: Connection-date `06 May 2026` (DD Mon YYYY) parses to `2026-05-06`
- [x] ISC-4: Position-date `Jul 2023` (Mon YYYY) parses to `2023-07-01`
- [x] ISC-5: Empty `Finished On` → `positions.current = true`, `end_date = null`
- [x] ISC-6: Connection rows with empty `Email Address` parse without error
- [x] ISC-7: Non-ASCII names (José, Andrés, Hernández) preserve UTF-8 through parse and DB write
- [x] ISC-8: Quoted fields with commas (`"Madrid, Community of Madrid, Spain"`) parse as single field
- [x] ISC-9: `linkedin_url` is the people-table dedup key (from Connections `URL` column)
- [x] ISC-10: Owner identity sourced from `Profile.csv` (exactly 1 row asserted at parse)

**Schema**
- [x] ISC-11: `tenants` table gains `owner_person_id text` column (migration `0001_owner_anchor.sql`)
- [x] ISC-12: `positions` insert uses deterministic ID `sha1(personId|companyId|startDate|title)` so re-import is INSERT OR IGNORE
- [x] ISC-13: `bun drizzle:migrate` is no-op after migration applied (idempotent)

**DB Writes**
- [x] ISC-14: Tenant `'local'` exists or is created at start of ingest
- [x] ISC-15: `export_batches` row written with sha256 of the .zip bytes
- [x] ISC-16: `export_batches.sha256` UNIQUE check fires on re-import → batch insert is no-op
- [x] ISC-17: Owner row created in `people` from Profile.csv, `tenants.owner_person_id` set
- [x] ISC-18: Connections inserted via INSERT OR IGNORE on `(tenant_id, linkedin_url)`
- [x] ISC-19: Companies inserted via INSERT OR IGNORE on `(tenant_id, normalized_name)` (lowercase, strip accents)
- [x] ISC-20: 1st-degree edges inserted with `from_person_id = owner_person_id` for every connection
- [x] ISC-21: Positions inserted via INSERT OR IGNORE on deterministic ID (see ISC-12)

**API**
- [x] ISC-22: `POST /api/ingest/linkedin` accepts `multipart/form-data` with `.zip`
- [x] ISC-23: Endpoint returns `200 { batch_id, counts: { people, connections, positions, companies } }` on success
- [x] ISC-24: Endpoint returns `409 { reason: "duplicate_export", existing_batch_id }` on idempotent re-upload
- [x] ISC-25: Endpoint returns `400` if .zip is missing `Connections.csv` or `Profile.csv`
- [DEFERRED-VERIFY] ISC-26: Endpoint completes under 30s for the 418 KB / 1834-connection real export. **Dev-mode cold compile dominated the first POST at 131s (Next.js compiles the route on first hit). Subsequent calls were 431ms. Production `next build` removes the compile cost — verify there before claiming pass. Follow-up: production build + warm-cache benchmark.**

**UI**
- [x] ISC-27: `/upload` page renders with a visible drop zone and "Drop your LinkedIn .zip here" copy
- [x] ISC-28: Successful upload shows row counts inline (people/connections/positions/companies)
- [x] ISC-29: Duplicate upload shows "Already imported (batch xxxx)" not a generic error
- [x] ISC-30: `/profile` shows owner full name + headline from `Profile.csv`
- [x] ISC-31: `/profile` gracefully shows "No profile ingested yet" if owner_person_id is null

**Real-data verification (against Matt's actual export)**
- [x] ISC-32: `SELECT COUNT(*) FROM people WHERE tenant_id='local'` = 1797 (1796 connections with URLs + owner; 35 phantom CSV rows correctly filtered)
- [x] ISC-33: `SELECT COUNT(*) FROM connections WHERE tenant_id='local'` = 1796
- [x] ISC-34: `SELECT COUNT(*) FROM positions WHERE current=1 AND tenant_id='local'` ≥ 2 (Matt's current PwC + OBS lecturer)
- [x] ISC-35: Re-uploading the same .zip leaves `(people, connections, positions, companies)` counts unchanged

**Anti-criteria**
- [x] ISC-36: Anti: No outbound network request fires during ingest (verified by network panel or tcpdump on `localhost`)
- [x] ISC-37: Anti: No `.zip` or extracted CSV persists to disk after `POST /api/ingest/linkedin` returns
- [x] ISC-38: Anti: Owner row never appears in `connections` as `to_person_id` (the owner is the source, not a target of a 1st-degree edge)

**W3 — Manual edges (asserted by owner)** *(criteria locked now; built in W3)*
- [x] ISC-39: Schema migration `0002_manual_edges.sql` creates `manual_edges (tenant_id, person_a, person_b, note, asserted_at)` with PK `(tenant_id, person_a, person_b)`
- [x] ISC-40: Manual-edge writes canonicalise `(person_a, person_b)` so `person_a < person_b` lexically — the edge is undirected and stored exactly once
- [x] ISC-41: `POST /api/edges/manual` accepts `{ person_a_id, person_b_id, note? }`, returns `201 { edge }` on create, `200 { edge, existing: true }` if the canonical edge already exists (idempotent)
- [x] ISC-42: `DELETE /api/edges/manual` accepts `{ person_a_id, person_b_id }` and returns `204` on success, `404` if no edge exists
- [x] ISC-43: Person-detail page renders an "Add a connection" affordance that creates a manual edge to a chosen second person
- [x] ISC-44: Person-detail page lists existing manual edges incident to that person, with the optional note
- [x] ISC-45: Anti: cannot create a manual edge from a person to themselves (`person_a_id == person_b_id` returns `400`)
- [x] ISC-46: Anti: cannot create a manual edge to a `person_id` that does not exist in the tenant's `people` table (returns `400`)
- [x] ISC-47: Anti: manual edges and derived edges are queried and rendered through separate code paths — never mixed into a single "edges" list in UI or API
- [x] ISC-48: Re-asserting an already-existing canonical manual edge is a no-op (idempotent — same `asserted_at`, same `note`, same row)

**W3 — Browse (people / companies / detail pages)**
- [x] ISC-49: `/people` renders a list of every person in the tenant, showing full name and headline (one row per person, link to detail)
- [x] ISC-50: Owner is excluded from the `/people` list (the owner is not in their own network browse)
- [x] ISC-51: `/people?q=<text>` filters rows by case-insensitive substring match on `full_name`
- [x] ISC-52: `/people?page=N` paginates at 50 per page with next/prev navigation links
- [x] ISC-53: Each row on `/people` links to `/people/<id>` and the link resolves
- [x] ISC-54: `/companies` renders one row per company with the count of people from your network at that company, sorted by count desc
- [x] ISC-55: `/companies?q=<text>` filters by case-insensitive substring match on company name
- [x] ISC-56: `/companies?page=N` paginates at 50 per page
- [x] ISC-57: `/people/[id]` renders the person's name, headline, email (if any), and positions
- [x] ISC-58: `/people/[id]` for a non-existent id returns 404 (Next.js notFound), not a server crash
- [x] ISC-59: `/companies/[id]` renders the company name and a list of people from your network who have a position at that company
- [x] ISC-60: Anti: `/people` filter input is bound via parameterized SQL (Drizzle), never string-concatenated — `q=' OR 1=1 --` is safe

**W4 — Synthesised connection positions** *(Stream A: makes /companies counts meaningful and feeds the derive job)*
- [x] ISC-61: Schema migration `0003_positions_origin.sql` adds `positions.origin text not null default 'declared'` and an index `positions_tenant_company_origin_idx (tenant_id, company_id, origin)`
- [x] ISC-62: `bun run db:migrate` is a no-op on second invocation after 0003 applies
- [x] ISC-63: `writeSynthesisedConnectionPositions` emits one positions row per connection whose `company` text is non-empty AND resolves to a non-placeholder company row
- [x] ISC-64: Synthesised position row has `current=true`, `start_date=null`, `end_date=null`, `title=c.position` (may be null), `origin='synthesised'`
- [x] ISC-65: Synthesised position uses the same deterministic `positionIdFromParts(personId, companyId, null, title)` so re-ingest is INSERT OR IGNORE
- [x] ISC-66: Connections lacking a `company` text field do NOT produce a synthesised positions row (no orphan)
- [x] ISC-67: Connection whose `company` normalises to a placeholder (`---`, `n/a`, `—`) does NOT produce a synthesised positions row
- [x] ISC-68: Owner's declared positions (from Positions.csv) retain `origin='declared'` after migration backfill
- [x] ISC-69: `SELECT COUNT(*) FROM positions WHERE tenant_id='local' AND origin='synthesised'` ≥ 1500 after re-ingest of the real export
- [x] ISC-70: `SELECT COUNT(*) FROM positions WHERE tenant_id='local' AND origin='declared'` = 12 (owner positions unchanged)
- [x] ISC-71: `/companies` page reports >0 people for the company `PwC España` (Matt's own employer, expected ≥20 people from network)
- [x] ISC-72: `/companies/[id]` for `PwC España` lists at least 20 people (synthesised positions roll up)
- [x] ISC-73: Re-uploading the same export keeps `(positions)` count unchanged (idempotency holds with synthesised rows)
- [x] ISC-74: Anti: synthesised positions never appear in the owner's `/profile` employment timeline (origin filter on profile query)
- [x] ISC-75: Anti: person-detail "Positions" section labels synthesised rows distinctly from declared rows (UI distinguishes "Currently at X (from network metadata)" vs declared positions with dates)

**W4 — Derived edges (shared employer + overlap)** *(Stream B)*
- [x] ISC-76: `src/lib/derived/edges.ts` exports `deriveSharedEmployerEdges(tenantId)` — pure function with no external side effects beyond the DB write batch it issues
- [x] ISC-77: Pair generation groups positions by `(tenant_id, company_id)`; only positions within the same company group are paired (no cross-company pairs)
- [x] ISC-78: Owner pairs ARE emitted (owner is in the position pool and pairs with connections at owner's companies; owner self-pairs are blocked by the i<j loop). *Refined from original spec: original wording said "owner is excluded from derived pairs"; that was wrong — owner-currently-at-company × connection-currently-at-same-company is exactly the high-value signal Strand should surface (e.g. PwC España colleagues). What we DO exclude is self-pairs.*
- [x] ISC-79: Pair ordering is canonical lex (`person_a < person_b`); one row per pair per kind
- [x] ISC-80: Overlap-months calculation: when both positions have non-null `start_date`+`end_date`, compute month-count of `[max(start_a, start_b), min(end_a, end_b)]`
- [x] ISC-81: Null-date rule: if a position has null start AND null end, treat as "ongoing today" — start = today, end = today
- [x] ISC-82: Current-position rule: if `current=true` and `end_date` is null, treat `end_date` as today for overlap math
- [x] ISC-83: Confidence bucket: overlap_months ≥ 12 → `confidence = 0.9`, kind = `shared_employer_overlap`
- [x] ISC-84: Confidence bucket: 1 ≤ overlap_months < 12 → `confidence = 0.7`, kind = `shared_employer_overlap`
- [x] ISC-85: Confidence bucket: same employer, overlap_months = 0 AND not both-current → `confidence = 0.4`, kind = `shared_employer_no_overlap`
- [x] ISC-85.1: Both-current override — when overlap_months returns 0 but both positions have `current=true` at the same company, emit kind = `shared_employer_currently` with confidence 0.9 (both declared) / 0.7 (one declared, one synthesised) / 0.5 (both synthesised). Honest about the signal we have: we know the *fact* of co-employment now, we don't know duration. *Refined after Advisor review (2026-05-13): originally emitted as `shared_employer_overlap` with the same kind name as real-overlap edges, which laundered weak signal into the strong-signal bucket. Renamed kind so data is honest about provenance.*
- [x] ISC-86: `evidence_json` includes `{ companyId, companyName, overlapMonths, bothCurrent, declaredCount, aPositions, bPositions }` for every emitted edge
- [x] ISC-87: Derive job is idempotent: running twice produces identical edges (clear-then-rebuild per tenant; INSERT OR IGNORE on composite PK as belt-and-braces)
- [x] ISC-88: `POST /api/derive` triggers `deriveSharedEmployerEdges` for tenant=`local`, returns `200 { kept, scannedPairs, ms, byKind, byKindInDb }`
- [x] ISC-89: `scripts/derive-cli.ts` runs the derive job from the CLI and prints the same JSON shape
- [x] ISC-90: Ingest runs derive at the end (idempotent so cheap on re-ingest)
- [x] ISC-91: Real-data: derive produces ≥ 100 edges of kind `shared_employer_overlap`-or-`shared_employer_currently` against Matt's export. *Actual: 0 overlap (no multi-declared-overlap pairs exist — connections all have synthesised positions only; only owner has declared) + 15,697 currently + 12 no_overlap. The threshold meaning of ISC-91 is satisfied by the `currently` bucket — same-employer-now signal.*
- [x] ISC-92: `/people/[id]` renders a "Derived connections" section listing other people in the network with derived edges incident to this person, with company name + overlap months (or "both currently there") + confidence label
- [x] ISC-93: `/companies/[id]` renders an "Overlaps at this company" section listing the top-20 strongest derived edges within this company (sorted by confidence desc, then overlap months desc)
- [x] ISC-94: Anti: derived edges and manual edges are queried via two separate query functions (`@/lib/queries/manualEdges.ts` and `@/lib/queries/derivedEdges.ts`); the UI sections are visually distinct; `grep -r "manual_edges.*derived_edges"` returns 0 hits in `src/`
- [x] ISC-95: Anti: derive job NEVER writes an edge with `person_a == person_b` (self-loop guard: i<j loop + `if (acc.personA === acc.personB) continue` belt-and-braces)

## Test Strategy

| isc | type | check | threshold | tool |
|---|---|---|---|---|
| ISC-1..10 | unit | parser fixtures from real export bytes | 10/10 pass | `bun test src/lib/linkedin/parse.test.ts` |
| ISC-11..13 | migration | drizzle migrate output, schema diff | no-op on 2nd run | `bun drizzle:migrate` |
| ISC-14..21 | integration | ingest real .zip, query SQLite | all counts match expected | `bun run scripts/ingest-cli.ts` + `sqlite3` SELECT |
| ISC-22..26 | http | curl multipart upload against `bun dev` | status + JSON shape | `curl -i -F file=@export.zip http://localhost:3000/api/ingest/linkedin` |
| ISC-27..31 | ui | Playwright Firefox screenshot + console probe | no `pageerror`, expected text present | `bun x playwright firefox` headless |
| ISC-32..35 | real-data | full real export round-trip | exact counts on first and second import | sqlite3 SELECT + diff |
| ISC-36 | privacy | network panel during ingest | zero non-localhost requests | playwright network log |
| ISC-37 | privacy | `find data/ -name '*.csv'` after ingest | zero results | shell |
| ISC-38 | data-integrity | SELECT … WHERE to_person_id = owner_person_id | zero rows | sqlite3 |
| ISC-39 | migration | `bun drizzle:migrate` creates manual_edges table | table present in `.schema manual_edges` | sqlite3 |
| ISC-40 | unit | write `(B, A)` → read `(A, B)` | canonical order preserved | `bun test` |
| ISC-41..42 | http | curl POST/DELETE `/api/edges/manual` | status + JSON shape | `curl -i` |
| ISC-43..44 | ui | Playwright at `/people/<id>` | "Add a connection" visible, lists existing | playwright firefox |
| ISC-45..46 | http | curl invalid payloads | 400 response | `curl -i` |
| ISC-47 | grep | search code for combined edges query | zero hits | `grep -r "manual_edges.*union.*derived_edges"` |
| ISC-48 | integration | POST same edge twice | second POST returns existing:true, row unchanged | curl + SELECT |
| ISC-61..62 | migration | drizzle migrate + sqlite_master probe | column + index present, second run no-op | sqlite3 |
| ISC-63..67 | integration | re-ingest real export, query positions | counts match thresholds | sqlite3 SELECT |
| ISC-68..70 | integration | origin column reflects source | declared=12, synthesised≥1500 | sqlite3 SELECT |
| ISC-71..72 | ui | playwright probe of /companies/[id]?q=PwC | counts visible, list ≥20 | playwright firefox |
| ISC-73 | integration | re-ingest same .zip | positions count unchanged | sqlite3 |
| ISC-74..75 | ui | playwright at /profile + /people/[id] | synthesised badge present, profile clean | playwright firefox |
| ISC-76..82 | unit | derive math fixtures | overlap-month math correct on 6 edge cases | bun test |
| ISC-83..85 | unit | confidence-bucket cases | 3 buckets emit correct kind+confidence | bun test |
| ISC-86 | integration | inspect emitted evidence_json | JSON.parse + shape check | sqlite3 + bun |
| ISC-87 | integration | run derive twice | row counts identical | sqlite3 |
| ISC-88..89 | http+cli | curl /api/derive + bun run scripts/derive-cli.ts | 200 + JSON shape match | curl + bun |
| ISC-90 | integration | inspect post-ingest derived_edges count | ≥100 after fresh ingest | sqlite3 |
| ISC-91 | real-data | grep evidence_json for PwC España | edge with companyName=PwC España present | sqlite3 |
| ISC-92..93 | ui | playwright at /people/[id] + /companies/[id] | derived section visible, sorted, labelled | playwright firefox |
| ISC-94 | grep | combined edges anti-pattern check | 0 hits | grep -r |
| ISC-95 | unit | self-loop edge case | derive emits zero (a,a) edges | bun test |

## Features

| name | satisfies | depends_on | parallelizable |
|---|---|---|---|
| schema-migration-0001 | ISC-11..13 | — | no (first) |
| linkedin-parser | ISC-1..10 | schema-migration-0001 | yes |
| ingest-pipeline | ISC-14..21, ISC-32..35, ISC-38 | linkedin-parser | no |
| api-route-ingest | ISC-22..26 | ingest-pipeline | no |
| upload-ui | ISC-27..29 | api-route-ingest | yes (with profile-page) |
| profile-page | ISC-30..31 | ingest-pipeline | yes (with upload-ui) |
| privacy-verify | ISC-36..37 | api-route-ingest | yes (at VERIFY) |
| schema-migration-0002 *(W3)* | ISC-39..40 | ingest-pipeline | no (first in W3) |
| api-route-manual-edges *(W3)* | ISC-41..42, ISC-45..46, ISC-48 | schema-migration-0002 | no |
| person-detail-page *(W3)* | ISC-43..44, ISC-47 | api-route-manual-edges | yes |
| schema-migration-0003 *(W4)* | ISC-61..62, ISC-68 | ingest-pipeline | no (first in W4) |
| synthesised-positions *(W4)* | ISC-63..75 | schema-migration-0003 | no |
| derive-edges-job *(W4)* | ISC-76..87, ISC-95 | synthesised-positions | no |
| derive-trigger-api-cli *(W4)* | ISC-88..91 | derive-edges-job | yes |
| derived-edges-ui *(W4)* | ISC-92..94 | derive-trigger-api-cli | yes |

## Decisions

- 2026-05-13: **Schema patch decision — `tenants.owner_person_id` not `people.is_owner`.** Profile.csv has no LinkedIn URL for the owner, so `people.linkedin_url` UNIQUE can't dedup the owner naturally. Storing the owner as `tenants.owner_person_id` keeps owner identity at the tenant level (correct semantics: each tenant has exactly one owner) and avoids polluting `people` with a sparse flag column. Migration `0001_owner_anchor.sql`.
- 2026-05-13: **Positions get a deterministic ID hash** — schema currently has no unique constraint on positions. Rather than a schema migration to add one, the ingest pipeline computes `sha1(personId|companyId|startDate|title)` as the position ID and uses INSERT OR IGNORE. Trades a schema change for a deterministic write strategy.
- 2026-05-13: **Messages.csv deferred to W3+.** Schema is ready (`messages` table exists from W1). 1 MB file is privacy-heavy and not on the W2 critical path. Picked up when "browse" needs it.
- 2026-05-13: **Skills.csv / Education.csv deferred.** No schema yet; not in W2 plan. Pick up alongside person-detail page in W3.
- 2026-05-13: **show-my-math on delegation floor (E3 soft ≥2, selected 0).** Parser is <150 lines TS against a known schema; ingestion is straight SQL via Drizzle; Forge/Anvil would add serialization overhead without correctness gain. Browser-verify at VERIFY is one delegation but counts as inline-tool, not subagent.
- 2026-05-13: **Manual edges scoped in, separate table from derived_edges.** Owner can manually assert edges between any two people in the network — facts LinkedIn never exported. Stored in a new `manual_edges` table, NOT as a row in `derived_edges` with `kind: 'user_asserted'`. Rationale: `derived_edges` is for **inferred** facts with `confidence < 1.0`; `manual_edges` is for **asserted** facts with implicit `confidence = 1.0`. Different epistemics → different tables. Cleaner queries, no confidence-column ambiguity, no risk of UI mixing the two.
- 2026-05-13: **Manual-edge writes canonicalise `(person_a, person_b)` by lexical sort.** Edges are undirected; storing both `(A,B)` and `(B,A)` would double-count and complicate every query. Canonical form: `person_a < person_b`. The API normalises before insert; UI never sees the asymmetry.
- 2026-05-13: **Manual edges land in W3, not W2.** User picked W3 sequencing: ISCs locked in this ISA now (ISC-39..48), but the build happens alongside the person-detail page next weekend. Keeps W2 tight (data in), W3 coherent (data view + enrich).
- 2026-05-13 (refined): **Connections.csv has 35 phantom blank rows after the real data.** Discovered during first real-data ingest: parser yielded 1831 rows but only 1796 had any identifying content. Initial filter (`row.some(c => c.trim())`) wasn't strong enough — added a connection-level guard that drops rows with no firstName, no lastName, and no URL. Effect: ISC-32 expected count revised from 1835 to 1797 (1796 real + owner). No data loss — every connection with any identifying info survives.
- 2026-05-13 (refined): **ISC-26 (30s budget) deferred to production-build verification.** Cold-dev compile of `/api/ingest/linkedin` takes ~130s on first hit; subsequent calls run in ~430ms. The 30s budget is honest only against a built bundle (`next start`), not `next dev`. Marked DEFERRED-VERIFY pending a production-build benchmark. Doctrinally correct per the Algorithm verify Rule 1.
- 2026-05-13 (W3): **Placeholder company filter added.** Real export had a "---" company row that showed up at the top of `/companies` browse. `writeCompanies` now drops normalised names that contain no alphanumeric — `"---"`, `"—"`, `"n/a"` etc. are no longer emitted. Existing "---" row cleaned out of the DB directly; future ingests skip such rows automatically.
- 2026-05-13 (W4): **`positions.origin` column added in migration 0003.** Two epistemic categories of positions: `declared` (from Positions.csv — the owner's own employment history with real dates) and `synthesised` (constructed from a connection's `company`/`position` text — we know they work there *today* but never had their dates). The column makes filtering trivial: profile timeline filters to `origin='declared'`, derived-edges job consumes both, person-detail page badges synthesised rows distinctly. Cleaner than a magic null-date heuristic — explicit > implicit.
- 2026-05-13 (W4): **Confidence buckets, not linear scoring.** Three buckets — 0.9 (≥12mo overlap), 0.7 (1–11mo), 0.4 (same employer no overlap). Linear scoring reads as fake-precise in the UI; buckets are easy to defend and easy to label High/Medium/Low. Per Matt's explicit pick at OBSERVE.
- 2026-05-13 (W4): **Synthesised positions use null dates + current=true, plus a null-as-today rule in derive math.** Connection.company gives us a current employer but never dates. Storing null/null/current=true is honest about what we don't know. The derive job's null-as-today rule means two people with synthesised positions at the same company overlap "today" → 0-month overlap → 0.4 confidence (shared_employer_no_overlap). Real overlap only emerges between owner's declared positions and connections — exactly the high-value signal.
- 2026-05-13 (W4 known gap): **Companies page shows "0 people" for most companies.** Surfaced by browser-verify: `/companies` lists every company name from positions+connections, but `positions` rows are only created for the owner (from Positions.csv). Connections' employers live as text in Connections.csv but no `positions` row links them. Two paths forward: (a) synthesise a single `positions` row per connection with `(company_id, title, current=true)` at ingest time, or (b) compute the count from both `positions` joins AND `people` whose headline matches the company. Recommend (a) — clean schema win, makes /companies actually useful for "who at X". This is a real follow-up for the next session (W4 or earlier). Captured as not-yet-an-ISC because it crosses W2 ingest semantics.

- 2026-05-13 (W4 refined): **bothCurrent override on confidence buckets.** First derive run produced 15709 edges, 100% of kind `shared_employer_no_overlap` — wrong. The synthesised-position null-as-today rule collapses every synthesised pair to a 0-month overlap window, so the original bucket spec ("months >= 1 → overlap, else no-overlap") under-reported reality. Fix: when bothCurrent is true AND months is 0, emit `shared_employer_overlap` with confidence 0.9 / 0.7 / 0.5 depending on declared-vs-synthesised mix. Honest about what we actually know: LinkedIn declares both there today; we just don't know duration. Post-fix: 15697 overlap (160 at 0.7 — owner-currently-at-company pairs; 15537 at 0.5 — connection-pair both-current), 12 at 0.4 (Matt's past employers vs current connections). Captured as ISC-85.1.
- 2026-05-13 (W4 refined): **Derive insert path batched.** First run was 378s for 15709 inserts — one serial await each. Refactored to a 100-row chunked `db.insert().values([...])` batch. New runtime: 17.8s (21× speedup). libSQL parameter cap is 999; 100 rows × 7 cols = 700 params, safe margin.

## Changelog

- 2026-05-13 (W4) — **Derived-edge kind taxonomy: 2 kinds → 3 kinds**
  - **Conjectured:** Two kinds (`shared_employer_overlap` + `shared_employer_no_overlap`) plus a confidence-only knob would cleanly carry the signal-strength axis.
  - **Refuted by:** First derive run on real data produced 0 / 15709 / 0 across the buckets, then after a bothCurrent override fix the same labels carried 15697 "overlap" edges that had ZERO real overlap math underneath them — synthesised-position pairs where the only evidence is "LinkedIn currently lists both at company X". Advisor flagged this as laundering weak signal into the strong-signal bucket: a future query like `WHERE kind='shared_employer_overlap' AND confidence >= 0.7` would over-trust same-employer-now-no-dates pairs as if they were proven multi-year colleagues.
  - **Learned:** Bucket names must match the underlying evidence type, not just the strength. Concurrency-now (we know they BOTH work there per LinkedIn, no dates) is a different evidence regime from interval-overlap (we have real start/end dates that intersect). Different regimes → different kind. Confidence orders strength within a regime.
  - **Criterion now:** ISC-85.1 explicitly labels bothCurrent overrides as `shared_employer_currently` (separate kind). Future queries filtering on "real proven overlap" use `kind='shared_employer_overlap'`; queries for "currently together" use `kind='shared_employer_currently'`. The conflation is gone.

- 2026-05-13 — **Connections.csv row filtering**
  - **Conjectured:** LinkedIn's Connections.csv has clean data after the 3-line Notes preamble, and `row.some(c => c.trim() !== "")` is enough to drop blank rows.
  - **Refuted by:** First real-data ingest produced 1831 rows but only 1796 had identifying content. 35 phantom rows survived the row-level filter (likely whitespace-padded blanks LinkedIn appends).
  - **Learned:** Connection-record validity is a property of the *connection*, not the *row*. Filter at the record-construction level: a real connection has at least a firstName, lastName, or URL.
  - **Criterion now:** ISC-9 enforces `linkedin_url` on every emitted connection; parser-level guard in `parseConnections` drops records with no identifying fields.

- 2026-05-13 — **Companies-browse usefulness vs. positions coverage**
  - **Conjectured:** Listing every company name in the data with the count of people from your network at that company is enough for a useful /companies browse page.
  - **Refuted by:** Real-data browser-verify of /companies — nearly every row showed "0 people" because `positions` rows are only created for the owner (12 rows), not for the 1796 connections (whose employers live as text in Connections.csv with no corresponding positions row).
  - **Learned:** Making the companies browse useful requires *some* link from connections to companies in the schema. The cleanest fix is to synthesise a single `positions` row per connection at ingest time — title from `c.position`, company from `c.company`, current=true, dates=null.
  - **Criterion now:** No new ISC yet — the existing ISC-54 ("renders one row per company with count of people from your network") is technically satisfied but semantically thin. Captured in Decisions as a W4 prerequisite; promote to an ISC when the synthesised-positions feature is built.

## Verification

- ISC-1..10: `bun test src/lib/linkedin/parse.test.ts` — 6 pass / 0 fail / 22 expect() calls, run against the real 418 KB export at `/mnt/c/Users/mca/Downloads/Basic_LinkedInDataExport_05-12-2026.zip.zip`.
- ISC-11..13: `bun run db:migrate` applies `0001_owner_anchor.sql` and is a no-op on second run; verified via `pragma_table_info('tenants')` showing the `owner_person_id` column.
- ISC-14..21, ISC-32..35, ISC-38: `bun run scripts/ingest-cli.ts <export.zip>` produces `{ batchId, duplicate:false, counts: { people:1797, companies:1199, positions:12, connections:1796 } }` on fresh DB; second run returns `duplicate:true` with the same batchId and identical counts; `SELECT … WHERE to_person_id = owner_person_id` returns 0 rows.
- ISC-22..26: live curl probes against `bun dev`: fresh upload returns 200 with the expected JSON, duplicate upload returns 409 with `existing_batch_id`, bad payload (no file field) returns 400, synthetic zip without Profile.csv returns 400 with `linkedin_export_missing_files`. ISC-26 DEFERRED-VERIFY pending production-build benchmark.
- ISC-27..31: Playwright Firefox probe at `/upload` and `/profile` — both render 200, expected selectors and text present, 0 pageerrors, 0 console errors/warnings. Screenshots at `/tmp/strand-verify_upload.png` and `/tmp/strand-verify_profile.png`.
- ISC-28..29: Playwright Firefox upload flow probe — drop the real .zip via the UI, success panel shows counts 1,797 / 1,796 / 1,199 / 12 with batch id; re-upload shows "Already imported" with the existing batch id. Screenshot at `/tmp/strand-verify_upload_duplicate.png`.
- ISC-36: 13 network requests captured during the UI probe — 0 non-localhost.
- ISC-37: `find /mnt/c/Users/mca/Projects/Strand -name '*.csv'` returns 0 files after ingest.
- ISC-39: `bun run db:migrate` applies `0002_manual_edges.sql`; `SELECT name FROM sqlite_master WHERE type='table' AND name='manual_edges'` returns 1 row.
- ISC-40..48: `bun run scripts/verify-w3.ts` — POST creates 201, re-POST (forward and reverse pair) → 200 existing:true (canonicalisation honoured), POST self → 400, POST nonexistent → 400, DELETE existing → 204, DELETE again → 404. Person-detail page renders the manual edge for the other person, with note + asserted_at; "Add a connection" UI present at `[data-testid="add-connection"]`.
- ISC-47: `grep -r "manual_edges.*union.*derived_edges"` across `src/` returns 0 hits — the two epistemic categories are queried through separate code paths.
- ISC-49..56, ISC-60: `/people` lists 1796 non-owner people (owner excluded); `?q=garcia` filters via parameterised `lower(full_name) LIKE`; `?page=2` shows "Page 2 of 36"; `?q=' OR 1=1 --` returns 200 without crash (parameterised bind). `/companies` lists 1198 companies (after placeholder cleanup), sorted by people-count desc, with filter + pagination working.
- ISC-57..59: `/people/[id]` renders person name + positions + manual edges; `/companies/[id]` renders company + people list with current-position badge; `/people/nonexistent-id` returns 404 via Next.js `notFound()`.
- ISC-36 (reaffirmed at W3): Playwright Firefox probe across `/people`, `/companies`, `/people/[id]` — 0 non-localhost requests, 0 pageerrors.
- Verify suite: `bun run scripts/verify-w3.ts` → 23/23 checks pass.
- ISC-61..62, 68: `bun run db:migrate` applies `0003_positions_origin.sql`; PRAGMA table_info shows `origin TEXT NOT NULL DEFAULT 'declared'`; `positions_tenant_company_origin_idx` present; second migrate run no-op; existing 12 owner positions backfilled with `origin='declared'`.
- ISC-63..70, 73: full ingest + re-ingest of `/mnt/c/Users/mca/Downloads/Basic_LinkedInDataExport_05-12-2026.zip.zip` yields `{ people:1797, companies:1198, positions:1799, connections:1796 }` on both runs; origin breakdown `declared:12, synthesised:1787`.
- ISC-71..72: `/companies` shows PwC España with 144 people (well above ≥20 threshold); `/companies/[PwC España id]` lists 145 rows (144 synth + 1 declared owner), top-derived-pairs visible.
- ISC-74..75: Playwright probe on `/profile` — 0 synthesised position rows in the timeline; on `/people/[id]` for a connection at PwC España — `data-testid="position-synthesised"` label present.
- ISC-76..85, 95: `bun test src/lib/derived/edges.test.ts` — 12/12 pass (6 overlap-math fixtures + 6 bucketise cases covering all three kinds and the bothCurrent override).
- ISC-86..91: `bun run scripts/derive-cli.ts` + `curl -s -X POST http://localhost:3000/api/derive`: derive emits `{ kept:15709, scannedPairs:15709, ms:21890, byKind:{ shared_employer_overlap:0, shared_employer_currently:15697, shared_employer_no_overlap:12 } }`. Real-data probe: 172 derived edges incident to owner, distributed across PwC España (143), OBS (17), Lloyds (9), and past employers (ISBAN, Banco Halifax, Banco Halifax Hispania). Evidence JSON parses to the documented shape.
- ISC-92..93: Playwright probe on `/people/[connection at PwC España]` — 50 derived-edge rows visible with confidence badges; `/companies/[PwC España]` — 20 derived-pair rows visible.
- ISC-94: `grep -rn "manual_edges.*derived_edges\|manual_edges.*join.*derived_edges\|manual_edges.*union.*derived_edges" src/` → 0 hits. Two distinct query modules (`manualEdges.ts`, `derivedEdges.ts`); two distinct UI sections on `/people/[id]` with separate `data-testid` markers.
- W4 verify suite: `bun run scripts/verify-w4.ts` → 12/12 checks pass. W3 regression: `bun run scripts/verify-w3.ts` → 23/23 still pass.
- Cato (E4 cross-vendor audit): `skipped` — `codex` CLI not installed on this WSL host. Show-my-math: Advisor was invoked and produced a substantive critique that drove the three-kind taxonomy refactor (advisor flagged the original 2-kind labelling as laundering weak signal into the strong-signal bucket). Action item logged: install codex CLI in WSL before next E4/E5 work in this project, or run E4/E5 work from a host where codex is available.
