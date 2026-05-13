---
project: strand
current_task: W3 — browse + manual edges
slug: w3-browse-and-manual-edges
effort: E3
phase: complete
progress: 59/60
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
- 2026-05-13 (W3 known gap): **Companies page shows "0 people" for most companies.** Surfaced by browser-verify: `/companies` lists every company name from positions+connections, but `positions` rows are only created for the owner (from Positions.csv). Connections' employers live as text in Connections.csv but no `positions` row links them. Two paths forward: (a) synthesise a single `positions` row per connection with `(company_id, title, current=true)` at ingest time, or (b) compute the count from both `positions` joins AND `people` whose headline matches the company. Recommend (a) — clean schema win, makes /companies actually useful for "who at X". This is a real follow-up for the next session (W4 or earlier). Captured as not-yet-an-ISC because it crosses W2 ingest semantics.

## Changelog

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
