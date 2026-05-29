---
project: strand
current_task: at-company pagination — audit finding (A), DOM-bloat fix
slug: at-company-pagination
effort: E2
phase: complete
progress: 12/12
mode: ALGORITHM
started: 2026-05-29
updated: 2026-05-29
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
- [x] ISC-26 *(closed 2026-05-21 v0.3.4-hygiene)*: Endpoint completes under 30s for the 418 KB / 1834-connection real export. **Production-build verification: `bun run build` succeeds end-to-end (no 90s timeout — the earlier dev-mode timeout was a Bash-tool budget cap, not a Next problem). Build artifact size for `/api/ingest/linkedin` route is 0 B function-side (server-rendered on demand, no compile cost in prod). `bun run start` boot + key-route TTFB measurements confirm the dev-mode compile penalty (131s cold) is entirely absent in prod: `/graph` default 0.76-1.0s, `/graph?minConfidence=0` 1.08-1.17s, `/queries/reach/[id]` (Javier target, 142 candidates) 0.62-0.77s. Original dev-mode subsequent-call timing (431ms) implies prod ingest is well under the 30s budget; a full ingest with the actual 418KB export was not re-run to avoid mutating real-data state. Empirical posture: prod-build verification clears the original concern — production removes the compile cost as predicted.**

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

**W5a — Query surface: at-company + saved-query bookmarks** *(Stream A only this session; other W5 queries deferred to W5b)*
- [x] ISC-96: Schema migration `0004_saved_queries.sql` creates `saved_queries (id, tenant_id, name, url, created_at)` with PK on `id`, UNIQUE on `(tenant_id, name)`, FK on `tenant_id`
- [x] ISC-97: `bun run db:migrate` is a no-op on second invocation after 0004 applies
- [x] ISC-98: `/queries/at-company` (no company selected) renders a search input + top-20 companies by people count
- [x] ISC-99: `/queries/at-company?q=pwc` filters the no-company picker by case-insensitive substring on company name (parameterised)
- [x] ISC-100: `/queries/at-company?company=<id>` renders the people-at-that-company list with the company name in a header
- [x] ISC-101: `/queries/at-company?company=<id>` for a nonexistent id returns 404 (Next.js notFound), not a server crash
- [x] ISC-102: `?company=<id>&status=current` filters to positions with `current=true` only
- [x] ISC-103: `?company=<id>&status=past` filters to positions with `current=false` only
- [x] ISC-104: `?company=<id>&status=any` (default) shows both, with current rows grouped first
- [x] ISC-105: `?company=<id>&sort=name` sorts result rows alphabetically by full_name
- [x] ISC-106: `?company=<id>&sort=connected` sorts result rows by `connections.connected_at` desc (most recently connected first)
- [x] ISC-107: `?company=<id>&sort=declared-first` (default) puts declared positions before synthesised, then alphabetical
- [x] ISC-108: `?company=<id>` for PwC España renders ≥20 people on the real export
- [x] ISC-109: `POST /api/bookmarks` accepts `{ name, url }`, returns `201 { id, name, url, created_at }`
- [x] ISC-110: `POST /api/bookmarks` with empty/whitespace `name` returns `400`
- [x] ISC-111: `POST /api/bookmarks` with a name that already exists for the tenant returns `409 { reason: "duplicate_name" }`
- [x] ISC-112: `DELETE /api/bookmarks/<id>` returns `204` on success, `404` if no such id
- [x] ISC-113: `/queries/at-company` renders a "Bookmark this query" affordance that POSTs the current URL with a prompted name
- [x] ISC-114: `/queries/at-company` renders a "Saved queries" sidebar/section listing bookmarks for the tenant; each is a link to its URL with a delete button
- [x] ISC-115: Anti: SQL injection probe — `?q=' OR 1=1 --` returns 200; offsite URL POST (`https://evil.com/x` or `//evil.com/x`) → 400 *(Anti: local-first — bookmarks must point at in-app paths only. Added post-Advisor review.)*

**W5b — worked-with + by-year + reach** *(three remaining W5 query types)*

*worked-with — collapse manual + derived edges incident to one person across companies*
- [x] ISC-116: `/queries/worked-with` (no person selected) renders a person search input that autocompletes against `/api/people/search`
- [x] ISC-117: `/queries/worked-with/[id]` for a nonexistent id returns 404 (Next.js notFound)
- [x] ISC-118: `/queries/worked-with/[id]` renders the target person's name in the header
- [x] ISC-119: `/queries/worked-with/[id]` renders a "Manual connections" section listing manual_edges incident to X with each other-person's name + note
- [x] ISC-120: `/queries/worked-with/[id]` renders a "Derived connections" section listing derived_edges incident to X sorted by confidence desc, then overlap_months desc, with company name + confidence label
- [x] ISC-121: For X = a real PwC España connection, derived section renders ≥10 rows
- [x] ISC-122: Anti: manual and derived sections are queried via the two separate query modules (`manualEdges.ts` and `derivedEdges.ts`); never merged in one list
- [x] ISC-123: `/queries/worked-with/[id]` shows a "Bookmark this query" affordance and the saved-queries sidebar

*by-year — connections histogram + per-year drilldown*
- [x] ISC-124: `/queries/by-year` (no year selected) renders a histogram: rows of `(year, count)` ordered by year desc, including an "Unknown" bucket for NULL `connected_at`
- [x] ISC-125: Histogram counts sum to the total non-owner connections in the tenant
- [x] ISC-126: `/queries/by-year?year=YYYY` renders the list of people connected that year, sorted alphabetically by full_name
- [x] ISC-127: `/queries/by-year?year=unknown` renders people whose `connected_at` is NULL
- [x] ISC-128: `/queries/by-year?year=2099` for a year with no connections renders "no people connected this year" without crashing
- [x] ISC-129: Anti: `?year=`'OR 1=1 --` is parameter-bound (parameterised SQL); returns 200 with empty list, no crash
- [x] ISC-130: `/queries/by-year` shows the saved-queries sidebar

*reach — ranked intermediaries from owner to X*
- [x] ISC-131: `/queries/reach` (no person selected) renders a person search input
- [x] ISC-132: `/queries/reach/[id]` for a nonexistent id returns 404
- [x] ISC-133: `/queries/reach/[id]` for the owner returns a "this is you" panel (no path search), not an empty list
- [x] ISC-134: `/queries/reach/[id]` for a direct 1st-degree connection X surfaces a "You're directly connected to X" panel at the top, with the connection date if known
- [x] ISC-135: `/queries/reach/[id]` renders a ranked "Strongest reach" list: for each Y∈owner's connections that has a manual_edge or derived_edge to X, score = 1.0 if manual, else derived.confidence; sorted desc, ties broken by manual > derived then overlap_months desc
- [x] ISC-136: Per intermediary Y, the rendered evidence is the strongest single edge (Y↔X). Manual edges show the note; derived edges show company name + overlap months + confidence label
- [x] ISC-137: For X with no incident edges at all and no direct 1st-degree connection, the page renders "No path found through your network" without crashing
- [x] ISC-138: For X = a derived-rich PwC España connection, the reach list renders ≥5 ranked intermediaries
- [x] ISC-139: Anti: reach query DOES NOT include the target person X as their own intermediary (Y = X is filtered out)
- [x] ISC-140: Anti: reach query DOES NOT include intermediaries Y where Y is not a 1st-degree owner connection
- [x] ISC-141: `/queries/reach/[id]` shows a "Bookmark this query" affordance

*shared*
- [x] ISC-142: All three query pages (`worked-with`, `by-year`, `reach`) render the saved-queries sidebar consistently
- [x] ISC-143: Anti: zero non-localhost network requests across all three pages during a Playwright probe pass
- [x] ISC-144: All three pages render with 0 page errors and 0 console errors during Playwright probe
- [x] ISC-145: All three query URLs round-trip through POST /api/bookmarks → DELETE — the bookmark plumbing built in W5a accepts the new URL shapes without modification

**W6 — Cytoscape force-directed graph view**
- [x] ISC-146: `src/lib/queries/graph.ts` exports `assembleNetworkGraph(tenantId, opts)` returning `{ nodes, edges, meta }`
- [x] ISC-147: Node selection: always include owner + every person with ≥1 manual edge incident OR ≥1 derived edge with confidence ≥ 0.7 incident; cap at 150 total nodes (drop lowest-confidence nodes if over cap)
- [x] ISC-148: Edge selection: include all manual_edges where both endpoints are in the node set; include derived_edges with confidence ≥ 0.7 where both endpoints are in the node set
- [x] ISC-149: Each node carries `id`, `displayName`, `company` (current employer if any, else null), `isOwner` flag, `degree` (count of incident edges in the rendered set)
- [x] ISC-150: Each edge carries `id`, `source`, `target`, `kind` ('manual' | 'derived_overlap' | 'derived_currently' | 'derived_no_overlap'), `confidence`, optional `companyName`, `overlapMonths`, `note`
- [x] ISC-151: `/graph` page server-loads `assembleNetworkGraph` and passes data to the `NetworkGraph` client component
- [x] ISC-152: `NetworkGraph` is a `"use client"` component that instantiates Cytoscape with the cose layout and renders inside a fixed-height container
- [x] ISC-153: Owner node renders with a distinct visual (larger, distinct color)
- [x] ISC-154: Manual edges render solid; derived edges render dashed
- [x] ISC-155: Nodes coloured by company-cluster — each unique `company` gets a stable colour derived from a hash of the company name
- [x] ISC-156: `/graph` page renders ≥100 visible nodes on the real export
- [x] ISC-157: `/graph` renders without any non-localhost network requests (Cytoscape loaded from local bundle)
- [x] ISC-158: Anti: `/graph` page initial-render time (server-rendered HTML payload) is under 200KB
- [x] ISC-159: Anti: page renders with 0 page errors and 0 console errors during a Playwright probe
- [x] ISC-160: `/graph` exposes a `data-testid="graph-container"` element with the Cytoscape canvas inside
- [x] ISC-161: Page shows a meta panel with the node count and edge count rendered
- [x] ISC-162: For an empty tenant (no edges meeting the threshold), `/graph` renders an explicit empty state (not a blank canvas)
- [x] ISC-163: Bookmark this query (`/graph`) round-trips through `/api/bookmarks` POST 201 → DELETE 204 without modification (smoke check the existing API accepts this URL shape)
- [x] ISC-164: `/graph` page is added to the home-page roadmap as a live link (replace the placeholder W6 entry in the routes array)
- [x] ISC-165: Anti: the home-page roadmap's "Derived edges" stale entry that pointed at `/graph` is removed (derived edges live on /people/[id] and /companies/[id], not on a dedicated page)

**W7 — Release polish for v0.1.0**
- [x] ISC-166: `scripts/screenshots.ts` exists and captures 6 routes (`/upload`, `/profile`, `/people`, `/companies/<PwC España id>`, `/queries/at-company?company=<PwC España id>&status=current`, `/graph`) to `docs/screenshots/`
- [x] ISC-167: `docs/screenshots/` contains exactly 6 PNG files after the script runs, each non-empty (size > 1KB)
- [x] ISC-168: `README.md` includes a Quick Start section showing `git clone && bun install && bun run db:migrate && bun dev`
- [x] ISC-169: `README.md` includes a Docker section showing `docker build -t strand .` and `docker run -p 3000:3000 -v $(pwd)/data:/app/data strand`
- [x] ISC-170: `README.md` references the captured screenshots via relative `docs/screenshots/<name>.png` paths
- [x] ISC-171: `README.md` accurately states the SQLite driver as `@libsql/client` (not the stale W1 mention of `better-sqlite3`)
- [x] ISC-172: `README.md` accurately describes the 3-kind derived-edges taxonomy (`shared_employer_overlap`, `shared_employer_currently`, `shared_employer_no_overlap`)
- [x] ISC-173: `README.md` accurately states "LinkedIn export bytes are parsed in-memory and never persisted to disk" (matches ISC-37 anti)
- [x] ISC-174: `README.md` roadmap marks W1–W7 with their actual landed-or-in-flight status (no future-tense for shipped weeks)
- [x] ISC-175: `README.md` link to the `CONTRIBUTING.md` file
- [x] ISC-176: `Dockerfile` exists at the repo root, uses an `oven/bun` base image, runs `bun install` + `bun run build`, exposes port 3000
- [x] ISC-177: `.dockerignore` exists at the repo root and excludes `data/`, `node_modules/`, `.git/`, `tmp/`, `*.log`
- [x] ISC-178: `CONTRIBUTING.md` exists at the repo root and points to `Projects/Strand/ISA.md` as the project state-of-record
- [x] ISC-179: `LICENSE` exists at the repo root, MIT, with copyright holder `Matt Alexander` and year 2026
- [x] ISC-180: `package.json` `version` is `0.1.0-rc.1` (proper semver pre-release identifier; bumped from initial `0.1.0-pre` after Advisor flagged the smell)
- [x] ISC-181: `package.json` `license` is `MIT` (not `UNLICENSED`)
- [x] ISC-182: `package.json` exposes a `screenshots` script that runs `bun run scripts/screenshots.ts`
- [x] ISC-183: Anti: `data/` and any `.zip` exports are NOT staged in the W7 commit
- [x] ISC-184: Anti: `Dockerfile` does NOT copy `data/strand.db` into the image (ingest-on-first-run is the intended model)
- [x] ISC-185: All prior verify scripts (`verify-w3`, `verify-w4`, `verify-w5`, `verify-w5b`, `verify-w6`) still pass after W7 changes

**W8a — Docker build + v0.1.0 tag**
- [x] ISC-186: `docker.io` installed via apt on this WSL host
- [x] ISC-187: `docker --version` returns a Docker version string (`Docker version 29.1.3`)
- [x] ISC-188: `docker info` reports a running daemon (Server section present, v29.1.3)
- [x] ISC-189: socket access for user `mca` (via group OR `chmod 666 /var/run/docker.sock` fallback)
- [x] ISC-190: `docker build -t strand:0.1.0 -t strand:latest .` exits 0
- [x] ISC-191: built image size <2 GB (actual: 1.76 GB)
- [x] ISC-192: `docker run -d -p 3001:3000 -v ...:/app/data strand:0.1.0` returns a container id
- [x] ISC-193: container logs show `db:migrate` completed + Next.js Ready within 30s (actual: 2s, Ready in 661ms)
- [x] ISC-194: `curl -sf http://localhost:3001` returns HTTP 200
- [x] ISC-195: `curl http://localhost:3001/upload` body contains the drag-drop upload UI marker
- [x] ISC-196: container `docker stop` + `docker rm` cleanly (no longer in `docker ps -a`)
- [x] ISC-197: Anti: zero outbound (non-localhost) URLs in rendered HTML of `/` or `/upload`
- [x] ISC-198: `package.json` `version` updated `0.1.0-rc.1` → `0.1.0` (commit 583863c)
- [x] ISC-199: release-bump commit lands with `release: v0.1.0` message, tree clean after
- [x] ISC-200: annotated tag `v0.1.0` created locally, points at `5e6c272` (release: fix v0.1.0 drift strings)
- [x] ISC-201: Anti: no `git push` executed by Claude (push is user action per W7 close)
- [x] ISC-202: Anti: no GitHub release or remote creation by Claude (user action)

**v0.2.0-B — interactive /graph filters** *(2026-05-20)*

- [x] ISC-203: `/graph?kinds=` accepts comma-separated edge kinds from `{manual, derived_overlap, derived_currently, derived_no_overlap}`; unknown values silently dropped
- [x] ISC-204: `/graph?minConfidence=` accepts float; out-of-range clamped to `[0, 1]`; NaN / missing ignored (falls back to default)
- [x] ISC-205: `assembleNetworkGraph({ kinds?, minConfidence? })` applies both filters to the `derived_edges` candidate query before assembling
- [x] ISC-206: Manual edges always pass the `minConfidence` filter (implicit confidence 1.0); they obey the `kinds` filter only when `manual` is explicitly excluded from the selection
- [x] ISC-207: Default behaviour (no query params) renders the same node + edge set as pre-Slice-B `/graph` (regression safety; existing W6 verify suite stays green)
- [x] ISC-208: Filter panel renders as a fixed-position overlay anchored top-right inside `[data-testid="graph-container"]`, styled on Graph-Forward Dark `bg-overlay` + `border-subtle`
- [x] ISC-209: Edge-kind chips: 4 toggleable buttons (one per kind), filled when selected, outlined when not; clicking toggles selection; at least 1 kind must remain selected (cannot deselect all)
- [x] ISC-210: Confidence slider: range `0.0–1.0`, step `0.05`, current value labelled next to handle (e.g. `≥ 0.70`)
- [x] ISC-211: Changing any filter updates the URL via `history.pushState` (same pattern as `?selected=`) and re-fetches via `router.refresh()` — no full page reload
- [x] ISC-212: Browser Back / Forward (`popstate`) restores prior filter state without losing the canvas
- [x] ISC-213: Anti: no SSR/CSR hydration mismatch warning when first load carries `?kinds=` or `?minConfidence=` params
- [x] ISC-214: Anti: confidence slider at `0.0` does NOT crash the page or freeze layout (NODE_CAP still bounds the node set; the densifying-to-9k-edges hairball from the W6 Changelog stays prevented)
- [x] ISC-215: `GraphMeta.candidateCount` reflects the post-filter candidate pool size so the user can see filter aggressiveness in the meta line

**v0.2.0-C — min-degree filter + nav progress + per-route loading** *(2026-05-20)*

- [x] ISC-216: `assembleNetworkGraph({ minDegree })` post-filters nodes by visible-edge degree, cascading drops to incident edges; owner is exempt (always kept) so the user's anchor never disappears.
- [x] ISC-217: `/graph?minDegree=N` accepts integer; clamped to `[1, 20]`; non-integer / out-of-range falls back to default (1 = pass-through).
- [x] ISC-218: Filter panel shows a "Min edges per node" slider (range 1–20, step 1) with label "any" at 1 and "≥ N" otherwise; URL-sync'd like the other filters; survives Back/Forward.
- [x] ISC-219: Global `<NavProgress />` mounted in `app/layout.tsx` inside a `<Suspense>` boundary. Flashes a 2px gradient bar at the top of the viewport on click of any internal `<a>`/`<Link>`; clears when `usePathname` or `useSearchParams` updates (= navigation actually completed).
- [x] ISC-220: Per-route `loading.tsx` skeletons for `/graph`, `/people`, `/companies` — Next 14 streams these in immediately while the server component runs, killing the blank-screen window on slow routes (notably the ~5s `/graph` SQL).

**v0.2.0 — release: edge cap + verify-w6 refresh + tag** *(2026-05-20)*

- [x] ISC-221: `EDGE_CAP = 500` constant in `src/lib/queries/graph.ts`; sort derived+manual edges by confidence DESC and slice to cap. Manual edges (confidence 1.0) always survive the cut.
- [x] ISC-222: `GraphMeta.edgesTotal` populated only when the cap fires (pre-cap count > rendered count); `edgeCap` constant always surfaced. Stats grid renders "M / N" with a `title="Showing top M of N by confidence"` when capped, plain `M` otherwise.
- [x] ISC-223: Composition correctness — when both `minConfidence` and `minDegree` are active, min-degree filters against the already-capped edge set, not the raw `edges` array; otherwise dropped-by-cap edges would silently re-appear via the cascade. Empirically: `?minConfidence=0.5&minDegree=3` returns 145 nodes / 490 surviving edges (of 500 capped / 10,317 raw).
- [x] ISC-224: `graph-canvas.tsx` rail `<dl>` carries `data-testid="graph-stats"` and per-cell `data-stat="nodes|edges|candidates|confidence-floor|node-cap"` attributes for stable selector parsing.
- [x] ISC-225: `scripts/verify-w6.ts` reads stats via `data-stat` cells rather than regex-against-label; the edge cell parser accepts both `M` and `M / N` formats. Suite is **11/11 pass** at the v0.2.0 tag commit, including the post-rebuild prod-mode probe.
- [x] ISC-226: Annotated tag `v0.2.0` created locally on the commit carrying ISC-221..225. Push + GitHub release remain user actions per the W7 convention.

**v0.3.0-A — Messages.csv ingest (slice 1: data layer)** *(2026-05-20)*

- [x] ISC-227: `parseLinkedInExport` reads `messages.csv` via existing `readZipFile(zip, "messages.csv")` and returns `LinkedInMessage[]` on `ParsedExport`. Optional in zip — Basic export ships zero, Complete ships ~2200 rows.
- [x] ISC-228: Date parser handles LinkedIn's `"YYYY-MM-DD HH:MM:SS UTC"` format → epoch seconds; rows with unparseable dates are skipped (counted, not crashed). Real export: 0/2209 unparseable.
- [x] ISC-229: Sender + recipient profile URL canonicalised via `.trim()` — same surface as `connections.linkedinUrl` extraction. Owner URL detected via FROM == profile.fullName match (`https://www.linkedin.com/in/matt-pwc-bi`).
- [x] ISC-230: Group messages (comma-separated URLs inside the quoted `RECIPIENT PROFILE URLS` CSV cell) expanded into one record per (sender → recipient) pair. Real export: 2209 raw rows → 2228 expanded records.
- [x] ISC-231: Record-level validity guard (per feedback memory 2026-05-13): drop messages where sender URL OR all recipient URLs are empty after canonicalisation. Real export: 108 rows skipped this gate.
- [x] ISC-232: `ingestLinkedInExport.writeMessages` resolves URL → `people.id` via pre-fetched `Set<string>` of valid person IDs + `personIdFromUrl(tenantId, url)`. Single-pass O(messages); owner URL routes to `ownerPersonId(tenantId, fullName)`.
- [x] ISC-233: Messages where either party's URL doesn't resolve to a `people` row are skipped (1st-degree-only invariant — InMail from non-connections, deleted accounts); `skipped_no_person` count reported in `IngestResult.messageStats`. Real export: 654 / 2228 expanded (29.4%) skipped this gate.
- [x] ISC-234: `direction` set to `"sent"` when sender resolves to ownerPersonId, `"received"` otherwise; rows where fromId == toId post-resolution are dropped. Real export: 625 sent + 945 received = 1570 total.
- [x] ISC-235: Deterministic message `id` = `sha1Hex(tenantId|msg|conversationId|sentAtEpoch|fromPersonId|toPersonId|contentHash)` → re-ingest of same export bytes hits `existingBatch` shortcut (returns `duplicate: true`, 0 new rows verified); re-ingest of overlapping different archive converges via `INSERT … ON CONFLICT DO NOTHING`. Refined: contentHash element added post-Advisor (2026-05-20) — see ISC-235.1.
- [x] ISC-235.1 *(Advisor 2026-05-20, refined ID)*: `contentHash = sha1(CONTENT)[:8]` tiebreaks same-second same-pair messages (LinkedIn's DATE column has whole-second resolution; rapid-fire bursts can share `sentAtEpoch`). Unit test "ISC-235.1 (Advisor)" passes; real-data smoke `inserted` count went 1570 → **1573 (+3)** after the fix — empirical confirmation that three actual messages were being lost in Matt's export before the refinement.
- [x] ISC-236: `IngestResult.messageStats` reports `{ parsed, expanded, skipped_no_url, skipped_no_date, skipped_no_person, inserted }`. Real ingest: `{parsed: 2209, expanded: 2228, skipped_no_url: 108, skipped_no_date: 0, skipped_no_person: 654, inserted: 1570}`.
- [x] ISC-237: On the real Complete export (2209 raw rows, 2228 expanded), `inserted: 1570` ≥ 80% of (`parsed − skipped_no_person`) = `1555`. Actual: 1570/1555 = 101% (expansion can exceed raw because group rows fan out). PASSED.
- [x] ISC-238: Anti — no rows with `fromPersonId == toPersonId`. `SELECT count(*) FROM messages WHERE from_person_id = to_person_id AND tenant_id = 'local'` → 0. Verified.
- [x] ISC-239: Anti — multi-line CONTENT does not break row parsing. Unit test "multi-line CONTENT (quoted newline)" passes via existing `iterRows` RFC-4180 quote-state machine; real export shows 6245 file lines parse cleanly to 2209 records.
- [x] ISC-240: Anti — `writeMessages` batches inserts via `db.insert(...).values(slice)` in chunks of 200, not per-row. Code inspection: `for (let i = 0; i < batch.length; i += CHUNK)` loop at `src/lib/linkedin/ingest.ts`.
- [x] ISC-241: `parse.test.ts` has 8 new messages-related tests (1:1, group, no-recipient-URL skip, bad-date skip, self-DM drop, owner-URL detection, multi-line CONTENT, parseMessageDate unit). Suite 15/15 pass.

**v0.3.0-B — Messages UI** *(2026-05-20)*

*Query module — src/lib/queries/messages.ts*

- [x] ISC-242: `getMessageStatsForPerson(personId)` returns `{ sent: number, received: number, total: number, firstAt: Date | null, lastAt: Date | null }`; `sent` counts messages where the OTHER person is `toPersonId`, `received` where the OTHER person is `fromPersonId` (owner-perspective).
- [x] ISC-243: Stats are computed in ONE SQL round-trip using SUM(CASE WHEN direction=...) + MIN(sent_at) + MAX(sent_at) aggregation, not four separate queries.
- [x] ISC-244: `listMessageThreadForPerson(personId, limit=20)` returns `{ id, direction, sentAt }[]` ordered by `sentAt` DESC, capped at `limit`. No body/subject fields in the return type.
- [x] ISC-245: `listLastContactByPeople(personIds)` batch-loads `Map<personId, Date>` for the /people list — single SQL query with `WHERE person_id IN (...)` + GROUP BY, no N+1 per-row queries.
- [x] ISC-246: All three queries scope by `tenantId` (defaulted to `LOCAL_TENANT_ID`) and resolve owner via `getOwnerId()` from the existing people module — owner is the implicit one-side of every (owner, other) message pair.
- [x] ISC-247: Empty-person case (no messages with that person): stats returns `{ sent: 0, received: 0, total: 0, firstAt: null, lastAt: null }`, thread returns `[]`, no crash.

*Person-detail page — /people/[id]*

- [x] ISC-248: `/people/[id]` renders a `data-testid="messages-section"` block positioned below the "Derived connections" section.
- [x] ISC-249: Stats row renders three cells with `data-testid="messages-stats"`: "Sent N", "Received N", and "Last contact YYYY-MM-DD" (or "—" if no messages).
- [x] ISC-250: Empty state: when `total === 0`, render the text "No messages exchanged with this person." and NO thread list.
- [x] ISC-251: Non-empty: render a thread list with `data-testid="messages-thread"`, each row showing direction marker (`Sent` or `Received`) + `YYYY-MM-DD` only — no content field, no subject field.
- [x] ISC-252: Sent and received rows are visually distinct (different colour token or icon), and the distinction is via accessible markup (e.g. `data-direction="sent" | "received"`) so the verify probe can assert both kinds render.
- [x] ISC-253: Anti: Messages section query path imports ONLY from `@/lib/queries/messages`; the person-detail page does NOT import `messages` data via `manualEdges.ts` or `derivedEdges.ts` (grep enforcement).

*People list — /people*

- [x] ISC-254: `/people` row shows `last contact YYYY-MM-DD` in the same mono / tertiary-text style as `connected YYYY-MM-DD` for people with ≥1 message; absent (no element) for people with 0 messages.
- [x] ISC-255: `/people?sort=last_contact` orders rows by last-contact-date DESC, with people who have no messages listed AFTER all people who have any (NULLS LAST).
- [x] ISC-256: `/people?sort=name` (and the default, no `sort` param) preserves the existing alphabetical-by-full-name ordering — verified by hash-comparing the rendered list against the pre-v0.3.0-B output.
- [x] ISC-257: Unknown `sort` value (e.g. `?sort=garbage`, `?sort=' OR 1=1 --`) falls back to default ordering — no SQL error, no injection vector.
- [x] ISC-258: `/people` issues at most 3 SQL queries regardless of page size: count + people+connections select + one messages-module batch (sort=name: `listLastContactByPeople` over the page's IDs; sort=last_contact: `listAllLastContactDesc` for the whole tenant, composed with the full people set in JS). No per-row messages query.
- [x] ISC-259: Empty-list state and pagination behaviour preserved — `?sort=last_contact&page=2` paginates correctly, `?q=...` filter composes with `?sort=last_contact`.

*Tests*

- [x] ISC-260: `src/lib/queries/messages.test.ts` exists with at least 4 test cases: (a) stats single-query shape for a person with both sent and received, (b) empty-person stats returns zeros and null dates, (c) thread chronological order (newest first, limit honoured), (d) batch `listLastContactByPeople` returns the same map size as input person IDs with correct max(sent_at).
- [x] ISC-261: Real-data: pick the top-1 person from `listLastContactByPeople` ordered by stats.total DESC, assert that person's stats.total ≥ 10 AND stats.sent > 0 AND stats.received > 0 (a real two-way correspondent exists in the dataset).

*Build + probe*

- [x] ISC-262: `scripts/verify-v030b.ts` Playwright probe — visits `/people/[id]` of the top-messaged contact, asserts Messages section present, stats visible with non-zero counts, ≥1 thread row of each direction, zero `pageerror`, zero console error, zero non-localhost requests.
- [x] ISC-263: `bun run typecheck` exits 0 after the slice (no new TS errors).
- [x] ISC-264: Anti: no SSR/CSR hydration mismatch warning when /people page loads with `?sort=last_contact` (verified by probe `pageerror` listener).
- [x] ISC-265: Anti: `grep -rn "from \"@/lib/queries/messages\"" src/lib/queries/manualEdges.ts src/lib/queries/derivedEdges.ts` returns 0 hits — messages queries never imported from the other two epistemic-category modules.
- [x] ISC-266 *(Advisor 2026-05-20)*: Anti: SQL-reference grep — `rg -nE '(FROM|JOIN|INTO|UPDATE)\s+messages\b' src/ --glob '!src/lib/queries/messages.ts' --glob '!src/lib/linkedin/ingest.ts' --glob '!src/lib/db/**' --glob '!scripts/**' --glob '!**/*.test.ts'` returns 0 hits. JS-import isolation (ISC-265) is necessary but not sufficient: the schema-access layer is where the third-epistemic-category boundary actually has to hold. listPeople was JOINing the messages table directly in the first cut; refactored to route through `listLastContactByPeople` / `listAllLastContactDesc` to close the schema leak. ingest.ts, db schema files, scripts, and tests are whitelisted (writer / definition / tooling layers).
- [x] ISC-267 *(Advisor 2026-05-20)*: Stats row on `/people/[id]` ALWAYS renders (zero state included). The thread list is the conditional element. Rationale: rendering zeros is the epistemic-category claim being honoured at the UI — "we tracked, there were none" vs "we don't track this here" must remain visually distinguishable. Verified by visiting a person with 0 messages and asserting `data-testid="messages-stats"` is present with `data-stat="sent"` showing "0".

**v0.3.0-C — warm-path-finder (message-weighted reach)** *(2026-05-21)*

Pursue: extend `/queries/reach/[id]` so the ranked-intermediary list surfaces a fourth signal — **warmth** (observed message activity with each intermediary Y) — alongside the existing epistemic score (manual asserted / derived inferred). Warmth is a third-epistemic-category quantity per v0.3.0-A doctrine: frequency + recency, NOT a confidence-shaped quantity. Two ordering modes: `sort=epistemic` (default, byte-identical to pre-v0.3.0-C) and `sort=warmth` (re-ranks by message total DESC, tiebreak lastAt DESC, then epistemic score, then name). Composition pattern follows ISC-266: reach.ts owns ranking; messages.ts owns ALL `messages`-table SQL via a new batch helper. No schema delta.

*Query module — src/lib/queries/messages.ts (batch warmth helper)*

- [x] ISC-268: New `getMessageCountsByPeople(personIds: string[], tenantId?)` returns `Map<personId, { sent: number; received: number; total: number }>`. Owner-perspective: `sent` counts messages where the OTHER person is `toPersonId`, `received` where the OTHER person is `fromPersonId`. Identical semantics to `getMessageStatsForPerson` but batched over N IDs.
- [x] ISC-269: Single SQL round-trip — one query with `WHERE … IN (…)` + `GROUP BY` + SUM(CASE) aggregation. NOT N queries, NOT a per-row loop.
- [x] ISC-270: Empty `personIds` array → empty Map, NO SQL fired (early return; parity with `listLastContactByPeople([])`).
- [x] ISC-271: Real-data: for the top-contacted person, returned `{sent, received, total}` matches `getMessageStatsForPerson(top).total / sent / received` exactly (cross-check between the two helpers).
- [x] ISC-272: People IDs that have ZERO messages are present in the input but ABSENT from the returned Map — caller's responsibility to substitute `{sent:0, received:0, total:0}` for missing keys (matches `listLastContactByPeople` contract).

*Reach composition — src/lib/queries/reach.ts*

- [x] ISC-273: `ReachCandidate` gains a `messages: { sent: number; received: number; total: number; lastAt: Date | null }` field. ALWAYS present on every candidate (render-zeros-not-absence, per `feedback_render_zeros_not_absence.md`). Zero-message intermediaries get `{sent:0, received:0, total:0, lastAt:null}`.
- [x] ISC-274: `findReachToPerson` accepts an optional `sort: "epistemic" | "warmth"` arg, default `"epistemic"`. Unknown / undefined / null → falls back to `"epistemic"` (matches ISC-257 unknown-sort safety).
- [x] ISC-275: After building the candidate set, reach.ts batch-fetches warmth via ONE call to `getMessageCountsByPeople(candidateIds)` + ONE call to `listLastContactByPeople(candidateIds)` — no N+1, no per-candidate query.
- [x] ISC-276: `sort="epistemic"` produces the existing pre-v0.3.0-C candidate ordering byte-identical (regression-safe). The new `messages` field is additive on each row.
- [x] ISC-277: `sort="warmth"` re-orders candidates by `messages.total` DESC, tiebreak `messages.lastAt` DESC (nulls last), tiebreak `score` DESC, tiebreak name ASC. Zero-message intermediaries fall to the bottom (NULLS-LAST).
- [x] ISC-278: Anti: warmth NEVER mixes into the `score` field. `score` remains the epistemic confidence (1.0 for manual, derived.confidence otherwise) regardless of sort mode. Verified by reading the returned candidate shape — `score` field unchanged across both sort modes.

*UI surface — /queries/reach/[id]*

- [x] ISC-279: Each candidate row gains a warmth pill: `data-testid="reach-warmth"` showing `"{total} msgs · last YYYY-MM-DD"` when `total > 0`, or `"—"` when `total === 0`. Always renders (render-zeros-not-absence).
- [x] ISC-280: Sort toggle above the candidate list: two buttons, `data-testid="reach-sort-epistemic"` and `data-testid="reach-sort-warmth"`. The active button has `aria-pressed="true"`, the inactive `aria-pressed="false"`.
- [x] ISC-281: Default URL (`/queries/reach/[id]` with no `?sort`) renders Epistemic ordering, Epistemic button has `aria-pressed="true"`.
- [x] ISC-282: `/queries/reach/[id]?sort=warmth` renders Warmth ordering, Warmth button has `aria-pressed="true"`. List re-orders accordingly.
- [x] ISC-283: Toggle click navigates to the same path with the updated `?sort=…` param. Implementation uses Next 14 `Link` (server-rendered nav, matches existing /people sort=last_contact pattern); the bookmarked URL contains the param so back/forward + reload preserve state.
- [x] ISC-284: `/queries/reach/[id]?sort=garbage` (and any unknown value) falls back to Epistemic ordering with the Epistemic button active — no SQL error, no UI crash (parity with ISC-257).
- [x] ISC-285: Direct-connection panel (`data-testid="reach-direct"`) renders identically across both sort modes — sort affects candidate ordering only, not the panel above.
- [x] ISC-286: "This is you" self-panel (`data-testid="reach-self"`) renders identically across both sort modes; sort param has no effect on the self path.
- [x] ISC-287: Empty-candidates state renders the same message in both sort modes — no warmth-specific empty copy. (Sort is a re-ranking, not a filter.)

*SQL isolation (ISC-266 promoted to v0.3.0-C)*

- [x] ISC-288: ISC-265 still 0 hits — reach.ts, the /queries/reach/[id] page, and any new helpers do NOT import from `@/lib/queries/messages` outside the messages module's own files. Wait — reach.ts MUST import the messages batch helpers; the grep excludes reach.ts? No — ISC-265 forbids `manualEdges.ts` and `derivedEdges.ts` from importing messages. reach.ts importing messages is the COMPOSITION pattern and is the correct direction. Restate: ISC-265 grep target unchanged (manualEdges + derivedEdges still 0 hits); reach.ts is permitted because reach is a composition layer not a peer epistemic category.
- [x] ISC-289: ISC-266 still 0 hits — the SQL-reference grep `rg -nE '(FROM|JOIN|INTO|UPDATE)\s+messages\b' src/ --glob '!src/lib/queries/messages.ts' --glob '!src/lib/linkedin/ingest.ts' --glob '!src/lib/db/**' --glob '!scripts/**' --glob '!**/*.test.ts'` returns 0 hits after the slice. reach.ts MUST NOT reach into the `messages` table directly — all reads go through `getMessageCountsByPeople` / `listLastContactByPeople`.

*Tests*

- [x] ISC-290: `src/lib/queries/messages.test.ts` gains ≥2 new cases: (a) `getMessageCountsByPeople([topId, "no-such-id"])` returns Map size 1 with the top id keyed to its correct counts; (b) empty array → empty Map.
- [x] ISC-291: New `src/lib/queries/reach.test.ts` (or extension to existing) covers: (a) `findReachToPerson(X, {sort:"epistemic"})` candidate order matches pre-v0.3.0-C snapshot byte-identical; (b) `findReachToPerson(X, {sort:"warmth"})` re-orders correctly on a fixture where two intermediaries have equal epistemic score but differ in `messages.total`; (c) zero-message intermediaries appear at the bottom in warmth mode with `messages.total === 0`; (d) `messages` field always present on every candidate.

*Build + probe*

- [x] ISC-292: `bun run typecheck` exits 0 after the slice (no new TS errors).
- [x] ISC-293: `bun test` — full suite green, including new messages + reach cases. No regression on the 28 existing tests from v0.3.0-A/B.
- [x] ISC-294: `scripts/verify-v030c.ts` Playwright probe — visits `/queries/reach/[id]` of a real reach-rich target (e.g. a PwC España connection with ≥5 candidates), asserts: warmth pill present on every row; toggle between Epistemic and Warmth changes the visible row order; `aria-pressed` flips correctly; `data-testid="reach-direct"` panel content unchanged; zero `pageerror`, zero console error, zero non-localhost requests.
- [x] ISC-295: Anti: `bun run build` succeeds; `bun run start` boots without runtime errors.
- [x] ISC-296: TTFB on `/queries/reach/[id]` (prod build, default sort) does not regress >20% vs the v0.3.0-B baseline. Measured via `time curl -s -o /dev/null http://localhost:3000/queries/reach/[id]` once warm.

*Saved-query bookmarks*

- [x] ISC-297: `SaveBookmark` on `/queries/reach/[X]?sort=warmth` round-trips correctly — POST creates the bookmark with the full URL including the sort param, DELETE removes it, the saved-queries sidebar lists the bookmarked URL with the param preserved. No schema change (bookmarks store URLs as strings).

*Anti-criteria (regression + scope guard)*

- [x] ISC-298: Anti: `/people/[id]` Messages section (v0.3.0-B) renders identically — v0.3.0-C touches reach.ts and the reach page only; the messages module's existing surface (`getMessageStatsForPerson`, `listMessageThreadForPerson`, `listAllLastContactDesc`, `listLastContactByPeople`) returns byte-identical results.
- [x] ISC-299: Anti: NO new SQL migration in this slice. Schema unchanged. `drizzle-kit` diff is empty.
- [x] ISC-300: Anti: v0.3.0-C is read-side only — no edits to `manual_edges`, `derived_edges`, `messages`, `connections`, `people`, or any other table during query execution. Grep confirms reach.ts contains only `SELECT` SQL and `db.select(...)` Drizzle reads, zero `INSERT|UPDATE|DELETE`.

**v0.3.2 — warm-path polish (ORM-isolation ISC + adversarial fixtures + Mutuality sort mode)** *(2026-05-21)*

Pursue: close the four Advisor-flagged follow-ups from v0.3.1 and complete the warm-path arc. Three sub-slices: (A) **hardening** — formalize the ORM-symbol probe as ISC-301 (parallel to ISC-265 JS-import + ISC-289 SQL-keyword), and add adversarial reach fixtures that prove the ranking diverges visibly. (B) **Mutuality** — third sort mode `sort=mutuality` on `/queries/reach/[id]`, scalar = `min(sent, received)` (preference for two-way relationships). The toggle becomes a three-button group (Epistemic ↔ Warmth ↔ Mutuality). (C) **release** — verify suite + advisor + commit + tag `v0.3.2`.

*v0.3.2-A: ORM-symbol probe formalization*

- [x] ISC-301: New numbered ISC anti-criterion `ISC-301` formalizes the ORM-symbol probe surfaced by Advisor in v0.3.0-C — `rg -n 'schema\.messages|from\(messages\)|insertMessages|messagesTable\.|messages_table' src/ --glob '!src/lib/queries/messages.ts' --glob '!src/lib/queries/messages.test.ts' --glob '!src/lib/linkedin/ingest.ts' --glob '!src/lib/db/**' --glob '!scripts/**' --glob '!**/*.test.ts'` returns 0 hits. Same whitelist shape as ISC-289 SQL-keyword grep; covers Drizzle `db.select().from(schema.messages)`, `db.$count(schema.messages, ...)`, `db.insert(schema.messages)`, and any future `messagesTable` alias.
- [x] ISC-302: ISC-265 (JS-import grep), ISC-289 (SQL-keyword grep), and ISC-301 (ORM-symbol grep) all 0 hits at commit. Three-layer enforcement of the messages epistemic-category boundary is live.

*v0.3.2-A: adversarial reach fixtures*

- [x] ISC-303: `reach.test.ts` gains an adversarial test for a target where **every reach candidate has zero warmth** (`messages.total === 0` across all candidates). For such a target: (a) `sort=warmth` and `sort=epistemic` produce IDENTICAL candidate orderings (no tiebreak signal from messages); (b) toggle still renders without crashing; (c) warmth pill renders "—" on every row.
- [x] ISC-304: `reach.test.ts` gains an adversarial test for a target with **divergent rankings between epistemic and warmth modes**. Picks a target where the top-1 candidate by epistemic score has zero warmth AND there exists another candidate with non-zero warmth at lower epistemic score. Asserts: (a) sort=epistemic top-1 ≠ sort=warmth top-1 for this target; (b) both orderings cover the same candidate set.
- [x] ISC-305: If the dataset contains no target matching the divergent-rankings criterion, the test logs a "skip — no adversarial divergent target in dataset" message rather than passing silently. (Honest "skip" beats silent "pass".)

*v0.3.2-B: Mutuality scalar on messages composition*

- [x] ISC-306: `ReachCandidate.messages` shape gains a derived `mutuality` field: `mutuality = min(messages.sent, messages.received)`. Always present (zero-when-none); computed inside reach.ts composition; never persisted in any table. Anti-mixing per ISC-278 still holds — mutuality lives in the `messages` sub-object, NOT in `score`.
- [x] ISC-307: Computation: `mutuality = Math.min(sent, received)` at the composition step (after warmth batch fetch). Integer scale matches `total`/`sent`/`received` — easy display, no float-rounding ambiguity. Reasoning logged at the sort-closure entry.
- [x] ISC-308: Anti: `mutuality === 0` for one-way relationships (sent>0, received=0 OR sent=0, received>0). Test: pick a real-data person where messages are predominantly one-direction and assert `mutuality === Math.min(stats.sent, stats.received)`.

*v0.3.2-B: sort=mutuality mode*

- [x] ISC-309: `parseReachSort()` accepts a third value `"mutuality"`. Unknown / undefined / null / unrecognised → still falls back to `"epistemic"` (ISC-274 contract preserved).
- [x] ISC-310: `ReachSort` type is now `"epistemic" | "warmth" | "mutuality"`. `findReachToPerson(..., sort)` accepts all three; default remains `"epistemic"`.
- [x] ISC-311: `sort="mutuality"` ordering: `messages.mutuality DESC → messages.lastAt DESC (NULLS-LAST) → score DESC → name ASC`. Deterministic total order on the zero-tail (same shape as the warmth tiebreak chain).
- [x] ISC-312: `sort="epistemic"` ordering byte-identical to pre-v0.3.2 (regression-safe); `sort="warmth"` ordering byte-identical to v0.3.0-C/v0.3.1 (regression-safe). The new mutuality field added to the candidate shape does NOT alter either prior ordering.
- [x] ISC-313: Anti: mutuality never mixes into `score` or `messages.total`. Three independent ranking signals coexist on every candidate; sort mode picks which one drives ordering.

*v0.3.2-B: UI — three-button sort toggle*

- [x] ISC-314: `/queries/reach/[id]` sort toggle becomes a three-button group: Epistemic | Warmth | Mutuality. `data-testid="reach-sort-mutuality"` on the new button. The button widths and visual rhythm match the two existing buttons.
- [x] ISC-315: Active state: exactly ONE button has `aria-pressed="true"`; the other two have `aria-pressed="false"`. Verified by playwright sum-of-`aria-pressed=true` = 1 across all three modes.
- [x] ISC-316: Default URL (`/queries/reach/[id]` with no `?sort`) → Epistemic active (ISC-281 preserved). `?sort=warmth` → Warmth active (ISC-282 preserved). `?sort=mutuality` → Mutuality active. `?sort=garbage` → falls back to Epistemic active (ISC-284 preserved).
- [x] ISC-317: Each candidate row now shows BOTH the warmth pill (existing, `data-testid="reach-warmth"`) AND a new mutuality pill (`data-testid="reach-mutuality"`) — both always render (render-zeros-not-absence). Mutuality pill shows `"↔ N"` when `total > 0`, or `"—"` when zero. The `↔` is a literal Unicode character; no icon font.
- [x] ISC-318: The heading above the candidate list reflects the active sort: "Strongest reach" (epistemic), "Warmest reach" (warmth — existing), "Most mutual reach" (mutuality — new).

*v0.3.2-B: tests*

- [x] ISC-319: `reach.test.ts` gains a `parseReachSort("mutuality")` case → returns `"mutuality"`.
- [x] ISC-320: `reach.test.ts` gains a `sort="mutuality"` ordering test: monotone non-increasing on `messages.mutuality`; tiebreak on `lastAt` NULLS-LAST; zero-mutuality candidates fall to the bottom (parallel to the warmth NULLS-LAST test).
- [x] ISC-321: `reach.test.ts` gains a `messages.mutuality` invariant test: for every candidate, `messages.mutuality === Math.min(messages.sent, messages.received)`.
- [x] ISC-322: `messages.test.ts` is NOT modified — the messages module's public surface is unchanged. `getMessageCountsByPeople` returns `{sent, received, total}`; mutuality derivation is reach.ts's concern, not the messages module's.

*v0.3.2-release: verify + advisor + tag*

- [x] ISC-323: `scripts/verify-v030c.ts` is extended (or a sibling `verify-v032.ts` is added) to cover the new mutuality surface — three-button toggle, mutuality pill renders, `?sort=mutuality` orders correctly, `aria-pressed` sum-is-1 invariant. The existing 18/18 assertions still pass.
- [x] ISC-324: `bun run typecheck` → exit 0. No new TS errors.
- [x] ISC-325: `bun test` → all tests pass (49 prior + new v0.3.2 tests). 0 failures.
- [x] ISC-326: Advisor fires at commitment-boundary before `phase: complete`. Any substantive catches land as ISA Decisions + (where applicable) new ISCs. Trivial / workflow-FP catches are still documented.
- [x] ISC-327: Annotated tag `v0.3.2` cut at the slice commit; pushed to `origin/main` + `refs/tags/v0.3.2` (per the v0.3.1 push pattern).
- [x] ISC-328: Anti: no new SQL migration. `git diff src/lib/db/schema.ts` → empty.
- [x] ISC-329: Anti: reach.ts and messages.ts INSERT/UPDATE/DELETE count = 0 (read-side composition only, per ISC-300 / ISC-329 promotion).
- [x] ISC-330: Anti: `/people/[id]` Messages section, `/people?sort=last_contact`, and `/queries/reach/[id]?sort=epistemic` and `?sort=warmth` ALL render byte-identical to v0.3.1 — v0.3.2 is additive only (new sort mode + new pill; no modifications to existing surfaces).

**v0.3.3 — hardening (Advisor v0.3.2 conjectures, tractable subset)** *(2026-05-21)*

Pursue: close the tractable subset of the v0.3.2 Advisor conjectures in one slice. Three deferred to later slices with justification: (1) **Mass-channel exclusion** — needs a 1-to-many detector + sidecar column on `messages`; too big for hardening. (2) **Time-decay parity** — needs explicit decay-shape spec before code. (8) **CI gate enforcement** — needs husky / GitHub Actions; bigger plumbing change. The other seven all land in this slice.

- [x] ISC-331: ISC-301 regex extended to catch `import * as` namespace imports targeting the messages module. New combined probe runs against src/ with same whitelist (messages.ts + ingest.ts + db/scripts/tests). 0 hits at commit.
- [x] ISC-332: ISC-301 regex extended to catch aliased named imports — `import { messages as M }` patterns. 0 hits at commit.
- [x] ISC-333: `scripts/test-alias-probe.ts` — runs the extended ISC-301 regex against a small fixture string containing 3 violating + 3 benign lines, asserts exactly 3 hits. Self-test for the regex (not a runtime gate).
- [x] ISC-334: `reach.test.ts` adds a meta-assertion that `pickTargetWithReachCandidates()` returns NON-NULL on the current dataset — fails loudly if the fixture-picker is broken (so a refactor doesn't silently skip every adversarial test).
- [x] ISC-335: `reach.test.ts` adds a meta-assertion that the divergent-rankings adversarial test actually ran (top-1 differed between modes), NOT silently skipped. Loud failure on broken-detector regression.
- [x] ISC-336: `scripts/verify-v030c.ts` adds a back-button case — toggle Epistemic → Warmth → Mutuality, then browser-back. Assert URL returns to `?sort=warmth` AND Warmth button has `aria-pressed=true`. Back again → default URL → Epistemic active.
- [x] ISC-337: `scripts/verify-v030c.ts` adds the default-elision case — navigate to `?sort=epistemic` (param explicit). Assert Epistemic active. Confirms the parser is forgiving and the param round-trips even when redundant.
- [x] ISC-338: Anti: `?sort=epistemic` URL bookmark round-trips (POST → page → DELETE) cleanly — same plumbing as ?sort=warmth, just a different param value.
- [x] ISC-339: ISC-301 spec edge codified — tagged-template SQL precedence: `db.all(sql\`SELECT ... FROM messages\`)` outside the whitelist trips ISC-289 (SQL-keyword) AND ISC-301 (the `messages` identifier appears in the template literal). Practical precedence: ISC-289 catches it first. Either trip is sufficient.
- [x] ISC-340: ISC-301 spec edge codified — dynamic imports (`await import("…")`) and `require()` calls bypass static text probes. Explicit non-goal for v0.3.3's regex gate; AST-based probe is a future option.
- [x] ISC-341: ISC-301 spec edge codified — `import type { … } from "@/lib/queries/messages"` is compile-time-only and ALLOWED even from restricted modules. The probe regex matches `import { … }` form (bare), not `import type { … }` form. Documented inline.
- [x] ISC-342: `scripts/check-isolation.ts` — runs ALL THREE isolation probes (ISC-265 + ISC-289 + ISC-301-extended) and reports `3/3 clean` or surfaces violations with file + line. Exit 0 on clean, exit 1 on any violation. Single command callable from any session.
- [x] ISC-343: `scripts/check-isolation.ts` emits offending file + line on violation (not just count) — useful for grep-back-to-source after a regression.
- [x] ISC-344: `bun run typecheck` → exit 0. No new TS errors.
- [x] ISC-345: `bun test` — full suite. 55 prior tests still green + 2 new meta-assertions (ISC-334/335) pass. 0 failures.
- [x] ISC-346: `scripts/verify-v030c.ts` — passes v0.3.1+v0.3.2 assertions PLUS new back-button + default-elision + epistemic-bookmark cases. Probe count ≥ 33 (was 29 at v0.3.2; +4 new).
- [x] ISC-347: `scripts/check-isolation.ts` exits 0 on the current source tree.
- [x] ISC-348: Anti: no new SQL migration. `git diff src/lib/db/schema.ts` → empty.
- [x] ISC-349: Anti: read-side only. `grep -nE 'INSERT|UPDATE|DELETE' src/lib/queries/reach.ts src/lib/queries/messages.ts scripts/check-isolation.ts scripts/test-alias-probe.ts` → 0 hits.
- [x] ISC-350: Annotated tag `v0.3.3` cut + pushed to origin (per v0.3.0..v0.3.2 pattern).
- [x] ISC-351: Anti regression: every v0.3.1+v0.3.2 behaviour on `/queries/reach/[id]` byte-identical. v0.3.3 is a verification-and-spec slice; no UI changes.
- [x] ISC-352: Advisor fires at commitment-boundary; substantive items land as Decisions / new ISCs.

**v0.3.4 — /graph perf (collapse N×1 correlated subquery for company_name)** *(2026-05-21)*

Pursue: `/graph` warm-cache TTFB on real data sits at ~2.7s dev-mode (baseline measured this session: default 2.3-2.9s, minConfidence=0 2.6-2.9s). The `assembleNetworkGraph` candidates query (UNION ALL 4×) is index-served and not the bottleneck. The slow path is the **node-metadata fetch**, which runs a correlated subquery per row (joins positions × companies + ORDER BY + LIMIT 1, executed 150× in a loop). Replace with a single batched query using a window function. Same selection rule, same output shape. No schema migration.

- [x] ISC-353: Baseline TTFB captured (dev mode, warm cache, 3 runs each): `/graph` default 2.3s/2.9s/2.3s; `/graph?minConfidence=0` 2.9s/2.7s/2.6s. Pre-optimization reference point.
- [x] ISC-354: Correlated `(SELECT c.name FROM positions po JOIN companies c ... LIMIT 1)` subquery replaced with a batched window-function query: `ROW_NUMBER() OVER (PARTITION BY po.person_id ORDER BY <same chain>)` then filter `rn = 1`. Result built into a `Map<personId, companyName>`; the people SELECT no longer carries the inline subquery.
- [x] ISC-355: Selection rule preserved EXACTLY — same ORDER BY chain (`CASE origin WHEN 'declared' THEN 0 ELSE 1 END, current DESC, COALESCE(start_date, '0000-00-00') DESC`). Window function reproduces LIMIT 1 semantics; rn=1 picks the same row the correlated subquery picked.
- [x] ISC-356: After-optimization TTFB measured (dev mode, warm cache, 3 runs each). Target: `/graph` default warm TTFB drops by ≥30% vs baseline. If miss, revert and document the non-finding.
- [x] ISC-357: Anti regression — `/graph` rendered page on real data shows identical node-company labels to v0.3.3. Verified by comparing assembled-graph output object before and after via a one-off script that hits both code paths against the real DB.
- [x] ISC-358: `assembleNetworkGraph()` return shape unchanged (`GraphNode.company` field type + nullability + format identical to v0.3.3).
- [x] ISC-359: `bun run typecheck` → exit 0.
- [x] ISC-360: `bun test` → 57 pass / 0 fail (no regressions in any other surface).
- [x] ISC-361: `scripts/verify-v030c.ts` still 34/34 (v0.3.4 doesn't touch `/queries/reach/*`).
- [x] ISC-362: `scripts/check-isolation.ts` still 3/3 clean (v0.3.4 doesn't touch the messages module).
- [x] ISC-363: Anti: no new SQL migration. `git diff src/lib/db/schema.ts` → empty. Window function is standard SQL; libsql supports it.
- [x] ISC-364: Advisor fires at commitment-boundary. Particular focus: window-function ORDER BY equivalence to the correlated-subquery ORDER BY (NULL handling, tie-break determinism).
- [x] ISC-365: Annotated tag `v0.3.4` cut + pushed to origin.
- [x] ISC-366: ISA Decision documenting (a) the candidates UNION ALL 4× is left untouched — already index-served per the schema indexes (`manual_edges_a_idx`, `manual_edges_b_idx`, `derived_edges_a_idx`, `derived_edges_b_idx`); (b) the chosen optimization scope is minimum-viable for the measured impact.

**v0.4.0 — graph controls (cap dropdown + company picker + scope toggle)** *(2026-05-21)*

Pursue: `/graph` gains three new URL-bound filters in the existing panel — node cap, company restriction, and a current/ever scope toggle. Composition order is **filter → cap**: kinds + minConfidence + minDegree + company-scope narrow the candidate set first; cap caps what remains. The graph's existing "owner always renders" rule is preserved across all combinations.

*Server-side query (graph.ts)*

- [x] ISC-367: `GraphFilters` gains `cap?: number`, `companyId?: string`, `scope?: "current" | "ever"`. All optional; defaults preserved (cap = NODE_CAP, no companyId = no filter, scope ignored without companyId).
- [x] ISC-368: `cap` value is clamped to `[1, MAX_NODE_CAP=500]` before use; `undefined`/`null`/non-numeric → falls back to default NODE_CAP. Anti-injection: no SQL string interpolation; cap is JS-side `Math.min`/`Math.max`.
- [x] ISC-369: `companyId` is treated as an opaque string id. If the id doesn't exist in `companies`, the filter is silently ignored (no error). Same posture as `/people?sort=garbage` fallback (ISC-257).
- [x] ISC-370: `scope === "current"` mode: candidates restricted to people whose **current employer** (per the v0.3.4 ROW_NUMBER selection rule with `po.id ASC` tiebreaker) equals `companyId`. SQL composition: a `WITH current_employer AS (...)` CTE prefix joined into the candidates inner query.
- [x] ISC-371: `scope === "ever"` mode: candidates restricted to people who EVER had a position at `companyId` (`EXISTS (SELECT 1 FROM positions WHERE person_id = ... AND company_id = ? AND tenant_id = ?)`). Strictly broader than `current` on real data.
- [x] ISC-372: Composition order — kinds + minConfidence + minDegree + company-scope filter narrow the candidate set FIRST, then candidates are sorted, then cap is applied. "100 at PwC España" returns ≤100 people at PwC, not 100 of which some happen to be there.
- [x] ISC-373: Owner always rendered. If owner's current employer = `companyId`, owner is among the filtered candidates. If not, owner is added unconditionally AFTER candidate selection (preserves the load-bearing v0.2.0 rule). With company filter active, the owner may render disconnected — that's the correct behaviour (you asked "who at X" and you, owner, aren't there).
- [x] ISC-374: `GraphMeta` gains optional `companyId`, `companyName`, `scope`, `cap` (when overridden from default). Lets the UI surface "M / N (cap) people at X" badges without re-fetching.
- [x] ISC-375: Anti: empty result when `companyId` matches no people → returns the standard empty-assembled response (per `emptyAssembled`), NOT a crash.

*Server-side / API*

- [x] ISC-376: New `searchCompanies(q, limit, tenantId)` in `src/lib/queries/companies.ts` — mirrors `searchPeople` shape: trimmed query (≥2 chars enforced at the API layer), case-insensitive substring match on `companies.normalized_name`, default limit 8, ordered by people-count DESC then name ASC. Returns `{ id, name, peopleCount }[]`.
- [x] ISC-377: New `/api/companies/search?q=...` endpoint mirrors `/api/people/search`. Returns `{ results: [...] }`. Empty for `q.length < 2`. Same `runtime: "nodejs"` + `dynamic: "force-dynamic"` posture.

*UI components*

- [x] ISC-378: New `CompanyPicker` client component at `src/components/company-picker.tsx` — typeahead with AbortController-debounced fetch to `/api/companies/search`, same shape as `PersonPicker` (`/components/person-picker.tsx`). Triggers a callback on selection (not router.push — caller wires URL update).
- [x] ISC-379: `GraphFilters` panel (`src/components/graph-filters.tsx`) gains: (a) a node-cap dropdown with snap points 50 / 100 / 150 / 250 / 500, (b) the CompanyPicker (typeahead), (c) a Current ↔ Ever scope toggle (two-button group; `aria-pressed`; matches the v0.3.2 sort toggle pattern). Scope toggle is HIDDEN when no company is selected (Q2-a).
- [x] ISC-380: When a company IS selected, a small "× clear" affordance appears next to the company name so the filter can be removed without typing.
- [x] ISC-381: Cap dropdown labels reflect current value with active style; clearable to default (150) via the dropdown's default option.
- [x] ISC-382: All three new controls URL-bind via the existing `useSearchParams` + `pushState` synchroniser pattern (the one v0.2.0-B established). No popstate listener.

*Page (/graph)*

- [x] ISC-383: `/graph/page.tsx` reads `searchParams.cap`, `searchParams.company`, `searchParams.scope`; passes them through to `assembleNetworkGraph` after the clamp/validate steps.
- [x] ISC-384: Page heading reflects the active company filter when set (e.g., "Graph · PwC España (current)"); default heading unchanged otherwise.
- [x] ISC-385: Stats grid (`data-testid="graph-stats"`) shows the active cap value when overridden from default and the company name when filtered.

*Tests*

- [x] ISC-386: Unit test — `assembleNetworkGraph({ cap: 50 })` returns exactly `min(50, candidates-after-filter)` nodes (plus owner if not already present). Real-data smoke: cap=50 on default filters → 50 nodes; cap=10 → 10 nodes; cap=1000 → ≤500 nodes (MAX_NODE_CAP enforced).
- [x] ISC-387: Unit test — `assembleNetworkGraph({ companyId: <pwc-id>, scope: "current" })` returns only nodes whose current employer is PwC España (plus owner unconditionally). Verified by JOIN-ing the returned node IDs against `positions` directly.
- [x] ISC-388: Unit test — `scope: "ever"` returns a strict superset of `scope: "current"` for the same companyId (same dataset). At least one company in the real data has the strict-superset property (e.g., a former employer the owner has connections at).
- [x] ISC-389: Unit test — composition: `{ companyId: X, cap: 10 }` returns ≤10 nodes at X (filter-then-cap, not cap-then-filter).
- [x] ISC-390: Unit test — invalid `companyId` returns empty assembled graph (not a crash, not the full graph).
- [x] ISC-391: Unit test — `searchCompanies("pwc", 5)` returns ≤5 results, PwC España first (highest people-count), no SQL injection on quote-rich input.

*Build + probe*

- [x] ISC-392: `scripts/verify-v040.ts` Playwright probe: visit `/graph` with default URL, then with `?cap=50`, then `?company=<pwc-id>`, then `?company=<pwc-id>&scope=ever`, then `?company=<pwc-id>&cap=20`. For each: assertions on the rendered DOM (node count visible in stats grid; active filter chips; aria-pressed correctness on scope toggle; correct heading).
- [x] ISC-393: `bun run typecheck` → exit 0.
- [x] ISC-394: `bun test` — all prior 57 + new ISC-386..391 pass. 0 failures.
- [x] ISC-395: `scripts/check-isolation.ts` — 3/3 clean (v0.4.0 doesn't touch the messages module; the new company filter uses `positions` + `companies`).
- [x] ISC-396: Anti: no SQL migration. `git diff src/lib/db/schema.ts` → empty. Company filter uses existing tables.

*Release*

- [x] ISC-397: Annotated tag `v0.4.0` cut + pushed to origin (first minor bump since the warm-path arc).
- [x] ISC-398: Anti regression: default `/graph` URL (no params) renders byte-identical node and edge sets to v0.3.4. Verified by comparing assembled-graph output before/after.
- [x] ISC-399: Anti: existing `kinds=`, `minConfidence=`, `minDegree=` filters work identically — no parameter name collisions or precedence regressions.
- [ ] ISC-400: Advisor fires at commitment-boundary. Particular focus: (a) `scope=ever` semantics — should the "EXISTS any position" check be tenant-scoped (it must); (b) composition ordering correctness when company filter excludes the owner; (c) cap=1 edge case (owner-only).

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
| ISC-96..97 | migration | drizzle migrate + sqlite_master probe | saved_queries present, UNIQUE enforced, second run no-op | sqlite3 |
| ISC-98..108 | ui | playwright at /queries/at-company across param combos | expected selectors + counts | playwright firefox |
| ISC-109..112 | http | curl POST/DELETE /api/bookmarks | status + JSON shape | curl -i |
| ISC-113..114 | ui | playwright at /queries/at-company | bookmark affordance + listing visible after POST | playwright firefox |
| ISC-115 | http+ui | bad-input probes | 200/404, no crash | curl + playwright |
| ISC-116..123 | ui | playwright at /queries/worked-with and /queries/worked-with/[id] | expected selectors + counts | playwright firefox |
| ISC-124..130 | ui | playwright at /queries/by-year and ?year=YYYY | histogram + drilldown render | playwright firefox |
| ISC-131..141 | ui | playwright at /queries/reach and /queries/reach/[id] | reach list correct shape + special states | playwright firefox |
| ISC-142..144 | ui | playwright across all three pages | sidebar present, 0 errors, 0 non-localhost | playwright firefox |
| ISC-145 | http | curl POST/DELETE bookmarks with the new URL shapes | 201 → 204 round-trip | curl |
| ISC-242..247 | unit + integration | bun test against messages.test.ts; real-data smoke via sqlite3 SELECT | 4+ unit cases pass; stats counts match raw COUNT(*) | bun test + sqlite3 |
| ISC-248..253 | ui | playwright at /people/[id] of top-messaged contact | messages-section visible, stats correct, thread items present, both directions render | playwright firefox |
| ISC-254..259 | ui+integration | playwright at /people and /people?sort=last_contact | last-contact column present; sort ordering verified; 2-query budget enforced via dev DB query log | playwright firefox + manual query count |
| ISC-260..261 | unit + real-data | bun test + DB introspection | 4 unit pass + top-1 person has ≥10 messages | bun test + sqlite3 |
| ISC-262 | ui | scripts/verify-v030b.ts | 0 pageerror, 0 non-localhost, all assertions pass | playwright firefox |
| ISC-263 | build | bun run typecheck | exit 0 | bun |
| ISC-264 | ui | hydration mismatch probe | 0 warnings in pageerror | playwright firefox |
| ISC-265 | grep | anti-import probe | 0 hits | grep -rn |
| ISC-266 | grep | SQL-reference probe across src/ excluding messages module + writers | 0 hits | rg |
| ISC-267 | ui | playwright at /people/[id] of person with 0 messages | messages-stats present with data-stat="sent" = "0" | playwright firefox |
| ISC-268..272 | unit + integration | bun test against messages.test.ts (batch helper); cross-check against getMessageStatsForPerson | new tests pass; counts match | bun test + sqlite3 |
| ISC-273..278 | unit + integration | bun test against reach.test.ts (composition + sort modes) | composition tests pass; epistemic sort byte-identical to pre-v0.3.0-C | bun test |
| ISC-279..287 | ui | playwright at /queries/reach/[id] across sort modes + edge cases | warmth pills render; aria-pressed flips; reach-direct + reach-self unchanged | playwright firefox |
| ISC-288..289 | grep | JS-import + SQL-reference isolation probes | both 0 hits | grep -rn + rg |
| ISC-290..291 | unit | new test cases on messages + reach modules | all assertions pass | bun test |
| ISC-292..293 | build + test | typecheck + full suite | exit 0; no regression on 28 prior tests | bun |
| ISC-294 | ui | scripts/verify-v030c.ts | 0 pageerror, 0 non-localhost, all assertions pass | playwright firefox |
| ISC-295 | build | bun run build + bun run start | exit 0; server boots clean | bun |
| ISC-296 | perf | curl-timed TTFB before vs after | <20% regression | curl + time |
| ISC-297 | http+ui | POST/DELETE /api/bookmarks with sort=warmth URL | round-trip clean; sidebar lists it | curl + playwright |
| ISC-298 | ui | playwright at /people/[id] of top-messaged contact | messages section identical to v0.3.0-B snapshot | playwright firefox |
| ISC-299 | migration | drizzle-kit diff | empty | bun drizzle:diff |
| ISC-300 | grep | reach.ts insert/update/delete scan | 0 hits | grep -nE |

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
| schema-migration-0004 *(W5a)* | ISC-96..97 | — | no (first in W5) |
| at-company-page *(W5a)* | ISC-98..108 | schema-migration-0004 | yes (with bookmarks-api) |
| bookmarks-api *(W5a)* | ISC-109..112 | schema-migration-0004 | yes |
| bookmarks-ui *(W5a)* | ISC-113..115 | bookmarks-api, at-company-page | no |
| worked-with-page *(W5b)* | ISC-116..123 | (existing manualEdges + derivedEdges queries) | yes (with by-year-page) |
| by-year-page *(W5b)* | ISC-124..130 | (existing connections table) | yes (with worked-with-page) |
| reach-page *(W5b)* | ISC-131..141 | (existing manual + derived + connections) | no |
| graph-forward-dark *(v0.2.0-A)* | retroactive — see Decisions 2026-05-19 v0.2.0 | post-v0.1.0 polish | no (single-author UI arc) |
| graph-filters-server *(v0.2.0-B)* | ISC-203..207 | graph-forward-dark | yes (with graph-filters-ui) |
| graph-filters-ui *(v0.2.0-B)* | ISC-208..215 | graph-forward-dark | yes (with graph-filters-server) |
| min-degree-filter *(v0.2.0-C)* | ISC-216..218 | graph-filters-server | yes (with nav-progress) |
| nav-progress + loading skeletons *(v0.2.0-C)* | ISC-219..220 | graph-forward-dark | yes (with min-degree-filter) |
| edge-cap *(v0.2.0-release)* | ISC-221..223 | graph-filters-server | no |
| verify-w6-refresh *(v0.2.0-release)* | ISC-224..225 | edge-cap | no |
| messages-parser *(v0.3.0-A)* | ISC-227..231, ISC-239, ISC-241 | (existing JSZip + parseCSV path) | yes (with messages-ingest if record types lock first) |
| messages-ingest *(v0.3.0-A)* | ISC-232..238, ISC-240 | messages-parser | no |
| messages-query-module *(v0.3.0-B)* | ISC-242..247, ISC-260 | messages-ingest | yes (with messages-test) |
| messages-person-detail *(v0.3.0-B)* | ISC-248..253 | messages-query-module | yes (with messages-people-list) |
| messages-people-list *(v0.3.0-B)* | ISC-254..259 | messages-query-module | yes (with messages-person-detail) |
| verify-v030b *(v0.3.0-B)* | ISC-261..265 | messages-person-detail, messages-people-list | no (gate) |
| messages-batch-helper *(v0.3.0-C)* | ISC-268..272, ISC-290 | messages-query-module | yes (with reach-composition if signatures lock first) |
| reach-composition *(v0.3.0-C)* | ISC-273..278, ISC-291 | messages-batch-helper | no |
| reach-warmth-ui *(v0.3.0-C)* | ISC-279..287, ISC-297 | reach-composition | no |
| isolation-gates-v030c *(v0.3.0-C)* | ISC-288..289, ISC-298..300 | reach-warmth-ui | yes (at VERIFY) |
| verify-v030c *(v0.3.0-C)* | ISC-292..296 | reach-warmth-ui, isolation-gates-v030c | no (gate) |
| orm-isolation-isc *(v0.3.2-A)* | ISC-301..302 | (existing messages.ts + ingest.ts whitelist) | yes (with adversarial-fixtures) |
| adversarial-fixtures *(v0.3.2-A)* | ISC-303..305 | (existing reach.test.ts) | yes (with orm-isolation-isc) |
| mutuality-scalar *(v0.3.2-B)* | ISC-306..308 | reach-composition | no |
| mutuality-sort-mode *(v0.3.2-B)* | ISC-309..313 | mutuality-scalar | no |
| mutuality-ui *(v0.3.2-B)* | ISC-314..318 | mutuality-sort-mode | no |
| mutuality-tests *(v0.3.2-B)* | ISC-319..322 | mutuality-ui | yes (with verify-v032) |
| verify-v032 *(v0.3.2-release)* | ISC-323..326 | mutuality-ui | no (gate) |
| release-v032 *(v0.3.2-release)* | ISC-327..330 | verify-v032 | no |

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
- 2026-05-13 (W5a): **Query URL uses `?company=ID` not `[id]` segment.** Originally scoped as `/queries/at-company/[id]` but flipped to a query param so the entire query state (company + status + sort) sits in the URL search-string and a saved bookmark is just `the URL`. With `[id]`, the URL would have to be reconstructed from path + query, and switching companies would require a navigation rather than a form submit.
- 2026-05-13 (W5a): **Bookmark UNIQUE is on `(tenant_id, name)` not URL.** Two bookmarks with the same URL but different names is a legitimate UX: "Current PwC España colleagues" and "PwC España network" point at the same query but cluster the same dataset under different labels. Two bookmarks with the same NAME is the actual confusion to prevent.
- 2026-05-13 (W5a): **Bookmark URL validated as in-app relative path.** Local-first means a bookmark must point inside the app. Without validation, a POST of `{ name: "x", url: "https://evil.com/y" }` would create a sidebar link to an offsite URL — the app would render it as a normal anchor and the click would leave localhost. Validation rejects anything not starting with `/`, and also rejects protocol-relative `//evil.com` (which would be parsed as offsite by the browser). Added post-Advisor review.
- 2026-05-13 (W5a): **Other three W5 queries deferred to W5b.** User scope choice at OBSERVE: build only the at-company surface this session. `worked-with`, `by-year`, and `reach` are next-session work. Reach-rank algorithm pre-decided: confidence × 1-hop-count (manual edges at 1.0 always rank above derived; same-bucket derived ties broken by overlap_months desc).

- 2026-05-13 (W5b): **Reach-rank formula clarified: `max(confidence)`, not `count × confidence`.** The user-approved option label was "Confidence × 1‑hop‑count" but the option *description* spelled out the operational rule: "score = confidence(Y↔X). Manual edges fixed at 1.0, derived edges by their stored confidence. Tied on confidence → prefer manual over derived, prefer longer overlapMonths." The "1-hop-count" phrasing was an algorithm-class name (1-hop graph traversal: owner→Y→X is one hop from Y) not a multiplicative count of edges. Implementation matches the description: per intermediary Y, score = 1.0 if any manual edge (Y, X) exists, else max(derived.confidence) across all (Y, X) derived edges. Multiple corroborating derived edges to the same Y do NOT compound the score — taking max avoids double-counting noisy same-employer signals (e.g., Y who shows up in 3 PwC sub-orgs would otherwise outrank a single high-confidence intro). Refactor to a probabilistic-OR (`1 - ∏(1-c_i)`) is a future call when the data has enough independent edges per pair to justify it.
- 2026-05-13 (W5b): **`directConnection` is data-driven, not schema-invariant-driven.** For v1, every non-owner in `people` is in `connections` (Connections.csv populates both). That means `directConnection` is tautologically true for any valid target X. Implementation still queries the `connections` table explicitly so the day a person enters via a derived-only path (future scrape, manual seed, multi-tenant friend's data), the panel hides itself. Documented intent: "non-owner without direct edge → page shows reach-only state."
- 2026-05-13 (W5b): **by-year bucketing is safe by ingest invariant, not by runtime parsing.** `substr(connected_at, 1, 4)` assumes ISO `YYYY-MM-DD`. The LinkedIn parser `parseConnectionDate` enforces this format and returns null on any failed parse (`/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/`); null lands as NULL in DB and falls into the 'unknown' bucket via the `connected_at IS NULL` branch. No runtime guard added: the ingest pipeline is the single ingestion point for `connected_at`, and the parser is unit-tested. If future ingestion routes (manual edit, external API) emit non-ISO dates, that's an ingest bug to fix at the new ingestion point, not a downstream guard.

- 2026-05-13 (W6): **Graph v1 is intentionally a star — not a bug, a v1 data property.** `HIGH_CONFIDENCE_FLOOR = 0.7` for both node entry AND edge rendering. In the real dataset every 0.5-confidence edge is connection-to-connection within the same current employer (the `shared_employer_currently` bothCurrent override path) — there are zero connection-to-connection 0.7+ edges because no two connections both have *declared* positions at the same company (only owner has declared positions). So the 150-node rendered graph is owner + 149 strong-incident colleagues with 149 owner↔colleague edges (N−1, a star).  Densifying with the 0.5 edges between the same nodes would emit ~9k edges, push the HTML payload to 3.1MB, and stretch the cose layout past the 10s budget — verified by running the densified version. Future work: a "show within-cluster mid-confidence" toggle with an explicit edge cap (e.g., top-300 by confidence) and a "this may be slow" warning before activation.
- 2026-05-13 (W6): **Cytoscape goes through `next/dynamic` with ssr:false, not `"use client"` alone.** `cytoscape()` touches `document` synchronously at instantiation. A bare `"use client"` component still runs on the server during SSR/streaming, then hydrates — the server pass would error on the missing document. `next/dynamic(() => import(...), { ssr: false })` defers the import + render to the client entirely. The server emits the `<GraphSkeleton />` shell; the client hydrates and runs Cytoscape against real DOM.
- 2026-05-13 (W6): **Owner colour reserved via shape/size, not hue band.** Advisor flagged a possible collision between owner red (~hue 0°) and company hashes that land near 0°. Mitigation chosen: owner gets distinct *shape* (no border-radius circle vs. small circle) and *size* (26px vs 16px) plus a thick outline, not a hue-band reservation. Easier to read at low DPI; survives any colour-blind palette swap; and the owner node is also positioned at the gravitational centre by cose so it's already visually obvious.

- 2026-05-13 (W7): **`0.1.0-rc.1` not `0.1.0-pre` for the pre-release version.** Initially picked `0.1.0-pre` because it reads naturally, but Advisor flagged it as a semver smell: bare `-pre` with no numeric identifier is technically valid but unusual and trips some tooling. `0.1.0-rc.1` is the standard release-candidate convention, clearly orderable (`0.1.0-rc.1 < 0.1.0-rc.2 < 0.1.0`), and matches the actual state (this commit is RC1; bump to `0.1.0` when you tag for real).
- 2026-05-13 (W7): **Docker not built locally — `docker build` is the user's manual action.** WSL host has no Docker. Dockerfile syntactically matches the standard Bun + Next two-stage pattern, and the three failure modes Advisor highlighted (`HOSTNAME=0.0.0.0` for container reachability, non-root `USER bun`, `.dockerignore` excluding `data/`) are all addressed. `output: 'standalone'` deliberately *not* added — it's an image-size optimisation, not correctness; the current `next start` pattern works without it. Filed as post-v0.1.0.
- 2026-05-13 (W7): **v0.1.0 tag + GitHub release is the user's manual action.** No git remote configured in this repo. The flip-to-public, the actual `git tag v0.1.0`, the GitHub Releases entry, and the bump to `0.1.0` (drop the `-rc.1`) all happen by hand when the user is ready. Documented in W7 Decisions so future-Claude doesn't try to push on its own.
- 2026-05-13 (W7): **Screenshot capture is viewport-only, not full-page.** Initial full-page captures hit 2MB+ for the /companies/[id] and /queries pages (145-row lists scroll for ages). Viewport-only kept total screenshot footprint at ~770KB across 6 files — fine for git, fine for a README first-impression on GitHub repo cards. Trade-off: screenshots don't show the full list, but they show the feature, which is what they're for.

- 2026-05-19 v0.2.0: Started a post-v0.1.0 design-system overhaul ("Graph-Forward Dark"). Nine commits in one session migrate every route off the v0.1.x light palette onto an HSL-token-based dark vocabulary documented in `docs/tokens.md`. Three governing rules: **color carries data** (accent reserved for high-signal / "you"), **two densities only** (comfortable rhythm for graph + hero, dense rhythm for lists/tables), **motion is content-driven** (no scroll-jacking).
- 2026-05-19 v0.2.0: Shell change — top header retired in favour of a **global left rail** (`079cd41`). Frees the vertical axis for the graph and list routes; the rail also hosts the `⌘K` palette affordance.
- 2026-05-19 v0.2.0: `/graph` selection URL pattern uses `history.pushState` instead of `router.push`/`router.replace` (commit `30e3327`). Next 14 App Router silently dedups query-only changes on the same pathname in this app's setup, which would have made `?selected=` deep-links inert.
- 2026-05-19 v0.2.0: Cytoscape mount is `requestAnimationFrame`-deferred inside the useEffect to avoid the React 18 dev-StrictMode double-mount race that crashes cose's animation timer on `renderer is null`. Captured in `30e3327` commit body; don't refactor away.
- 2026-05-19 v0.2.0: Command palette added via `cmdk` (`5ad868a`). Three Command.Group sections: Navigate (10 routes), People (debounced 200ms `/api/people/search?q=`, fires once ≥2 chars), Saved queries (one `GET /api/bookmarks` on open). `Cmd-K` / `Ctrl-K` toggles, `Esc` closes. Stack additions for v0.2.0: `framer-motion`, `lucide-react`, `cmdk`.
- 2026-05-20 v0.2.0-B: Slice B scope locked at **edge-kind multi-select + confidence slider**. Year-range filter (originally mentioned alongside kind/confidence) is DEFERRED. Reason: `derived_edges.evidence_json` has no top-level `startYear` / `endYear` fields — dates are buried inside `aPositions[]` / `bPositions[]` per-position arrays, and on the real dataset most of those entries are `origin: 'synthesised'` with `startDate: null`. A meaningful year filter needs schema enrichment (materialised year range per edge) or a degraded "drop edges where both sides have null dates" toggle. Neither is justified by Slice B's user value; tracked as a follow-up.
- 2026-05-20 v0.2.0-B: refined: the `?selected=` pattern's `history.pushState` + `popstate` listener does NOT cleanly survive a sibling `router.refresh()` call. When the filter handler called `setKinds(...) + setMinConfidence(...) + router.refresh()` inside a popstate handler, the setState calls were silently dropped (verified via instrumented console.log — handler fired, but no re-render followed). Replaced with `useSearchParams()` + `useEffect([searchParams.get("kinds"), searchParams.get("minConfidence")])`. App Router's reactive hook updates on both pushState-after-router.refresh and native popstate, and the useEffect fires cleanly. graph-canvas.tsx keeps the original `?selected=` popstate pattern because it does NOT call router.refresh and doesn't hit the race. Follow-up: migrate `?selected=` to the same useSearchParams pattern for consistency.
- 2026-05-20 v0.2.0-B: refined: client/server boundary in `src/lib/queries/`. The new client component `graph-filters.tsx` originally imported `ALL_GRAPH_KINDS` (runtime value) from `@/lib/queries/graph.ts`, which transitively imports `@/lib/db` → `@libsql/client` → `node:fs`. Webpack rejected the client bundle with `UnhandledSchemeError: Reading from "node:fs" is not handled by plugins` — caught by browser-verify on the FIRST page load. Fix: extracted `GraphEdgeKind` + `ALL_GRAPH_KINDS` to a leaf module `src/lib/queries/graph-kinds.ts` with no DB imports. **Rule going forward:** any constant referenced by a `"use client"` file must live in a module that does not import the DB.
- 2026-05-20 v0.2.0-B: `scripts/verify-w6.ts` is broken — `data-testid="graph-meta"` was removed from the canvas in commit `30e3327` (v0.2.0-A slice 1) when GraphCanvas was rebuilt for the dark theme. The new stats grid uses `<dl>` rather than a labelled testid. **NOT a Slice B regression** — pre-existing fallout from yesterday's v0.2.0-A work that was never reflected in the verify scripts. Tracked as follow-up: refresh `verify-w6.ts` against the new GraphCanvas DOM (add `data-testid="graph-stats"` to the `<dl>` and update the verify to read from there).

- 2026-05-20 v0.2.0-C: Prod build measurements pre-implementation — `/graph` default TTFB 4.94s / 94 KB; `/graph?minConfidence=0.5` TTFB 5.29s / **3.66 MB** (39× payload). The TTFB is dominated by `assembleNetworkGraph` SQL (touches `derived_edges` UNION ALL across ~15k rows); the payload jump is the hairball Cytoscape then has to lay out. **Confirms dev-server overhead was real but the ~5s server compute + low-confidence payload bloom are real prod problems too.** Drives the choice to prioritise (a) the loading-indicator (makes the 5s tolerable) over (b) any premature SQL optimisation.
- 2026-05-20 v0.2.0-C: Min-degree filter is a **post-filter** on the assembled graph, not a SQL clause. Reason: it's defined against the *rendered visible-edge degree*, which only exists after the kinds + minConfidence + NODE_CAP pipeline has run. Doing it in SQL would require re-implementing the same selection logic in the WHERE clause. Owner is exempt — dropping the user's own node renders the graph meaningless.
- 2026-05-20 v0.2.0-C: `<NavProgress />` detects navigation start by document-level click-intercept on internal anchors (capture-phase) and clears on `usePathname`/`useSearchParams` change. **Why not `router.events`:** Next 14 App Router does not expose navigation start/end hooks for client components. **Why not `useLinkStatus`:** that's Next 15. The click-intercept fallback handles `<Link>`, `<a>`, palette-injected anchors, and any third-party component that renders a link. Capture phase ensures the bar fires even if a downstream handler stops propagation.
- 2026-05-20 v0.2.0-C: `<NavProgress />` mounted inside `<Suspense>` in `app/layout.tsx` because it calls `useSearchParams()`, which Next 14 requires to be Suspense-wrapped or the build fails with "useSearchParams() should be wrapped in a suspense boundary at page X". Fallback is `null` — the rest of the layout still SSRs cleanly.
- 2026-05-20 v0.2.0-C: Per-route `loading.tsx` added for `/graph`, `/people`, `/companies` — Next 14's built-in suspense streaming. Skipped `/upload`, `/profile`, and `/queries/*` for now: their server work is sub-100ms and the global nav-progress bar covers them. Easy to add later if profiling surfaces a slow one.

- 2026-05-20 v0.2.0-release: `EDGE_CAP = 500`. Reason: at `minConfidence=0` on the real dataset, the derived-edges fetch produces ~10,317 edges between the 150 retained nodes — 3.66 MB SSR payload, layout strain. Capping at 500-by-confidence drops payload to 219 KB (**16× reduction**) while keeping "the strongest 500 inferred relationships" visible. Trade-off: at very low confidence, the user sees only a sample of the dense employer clusters. The "M / N" badge in the stats grid surfaces this transparently rather than silently hiding edges.
- 2026-05-20 v0.2.0-release: refined: composition order matters — cap → min-degree, not min-degree → cap. The first version of the cap had `finalEdges = edges.filter(...)` in the min-degree branch, which used the PRE-cap `edges` array and silently re-introduced dropped edges. Caught by composing `?minConfidence=0.5&minDegree=3` (showed 10,297 edges instead of ≤500). Fixed: `finalEdges = cappedEdges.filter(...)`. The cap is the floor; min-degree narrows further from there.
- 2026-05-20 v0.2.0-release: `verify-w6.ts` now reads stats via `data-stat="<key>"` cells (one per `<dd>`) rather than regex-against-label. Survives label rewrites: "edges" cell can render as `M` or `M / N` and the parser handles both via `^\s*(\d+)/`. Same pattern can extend to /people and /companies verify scripts if their layouts change.
- 2026-05-20 v0.2.0-release: tag `v0.2.0` created locally on the commit carrying ISC-221..225. Annotated tag message captures the seven days of work since `v0.1.0` (5/14): design-system migration (v0.2.0-A), interactive filters (v0.2.0-B), nav-progress + min-degree (v0.2.0-C), edge cap + verify refresh (v0.2.0-release). Push + GitHub release remain user actions per the established W7/W8a convention.

- 2026-05-20 v0.3.0-A: messages.csv schema reuse — the `messages` table already exists in `src/lib/db/schema.ts` from migration `0000_remarkable_cardiac.sql`, dormant since W2 planning. No new migration in v0.3.0-A; the table is wired up via parser + ingest only. Schema is intentionally minimal (`id, tenantId, fromPersonId, toPersonId, sentAt, direction`) — no CONTENT/SUBJECT body stored. Bodies never leave the parser; only `sha1(content)[:8]` propagates as the deterministic-ID tiebreaker.
- 2026-05-20 v0.3.0-A: owner profile URL recovery. Profile.csv has no URL column, so the owner's `linkedin_url` was previously `null` (writeOwner line 121). In v0.3.0-A the parser scans messages.csv for the first row where `FROM == profile.fullName` and captures `SENDER PROFILE URL` as the owner's URL. `backfillOwnerLinkedinUrl` updates the owner row post-`writeOwner` so subsequent message resolution uses a single URL→id path for both owner and 1st-degree. Empirically: detected URL `https://www.linkedin.com/in/matt-pwc-bi` on Matt's export. **Known limitation:** if any 1st-degree contact shares the owner's full name, detection picks the first match — fine for single-user dev build, must revisit at W8 multi-tenant fork.
- 2026-05-20 v0.3.0-A: 1st-degree-only invariant is doctrine, not a bug. Real Complete-export smoke drops 654 / 2228 expanded (29.4%) at the people-FK gate — InMail from non-connections, deleted accounts, group chats with strangers. This is **selection bias**, not noise: dropped cohort is systematically higher-signal for new-opportunity use cases (recruiting, sourcing, intros). For v0.3.0-A's purpose (edge-weight signal for the *existing* network), the kept 71% is exactly the right cohort. Advisor 2026-05-20 flagged this as a posture-not-bug; documented here so v0.3.0-B/W8 can revisit with a `messages_unresolved` sidecar table if downstream use cases need the dropped cohort.
- 2026-05-20 v0.3.0-A: refined (Advisor catch): deterministic message ID composition initially was `sha1(tenantId|msg|conversationId|sentAtEpoch|fromPersonId|toPersonId)`. Advisor flagged same-second collision risk — LinkedIn's DATE column is whole-second resolution, rapid-fire bursts can share an epoch. Refinement: added `contentHash = sha1(CONTENT)[:8]` as a tiebreaker in the ID input tuple. The CONTENT body itself never leaves the parser — only its hash propagates. Empirical confirmation: re-running the smoke after the fix lifted `inserted` from 1570 → **1573 (+3)** — three actual messages in Matt's own export had been collapsing before the refinement.
- 2026-05-20 v0.3.0-A: writeMessages batched insert chunk size = 200 rows. SQLite via libsql tolerates this comfortably under any practical parameter-count limit and minimises round-trips vs the per-row `await db.insert(...).values(one)` pattern that ingest still uses for connections/people/positions (those tables ingest at ~1800 rows max; messages at potentially 10k+ post-expansion needs the batch path).

- 2026-05-20 v0.3.0-B: **Scope locked at messages-on-/people/[id] + messages-on-/people, both with thread timeline and sort=last_contact toggle.** User picked both "thin thread timeline" and "sort toggle" options at PLAN. Warm-path-finder (message-weighted reach) is the natural v0.3.0-C follow-on but explicitly deferred — Ideate's top-2 ranked in that exact order, and v0.3.0-B's surfaces are warm-path's prerequisites.
- 2026-05-20 v0.3.0-B: **Messages are a third epistemic category, distinct from manual_edges and derived_edges.** Manual = asserted (confidence 1.0). Derived = inferred from shared employer (confidence < 1.0). Messages = observed communication events (frequency + recency, not a confidence-shaped quantity). Three separate query modules, three separate UI sections, three separate epistemics. Anti-mixing enforced via ISC-253 + ISC-265 grep gates — same pattern as ISC-47 / ISC-94 that govern manual-vs-derived isolation.
- 2026-05-20 v0.3.0-B: **No new SQL migration.** The `messages` table was already populated by v0.3.0-A (1573 rows on Matt's real export). v0.3.0-B is pure read-side: new query module + UI surfaces. No schema delta; if a future warm-path slice needs materialised per-pair aggregates, that's its own migration.
- 2026-05-20 v0.3.0-B: **Owner-perspective `sent`/`received` definition.** Sent = `fromPersonId == owner`, received = `toPersonId == owner`. This means the per-person stats are asymmetric reflections of the owner's own messaging behaviour: "I sent X 12 messages, X sent me back 8". The other-person-only count would erase agency information. Documented at the query module entry-point so future contributors don't "normalise" the directions away.
- 2026-05-20 v0.3.0-B: **show-my-math on delegation floor (E3 soft ≥2, selected 0 sub-agents).** Forge/Anvil/Cato unavailable on this WSL host (codex CLI not installed, per the `state_cato_codex_not_installed.md` memory). Browser-verify via Playwright is inline-tool, not a subagent. Advisor will fire at the commitment-boundary before `phase: complete` — that's the cross-vendor check available within this environment. Doctrine permits the soft override with this justification.

- 2026-05-20 v0.3.0-B refined (Advisor catch): **listPeople was JOINing the messages table directly — false-green on ISC-265.** First cut shipped a raw-SQL LEFT JOIN on `messages` inside `src/lib/queries/people.ts` so the sort=last_contact ORDER BY could see the per-person MAX(sent_at). ISC-265 (JS-import grep) returned 0 hits and read green, but the schema layer was leaking: another module reaching into the messages table contradicts the "third epistemic category" claim at exactly the layer that matters for evolvability. Refactor: (a) new `listAllLastContactDesc(tenantId)` on the messages module — owns the tenant-wide ordered list of contacted people; (b) `listPeople` composes that ordered list with the people set in JS for sort=last_contact (3 queries total, no per-row work); sort=name keeps the existing select + `listLastContactByPeople` batch (3 queries). (c) New ISC-266 — extended grep that fails on `(FROM|JOIN|INTO|UPDATE)\s+messages\b` outside `src/lib/queries/messages.ts`, `src/lib/linkedin/ingest.ts`, and the db/scripts/tests whitelist. 0 hits at commit. **Pattern: a JS-import-only isolation grep is necessary but not sufficient. For any "epistemic category" boundary, add a SQL-reference grep alongside; cheap to write, catches the leak that copy-paste-from-another-module is most likely to introduce.**

- 2026-05-20 v0.3.0-B refined (Advisor catch): **Empty-message stats row renders zeros, not absence.** First cut hid the stats row when `total === 0` and rendered only "No messages exchanged with this person." Advisor flagged that this conflates "we checked, there were none" with "we don't track messages on this view" — the third-epistemic-category architecture exists precisely to make that distinction legible. Fix: stats row (`data-testid="messages-stats"`) always renders; sent/received show "0", last-contact shows "—"; the thread list is the conditional element. Captured as ISC-267. **Pattern: in a multi-category UI, the category's presence at the surface is itself signal. Don't hide categories on empty data — show the zero and let the user read it.**

- 2026-05-21 v0.3.0-C: **Scope locked: extend `/queries/reach/[id]` with warmth signal + sort toggle (Epistemic ↔ Warmth).** Option B of three considered. Option A (warmth columns, no sort) rejected as too shallow — users will immediately want to re-rank by warmth; shipping the column without the toggle is the column work without the value. Option C (new `/queries/warm-path/[id]` multi-hop traversal) rejected as scope creep — Ideate's label was "message-weighted **reach**", an extension of the existing reach surface, not a new traversal algorithm. Option B matches v0.3.0-B's pattern (one query module helper + one route surface change).
- 2026-05-21 v0.3.0-C: **Warmth and epistemic confidence are NOT mixed into a single score.** ISC-278 enforces this. Rationale: warmth is observed-event-derived (frequency + recency), epistemic is asserted/inferred-evidence-derived (manual vs derived). These are different epistemic categories per v0.3.0-A doctrine. A blended score would erase the user's ability to distinguish "I have a strong relationship with Y who weakly-overlaps with X" (warm-but-weak-epistemic) from "I barely know Y who definitely worked with X" (cold-but-strong-epistemic). Both are useful, neither is "stronger" without context.
- 2026-05-21 v0.3.0-C: **No new SQL migration.** The `messages` table is fully populated by v0.3.0-A (1573 rows on real export). v0.3.0-C is pure read-side: one new batch helper in messages.ts + composition in reach.ts + UI surface update. ISC-299 enforces.
- 2026-05-21 v0.3.0-C: **Composition isolation enforced at TWO layers, per v0.3.0-B Advisor lesson.** ISC-288 (JS-import grep, unchanged from ISC-265 — still forbids manualEdges + derivedEdges from importing messages; reach.ts is the composition layer and IS permitted to import). ISC-289 (SQL-reference grep, unchanged from ISC-266 — reach.ts must NOT reach into the messages table directly, all reads go via getMessageCountsByPeople / listLastContactByPeople). This applies the promoted-isolation-pattern lesson from `feedback_isolation_grep_layered.md` to a new composition surface without re-deriving it.
- 2026-05-21 v0.3.0-C: **Sort toggle uses Next 14 `<Link>` server-rendered navigation, not `history.pushState`.** The reach page is already a server component that re-fetches on every navigation; switching sort modes is a fetch-new-data action, not a client-only state change. Uses the same pattern as the v0.3.0-B `/people?sort=last_contact` toggle. ISC-283 enforces. (The `history.pushState` pattern from v0.2.0 graph filters is correct *only* for client-side filter state that doesn't trigger a server roundtrip.)
- 2026-05-21 v0.3.0-C: **show-my-math on delegation floor (E3 soft ≥2, selected 0 sub-agents).** Same situation as v0.3.0-B: Forge/Anvil/Cato unavailable on this WSL host (codex CLI not installed — see `state_cato_codex_not_installed.md`). Browser-verify via Playwright is inline-tool, not a subagent. Advisor fired at the commitment-boundary before `phase: complete` and produced four substantive items (logged below).
- 2026-05-21 v0.3.0-C refined (Advisor catch, commitment-boundary): **Drizzle-style ORM access to the messages table was a blind spot in the ISC-289 regex grep.** ISC-289 matches raw SQL keywords (`FROM|JOIN|INTO|UPDATE messages`), but a Drizzle call like `db.select().from(schema.messages)` doesn't match `FROM messages` syntactically. Advisor explicitly flagged this. Patched: ran the broader probe `rg -n 'schema\.messages|from\(messages\)|insertMessages' src/` against all of src/ outside the messages.ts + ingest.ts whitelist — **0 hits**. Only `src/lib/linkedin/ingest.ts` (whitelisted) references `schema.messages`. Captured here so the next epistemic-category boundary author knows to run BOTH the SQL-keyword grep AND the ORM-symbol grep when promoting the isolation pattern.
- 2026-05-21 v0.3.0-C refined (Advisor catch, commitment-boundary): **Warmth sort tiebreakers form a total deterministic order.** Advisor flagged that the long zero-tail across 142 candidates (real-data probe: top-3 totals [23, 1, 0…]) could otherwise return non-deterministic ordering across reloads, silently breaking bookmark UX. Tiebreak chain documented at the sort closure: `messages.total DESC → messages.lastAt DESC (NULLS-LAST via -Infinity sentinel) → score DESC → intermediaryName ASC`. The name tiebreak terminates the chain — full determinism. ISC-277 test confirms zero-tail position; bookmark round-trip (ISC-297) verifies ?sort=warmth URL is stable.
- 2026-05-21 v0.3.0-C refined (Advisor catch, commitment-boundary): **`total` is the warmth scalar, not `min(sent, received)` or any mutuality measure.** Advisor surfaced the ambiguity: is "warmth 23" 23-sent-by-me (spam) or 23-received (they want me) or a balanced 12/11 (mutuality)? Decision: total is the right scalar at the reach-rank surface because the user's question is "how much have we communicated" — high counts in either direction signal a relationship live enough to ask. The `sent` and `received` cells remain available on `/people/[id]` for users who want to inspect the directionality. Mutuality as a separate ranking primitive is a future ISC (warm-path-finder v2), not v0.3.0-C scope.
- 2026-05-21 v0.3.0-C refined (Advisor catch, commitment-boundary): **Single-target real-data smoke is anecdotal, not adversarial.** Advisor flagged that the verify probe runs against one target (Javier García López, 142 candidates) — happy path. Adversarial fixtures deferred to follow-up: (a) target with all-zero warmth across all candidates (does the toggle still render + flip without crashing?); (b) target with one candidate having very high warmth + zero epistemic, vs one candidate having zero warmth + max epistemic (does ranking visibly diverge in both directions?). Acknowledged scope gap; not a blocker for v0.3.0-C because the type system + ISC-273 ALWAYS-present invariant prevents the zero-everywhere crash class.
- 2026-05-21 v0.3.0-C noted (Advisor false-positive, workflow): **Advisor's `--auto-state` loaded the wrong ISA slug (`20260515_isocorp-ma-pwc-spain-deals`).** Advisor flagged this loudly as workflow-fatal. It's actually a known v6.2.x deferral in the PAI Algorithm: `Inference.ts --auto-state` reads `~/.claude/PAI/MEMORY/WORK/` and does NOT yet auto-discover `<project>/ISA.md` project-ISA homes. The actual project ISA at `/mnt/c/Users/mca/Projects/Strand/ISA.md` is correctly scoped to v0.3.0-C (33/33 ISCs, all the v0.3.0-C Decisions above). Advisor's substantive critique (the four items above) was still high-quality and actionable; only the workflow-state preamble was misled by the stale auto-state. Logged here so future runs don't re-litigate.

- 2026-05-21 v0.3.2: **Scope locked at v0.3.2-A (hardening) + v0.3.2-B (Mutuality) + v0.3.2-release (verify + tag).** Default of three scope options offered at the v0.3.2 PLAN; user picked "continue with a b and c" — interpreted as the v0.3.2 sub-slices (A/B/release), not the surface-level alternatives (`/graph` perf, W8 multi-tenant, release-hygiene-only). The default closes all four Advisor follow-ups from v0.3.0-C in one tag and completes the warm-path arc before the next surface pivot.
- 2026-05-21 v0.3.2: **Mutuality scalar = `min(sent, received)`, not the normalised ratio `2*min/(sent+received)`.** Integer scale matches the existing `total`/`sent`/`received` fields — easy to display ("↔ 12") without float-rounding ambiguity in the UI, and trivially comparable in the sort closure. The normalised ratio is a better mathematical measure of "how balanced is this relationship" but `min` is a better measure of "how much two-way investment has there been" — and the latter is the question the warm-path-finder is asking. Logged at the sort-closure entry.
- 2026-05-21 v0.3.2: **Three independent ranking signals on every candidate** (`score` for epistemic, `messages.total` for warmth, `messages.mutuality` for two-way investment). The sort mode is the user's question; the signals never blend. ISC-313 enforces. Three-button toggle on `/queries/reach/[id]` (Epistemic ↔ Warmth ↔ Mutuality) is the natural surface for "pick the question, see the answer".
- 2026-05-21 v0.3.2: **ORM-symbol probe promoted from manual-verification (v0.3.0-C Changelog) to a numbered ISC (ISC-301).** v0.3.0-C ran the broader rg as an Advisor-driven manual check; v0.3.2 formalises it as a peer of ISC-265 (JS-import) and ISC-289 (SQL-keyword). Three-layer enforcement is now the doctrinal pattern for any future epistemic-category boundary on a Drizzle codebase.
- 2026-05-21 v0.3.2: **show-my-math on delegation floor (E3 soft ≥2, selected 0 sub-agents).** Same situation as v0.3.0-C / v0.3.0-B: Forge/Anvil/Cato unavailable on this WSL host (codex CLI not installed — see `state_cato_codex_not_installed.md`). Advisor fired at the commitment-boundary before `phase: complete` and produced two substantive items + ten v0.3.3 follow-up conjectures (logged below).

- 2026-05-21 v0.3.2 refined (Advisor catch, commitment-boundary): **Mutuality tie-storms at low integers are the top regression surface — secondary sort keys MUST be deterministic and explicit.** With `min(sent, received)` as the scalar and an integer scale, the dataset will have dozens-to-hundreds of candidates tied at `mutuality=1`, `=2`, etc. The tiebreak chain documented at the sort closure (`mutuality DESC → lastAt DESC NULLS-LAST → score DESC → name ASC`) terminates at name and is fully deterministic — but Advisor's point stands that this is exactly where future "the bookmark moved on me" reports would surface. Captured both at the sort closure (code comment) and here (the chain is the spec). ISC-311 verifies the chain operationally; the bookmark round-trip at ISC-297 + v0.3.2 mutuality bookmark cycle (29/29 verify) closes the empirical loop.
- 2026-05-21 v0.3.2 refined (Advisor catch, commitment-boundary): **Display rule for `—` vs `↔ 0`: there is no `↔ 0` rendered for v0.3.2.** Advisor surfaced an ambiguity: does `—` mean "null/unknown" while `↔ 0` means "known-zero on at least one side"? Decision: every candidate has known message counts (zero or positive) — we don't have an "unknown" state for messages in v0.3.2. So the warmth pill renders `"—"` for `total === 0` (no observed activity), and the mutuality pill renders `"—"` for `mutuality === 0` (no two-way activity). Same visual rule. `↔ 0` is never rendered. If a future "we couldn't compute it" state is introduced (e.g., during ingest), a distinct token (`"?"`) would be needed to distinguish it from known-zero.
- 2026-05-21 v0.3.2 noted (Advisor false-positive, workflow, same as v0.3.0-C): **Advisor's `--auto-state` loaded the wrong ISA slug again.** Known v6.2.x deferral: `Inference.ts --auto-state` reads `~/.claude/PAI/MEMORY/WORK/` and does NOT yet auto-discover `<project>/ISA.md` project-ISA homes. The actual project ISA at `/mnt/c/Users/mca/Projects/Strand/ISA.md` is correctly scoped to v0.3.2 (30/30 ISCs, all the v0.3.2 Decisions above). Substantive critique was still high-quality; only the workflow-state preamble was misled. Logged here so the next slice doesn't re-litigate.
- 2026-05-21 v0.3.2 deferred-to-v0.3.3 (Advisor conjectures, surfaced not patched): (1) **Mass-channel exclusion** — distribution lists / calendar invites / auto-replies inflate `received` and skew mutuality for those senders; needs a 1-to-many detector before mutuality is fair on those rows. (2) **Time-decay parity** — all-time mutuality overweights stale loops; epistemic and warmth also lack decay but mutuality's "did we go two-way?" semantic is most distorted by a relationship that died 5 years ago. (3) **Alias / namespace imports in ISC-301** — `import * as orm` or `import { messages as M }` bypass static text grep; static-AST probe is the durable fix. (4) **Tagged-template SQL precedence** — `db.all(sql\`SELECT ... FROM messages\`)` trips ISC-289 (SQL-keyword) but does it ALSO trip ISC-301 (ORM-symbol)? Document the precedence. (5) **Adversarial-fixture meta-assertion** — the canonical target (Javier García López) should provably NOT match the all-zero-warmth or divergent skip path, so a broken fixture detector doesn't silently pass. (6) **Bookmark cold-deep-link × toggle × back-button matrix** — verify-v030c.ts covers deep-link + toggle, doesn't cover back-button. (7) **Default-elision asymmetry** — `?sort=epistemic` is elided to no-param; round-trip is asymmetric across the three modes. (8) **Pre-commit / CI gate enforcement** — three isolation probes currently run only at the model's verify step, not in CI. (9) **Dynamic imports / `require()`** bypass static probes — explicit non-goal line in the ISC. (10) **Type-only imports** in ISC-301 — `import type { InferSelectModel }` is compile-time-only and should arguably be allowed even in restricted modules; pick a posture and document. All ten are durable follow-ups; none block v0.3.2.

## Changelog

- 2026-05-19 (v0.2.0) — **The v0.1.x light palette was data-blind; "post-release polish" turned into a full design-system rebuild**
  - **Conjectured:** v0.1.0 closed the project's design phase. Post-release work would be hosted-instance prep (Plan W8 — Postgres swap + NextAuth fork) or quiet maintenance until the next data feature.
  - **Refuted by:** A single session on 2026-05-19 producing 9 commits — none of them W8 — that adopted a new HSL-token vocabulary, retired the v0.1.x palette, replaced the top header with a global left rail, migrated every route, and shipped a `Cmd-K` command palette. The "ship and rest" framing missed that the v0.1.x palette could not carry signal: accent colour was decorative, edge kinds had no visual hierarchy, the graph and the lists looked stylistically unrelated. None of that is a polish issue; it is a thesis issue.
  - **Learned:** A graph app's UI **is** the graph. Tokens that don't encode that thesis force the renderer to do extra work — the user reads the canvas first, then has to translate every other surface to match. The fix is design-system-level (governing rules, not component tweaks). Adding **"Graph-as-UI"** as a project Principle next to "Local-first" and "Multi-tenant from day one" — same load-bearing tier.
  - **Criterion now:** v0.2.0-A is retroactively covered by the `graph-forward-dark` Feature row + the 2026-05-19 v0.2.0 Decisions entries. v0.2.0-B opens new ISCs (203–215) for interactive `/graph` filters — the first new surface that fully expresses the Graph-as-UI thesis (filter the graph in place; the canvas updates; the chrome stays out of the way).

- 2026-05-13 (W6) — **Densifying a force-directed graph "for visual interest" cost 30× the HTML payload**
  - **Conjectured:** Lowering the edge-render floor from 0.7 to 0.5 would add visual cluster structure without materially affecting load time or payload, because the within-cluster 0.5 edges live among already-rendered nodes (no node expansion needed).
  - **Refuted by:** Empirical run after the change: HTML payload went 84.9KB → 3.176MB (37× increase), cose layout time crossed the 10s budget (9.5s → 11.4s), and the visual result was a hairball rather than legible clusters. The same-employer-currently overlay added 9,016 edges on top of the original 149 — every PwC España pair, every OBS pair, etc.
  - **Learned:** "Add some structure" requires bounding the addition, not just lowering the floor. A confidence floor + node cap is enough for the node count; for edges you also need an edge cap or a per-cluster cap. The right v1 answer for this data is to accept the star and document why — every 0.5 edge in the dataset is a same-employer-now-no-dates pair, and rendering all of them is honest but unreadable.
  - **Criterion now:** ISC-148 keeps both floors at 0.7 with the rationale embedded in the EDGE_FLOOR constant comment. A future ISC for "densify with an explicit edge cap" tracks the follow-up work without making the v1 commit ship the hairball.

- 2026-05-13 (W5b) — **Option labels vs option descriptions drift**
  - **Conjectured:** When an AskUserQuestion option is labelled `"Confidence × 1‑hop‑count"`, the multiplicative form is the contract, regardless of the option's prose description.
  - **Refuted by:** Advisor closing call on W5b. The option label was a class-name (1-hop graph traversal) but the option description spelled out the actual operational rule (`score = confidence(Y↔X)`, manual=1.0). My implementation matched the description but the label suggested a different formula — a real ambiguity that would have bitten future readers.
  - **Learned:** When a user picks an option, the description is the contract. Label is sales copy. Future ISC writing: if the label is class-name-shaped ("Strategy A", "Buckets", "Heuristic"), restate the operational rule in the option description AND copy it verbatim into the ISC text. Don't let the slogan-sized label do load-bearing work.
  - **Criterion now:** ISC-135 spells out the formula explicitly (`manual ? 1.0 : max(derived.confidence)`); W5b Decisions entry captures the label/description drift so future-Claude doesn't re-derive the wrong formula.

- 2026-05-20 (v0.3.0-A) — **Deterministic IDs over user-event data need a content tiebreaker, full stop**
  - **Conjectured:** A deterministic message `id = sha1(tenantId|msg|conversationId|sentAtEpoch|fromPersonId|toPersonId)` is collision-free: `conversationId` is opaque-unique per thread, and within a thread two messages cannot share a second.
  - **Refuted by:** Advisor (Rule 2 commitment-boundary call, 2026-05-20) flagged same-second-same-pair collision risk. Empirical run after adding `contentHash = sha1(CONTENT)[:8]` to the ID tuple: real-data `inserted` count went **1570 → 1573 (+3)** on Matt's own export. The "cannot share a second" assumption was wrong — LinkedIn's DATE column is whole-second resolution, and rapid-fire bursts ("hey" / "hi" / "lol" within the same second of the same conversation) are common enough to surface three collisions in a 1.5k-message archive.
  - **Learned:** For any deterministic ID over user-event data — messages, clicks, comments, transactions — the tuple MUST include a payload-content element, not just `(participants, timestamp)`. Whole-second timestamp resolution + chatty users guarantees collisions at scale. The mitigation is cheap (`sha1(payload)[:8]` adds 4 bytes of entropy) and pays for itself the first time it ships. **Pattern: any "deterministic identity" formula that doesn't reference the payload is a silent data-loss vector.**
  - **Criterion now:** ISC-235.1 enforces `contentHash` in the message ID tuple. The CONTENT body never persists — only `sha1(content)[:8]` propagates from parser to ingest. Future deterministic-ID work on Strand (Calendar events, Gmail threads when those land) inherits the same rule via this Changelog entry.

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

- 2026-05-20 (v0.3.0-B) — **JS-import-grep isolation is a fence, not a wall — the schema-access layer is where epistemic-category boundaries actually have to hold**
  - **Conjectured:** ISC-265 (`grep -rn 'from "@/lib/queries/messages"' src/lib/queries/{manualEdges,derivedEdges}.ts` returns 0 hits) is a sufficient enforcement that messages stay separate from manual_edges / derived_edges — the same shape that successfully governs the manual-vs-derived boundary in W3/W4. Therefore the listPeople sort=last_contact branch can JOIN the messages table inline as long as no JS module imports the messages query module, because the boundary is about epistemic category and the JS-import grep is its mechanical proxy.
  - **Refuted by:** Advisor commitment-boundary call after BUILD. The JS-import grep IS catching the import surface, but it is NOT catching `JOIN messages`, `FROM messages`, `INTO messages`, or `UPDATE messages` inside SQL strings in modules outside the messages module. listPeople's raw-SQL LEFT JOIN on the messages table read green under ISC-265 while substantively contradicting the third-epistemic-category claim at the layer that matters most for evolvability — the schema-access layer is exactly where copy-paste from another module is most likely to introduce the same leak again ("oh, you can just JOIN messages from anywhere").
  - **Learned:** A JS-import-isolation grep is necessary but not sufficient for any "epistemic category" boundary. For each such boundary, add a parallel SQL-reference grep with the same whitelist shape. The cost is one ISC and one rg invocation; the payoff is catching the precise failure mode that a successful pattern naturalises — once "manual vs derived" works as a JS-import boundary in W3/W4, the temptation to handle a new category the same way is overwhelming, and the next slice will silently reach into the new table from somewhere it shouldn't. **Pattern: when promoting a successful isolation pattern to a new boundary, also promote the enforcement primitive to cover the layers the original primitive didn't.** Owner perspective applies to all future epistemic categories (messages now; whatever comes after warm-path next).
  - **Criterion now:** ISC-266 added — `rg -nE '(FROM|JOIN|INTO|UPDATE)\s+messages\b' src/ --glob '!src/lib/queries/messages.ts' --glob '!src/lib/linkedin/ingest.ts' --glob '!src/lib/db/**' --glob '!scripts/**' --glob '!**/*.test.ts'` returns 0 hits. listPeople refactored to compose `listAllLastContactDesc` + people set in JS for sort=last_contact; `listLastContactByPeople` + people set for sort=name. Same isolation pattern should be promoted alongside any new epistemic category (the v0.3.0-C warm-path slice will need to follow this — its query module owns the SQL, listPeople / reach / etc compose at the module boundary).

- 2026-05-21 (v0.3.0-C) — **The SQL-keyword grep is a fence, not a wall — Drizzle-style ORM access slips through the same way raw-SQL JOIN slipped past ISC-265**
  - **Conjectured:** ISC-266 (`rg -nE '(FROM|JOIN|INTO|UPDATE)\s+messages\b'` returns 0 hits) is the durable enforcement of the third-epistemic-category boundary. Promoting it to the v0.3.0-C composition surface (reach.ts must compose via messages.ts, never reach into the messages table directly) inherits the same protection.
  - **Refuted by:** Advisor commitment-boundary call after BUILD. The SQL-keyword regex matches raw SQL strings — `db.all\`SELECT ... FROM messages ...\`` would be caught. But Drizzle ORM access like `db.select().from(schema.messages)` or `db.$count(schema.messages, ...)` doesn't trigger `FROM messages` syntactically — the table reference happens via a TypeScript symbol, not a SQL identifier. A future v0.3.0-D author copying the reach.ts composition pattern could introduce a Drizzle leak that ISC-266 silently misses. ISC-265/266 together would still read green.
  - **Learned:** Layered enforcement requires layered probes. The SQL-keyword grep is necessary but not sufficient at the ORM layer. **Pattern: when the codebase uses an ORM, every isolation-pattern primitive needs a paired ORM-symbol probe alongside the SQL-keyword probe.** This is the same shape of lesson as ISC-265→ISC-266 (JS-import → SQL-keyword): each layer of indirection needs its own enforcement gate. Three-layer enforcement now: (1) ISC-265 JS-import grep, (2) ISC-266 SQL-keyword grep, (3) implicit ORM-symbol probe (verified manually in v0.3.0-C; deserves promotion to a formal ISC in v0.3.0-D).
  - **Criterion now:** No new permanent ISC yet — the v0.3.0-C manual probe `rg -n 'schema\.messages|from\(messages\)|insertMessages' src/ --glob '!<messages.ts/ingest.ts/db/scripts/tests>'` returns 0 hits. Promote to a numbered ISC alongside the next epistemic-category boundary that crosses an ORM. Filed as follow-up.

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
- ISC-96..97 (W5): `bun run db:migrate` applies `0004_saved_queries.sql`; PRAGMA table_info shows the 5 columns; PRAGMA index_list shows `saved_queries_name_unique` (UNIQUE) + `saved_queries_tenant_idx`; second migrate run no-op.
- ISC-98..108 (W5): `bun run scripts/verify-w5.ts` — picker shows 20 companies at no-company state; `?q=pwc` filters; nonexistent company → 404; PwC España selected → heading correct, 145 rows; `status=current` shows 145 with `Current` badge; `status=past` empty; `sort=connected` and `sort=name` both render with the active filter chip marked.
- ISC-109..112 (W5): live curl against `bun dev` — POST `/api/bookmarks` returns 201 with id; duplicate name → 409; whitespace name → 400; DELETE existing → 204; DELETE again → 404; offsite URL `https://evil.com/x` and protocol-relative `//evil.com/x` both → 400 (anti: local-first).
- ISC-113..114 (W5): Playwright probe — `[data-testid="save-bookmark"]` present on selected-company page; after POST, `[data-testid="saved-query-row"]` reflects the new bookmark.
- ISC-115 (W5): SQL injection probe on `?q=' OR 1=1 --` returns 200; offsite + protocol-relative URL POSTs both 400 per local-first anti-criterion.
- W5 verify suite: `bun run scripts/verify-w5.ts` → 29/29 pass. Regressions: `verify-w3.ts` 23/23, `verify-w4.ts` 12/12 still green. Unit tests: 18/18.
- ISC-116..123 (W5b worked-with): Playwright probes — picker + sidebar visible at `/queries/worked-with`; `/queries/worked-with/<karla>` renders heading "Karla Vasquez", manual + derived sections both present, derived list = 17 rows, SaveBookmark visible; nonexistent id → 404.
- ISC-124..130 (W5b by-year): histogram renders 20 buckets summing to 1796 non-owner connections (matches `connections` count); `?year=2021` renders 217 people; `?year=unknown` renders "Unknown year" heading; `?year=2099` renders empty state; SQL inj `?year=' OR 1=1 --` → 200, parameter-bound; sidebar always visible.
- ISC-131..141 (W5b reach): picker visible; reach-to-owner renders 'this is you' panel with no candidates; reach-to-PwC-connection renders direct-connection panel + 16 ranked intermediaries; target X never appears in its own reach list (selfPair=0 across the rendered list); nonexistent id → 404; SaveBookmark visible.
- ISC-142..144 (W5b shared): all three pages render the saved-queries sidebar; 0 non-localhost requests across the Playwright pass; 0 page errors.
- ISC-145 (W5b bookmark round-trip): POST /api/bookmarks → DELETE round-trip succeeded on all 3 new URL shapes (`worked-with/[id]`, `by-year?year=YYYY`, `reach/[id]`) — bookmark plumbing handles them unmodified.
- W5b verify suite: `bun run scripts/verify-w5b.ts` → 33/33 pass. Full regression: `verify-w3.ts` 23/23, `verify-w4.ts` 12/12, `verify-w5.ts` 29/29, `bun test` 18/18 all still green.
- Cato (E4 cross-vendor audit, W5b): `skipped` — codex CLI still not installed on WSL host (same gap as W4/W5a). Advisor invoked and produced a substantive critique (scoring-formula label drift; data-driven vs invariant-driven directConnection; substr fragility) — all three are documented in W5b Decisions; nothing required code changes.
- ISC-146..150 (W6): `assembleNetworkGraph` returns `{ nodes, edges, meta }` for tenant=local — on real data: 150 nodes (owner + top-149 by edge strength, cap honoured), 149 edges (manual + derived ≥0.7 between retained nodes). Each node carries `id`, `displayName`, `company` (current employer string), `isOwner`, `degree`. Each edge carries `id`, `source`, `target`, `kind` (manual | derived_overlap | derived_currently | derived_no_overlap), `confidence`, optional `companyName`, `overlapMonths`, `note`.
- ISC-151..156 (W6): `/graph` → 200 with the NetworkGraph client-mounted Cytoscape canvas inside `[data-testid="graph-container"]`; cose layout converges in ~9.5s for 150 nodes; owner rendered red (`#dc2626`) and larger (26px vs 16px); manual edges solid orange (`#d97706`), derived_overlap dashed deep blue, derived_currently dashed lighter blue, derived_no_overlap dotted gray; non-owner nodes coloured by `djb2(company) % 360` hue for stable per-company cluster colour; ≥100 nodes verified at 150.
- ISC-157..159 (W6 anti): 0 non-localhost requests during graph load (Cytoscape bundled from `node_modules/cytoscape`); 0 page errors and 0 console errors during Playwright probe; initial HTML payload 84.9KB (well under 200KB cap).
- ISC-160..162 (W6 ui): `data-testid="graph-container"` element renders 3 inner Cytoscape canvases (layers, edges, nodes); meta panel exposes "150 nodes · 149 edges (capped at 150; confidence ≥ 0.7; N candidates seen)" via `data-testid="graph-meta"`; empty-tenant case renders the `data-testid="graph-empty"` panel instead of an empty canvas.
- ISC-163 (W6 bookmark): POST `/api/bookmarks { name, url:"/graph" }` → 201 with id; DELETE → 204. No bookmark-plumbing changes required for the new URL shape.
- ISC-164..165 (W6 roadmap): home page route list updated to surface all 4 query pages + `/graph` as live links; the stale `Derived edges → /graph` entry removed.
- W6 verify suite: `bun run scripts/verify-w6.ts` → 11/11 pass. Full regression: `verify-w3.ts` 23/23, `verify-w4.ts` 12/12, `verify-w5.ts` 29/29, `verify-w5b.ts` 33/33, `bun test` 18/18 all still green.
- Cato (E4 cross-vendor audit, W6): `skipped` — codex CLI still not installed on WSL host. Advisor invoked and surfaced the "is this a star?" structural question; investigation confirmed the star is intentional in the v1 dataset (all 0.5-confidence edges are connection-to-connection within-employer pairs that would emit ~9k edges if densified). Documented in W6 Decisions with a follow-up flag for an explicit "show within-cluster mid-confidence" toggle in a future session.
- ISC-166..167 (W7): `scripts/screenshots.ts` runs in ~30s against `bun dev`, captures 6 viewport-sized PNGs to `docs/screenshots/` (range 53KB–346KB, total ~770KB).
- ISC-168..175 (W7): README rewrite verified by `verify-w7.ts` content asserts — Bun quick start, Docker section with bind-mount, screenshot references, `@libsql/client` driver (no stale `better-sqlite3` mention), 3-kind taxonomy spelled out, in-memory-parse privacy claim, roadmap with W4/W6 marked shipped + W7 in flight, CONTRIBUTING.md link.
- ISC-176..177 (W7): Dockerfile two-stage build (oven/bun:1.3-alpine builder + runner), bun install + bun run build + bun run db:migrate-on-start, `HOSTNAME=0.0.0.0` so the container is reachable from host port-forward, drops to non-root `bun` user, `data/` volume declared. `.dockerignore` excludes `data/`, `node_modules/`, `.git/`, `.next/`, `docs/screenshots/`, ISA.md.
- ISC-178..179 (W7): `CONTRIBUTING.md` points at `Projects/Strand/ISA.md` as project state-of-record; `LICENSE` is MIT with copyright `(c) 2026 Matt Alexander`.
- ISC-180..182 (W7): `package.json` `version`: `0.1.0-rc.1` (proper-semver pre-release), `license`: `MIT` (no longer `UNLICENSED`), `scripts.screenshots` exposed.
- ISC-183..184 (W7 anti): `data/` is in both `.gitignore` (W1) and `.dockerignore` (W7); no `COPY data/` or `COPY ... strand.db` line in the Dockerfile (matched by regex).
- ISC-185 (W7 regression): all prior verify suites still green after W7 file additions — `verify-w3` 23/23, `verify-w4` 12/12, `verify-w5` 29/29, `verify-w5b` 33/33, `verify-w6` 11/11, `bun test` 18/18, `tsc --noEmit` clean.
- W7 verify suite: `bun run scripts/verify-w7.ts` → 32/32 pass.
- **Docker not built locally** — `docker` is not installed on this WSL host. Dockerfile is syntactically sound and matches the standard Bun + Next two-stage pattern; the user must run `docker build -t strand .` once from a host with Docker before tagging `v0.1.0`. Captured as a follow-up action item rather than a code change.
- **`output: 'standalone'` deferred** — Advisor flagged this as the #1 Dockerfile-syntactically-sound-but-runtime-broken trap, but the current pattern uses `bun run start` (=`next start`) against the regular `.next` build, which works without standalone. The standalone output would shrink the runtime image (no devDeps in node_modules) but is an optimisation, not a correctness fix. Filed for post-v0.1.0.
- **v0.1.0 tag is a user action.** No git remote is configured. The tag + push + GitHub release stay manual, with the package.json version bump to `0.1.0` happening at that point. Captured in W7 Decisions so future-Claude doesn't try to push on its own.

- 2026-05-14 W8a: docker.io installed in WSL via apt; passwordless sudo absent so install hand-off was done by user in a real terminal. CLI v29.1.3, daemon up, user added to docker group + socket chmod 666 as session fallback.
- 2026-05-14 W8a: legacy-builder DNS quirk on first `docker build` — `FROM oven/bun:1.3-alpine` failed to resolve via WSL NAT gateway. Workaround: `docker pull oven/bun:1.3-alpine` standalone (succeeded), then re-ran build with cached base. Follow-up: install buildx (modern BuildKit) to avoid the legacy-builder deprecation + DNS path.
- 2026-05-14 W8a: refined: W7 ISA claimed Dockerfile was "syntactically sound" but it had a real bug — Step 15 copied a `public/` directory that never existed in the project. Fixed by creating `public/.gitkeep` (commit 72e3957). Lesson: "syntactically sound without running it" is the same as "untested."
- 2026-05-14 W8a: refined: README + `src/app/page.tsx` had three drift strings ("v0.1.0-pre", "W7 🚧 In flight", "Private until v0.1.0") that became false at tag time. Fixed in commit 5e6c272 before tag.
- 2026-05-14 W8a: Advisor (commitment-boundary, Rule 2) consulted before tag creation. Surfaced CHANGELOG.md absence and version-string drift; user chose Minimal prep path — embedded rich release notes directly in the annotated tag message instead of CHANGELOG.md. Other Advisor items (BuildKit, base-image digest pinning, OCI labels, signed tag) parked as post-v0.1.0 follow-ups in the tag annotation itself.
- 2026-05-14 W8a: tag `v0.1.0` created locally on commit `5e6c272`. Push + GitHub remote setup + private→public flip + GitHub release remain user actions per the established convention.

- ISC-203..204 (v0.2.0-B param parsing): playwright firefox probe of `/graph?kinds=manual,derived_overlap&minConfidence=0.5` and `/graph?kinds=foo,bar&minConfidence=NaN`. Both return 200; first surfaces 2 chips ON + slider at "≥ 0.50"; second falls back to all-4 chips + "≥ 0.70" (invalid values silently dropped per spec).
- ISC-205..206 (filters applied): direct assembler probe via `bun /tmp/strand-default-isc207.ts`. `assembleNetworkGraph({kinds:["manual","derived_overlap"], minConfidence:0.7})` returns nodes=1 edges=0 on the real dataset (only owner; no derived_overlap edges at 0.7 in current data); default returns nodes=150 edges=149.
- ISC-207 (default byte-identical): explicit comparison — `assembleNetworkGraph()` ≡ `assembleNetworkGraph(undefined, {})` ≡ `assembleNetworkGraph(undefined, {kinds:undefined, minConfidence:undefined})` ≡ `assembleNetworkGraph(undefined, {kinds:[all-4], minConfidence:0.7})`. All four return `nodes=150 edges=149 cand=161 selected=150 floor=0.7`. No regression vs pre-Slice-B.
- ISC-208..210 (filter panel UI): playwright firefox — `data-testid="graph-filters"` present (1 instance), 4 chips (`kind-chip-{manual,derived_overlap,derived_currently,derived_no_overlap}`), `data-testid="confidence-slider"` + `confidence-value` ("≥ 0.70" on default load).
- ISC-211 (URL update via pushState): clicking `derived_currently` chip pushes URL `?kinds=manual%2Cderived_overlap%2Cderived_no_overlap`; dragging slider to 0.5 pushes URL `...&minConfidence=0.50`. No full page reload (network probe confirms one `/graph` request, no second navigation).
- ISC-212 (popstate restores state): goBack from `?kinds=...&minConfidence=0.50` → URL becomes `?kinds=...` → chip states stay reflecting kinds param, slider reverts to "≥ 0.70". goBack again → URL becomes `/graph` (no params) → chip aria-pressed for `derived_currently` reverts to `true`. **Required a Slice-B-specific refactor** (see Decisions entry 2026-05-20: popstate listener replaced by `useSearchParams` synchroniser).
- ISC-213 (no SSR/CSR hydration mismatch): playwright firefox load of `/graph?kinds=manual,derived_overlap&minConfidence=0.5` — 0 hydration warnings in console (3 unrelated warnings: 2 benign font-preload, 1 pre-existing Cytoscape wheel-sensitivity notice from W6 code).
- ISC-214 (slider at 0.0 anti-crash): slider dragged to 0.0 — label updates to "≥ 0.00", filter panel still rendered, 0 pageerrors. Server returns 200 (~3.6 MB payload — NODE_CAP still bounds the rendered set; the densifying hairball from W6 Changelog stays prevented in node count, though edge count between the 150 retained nodes can grow large at minimum confidence — documented as a follow-up for an edge cap).
- ISC-215 (meta.candidateCount): `graph-canvas.tsx` stats grid renders `{meta.candidateCount.toLocaleString()}` (line 127). On default URL: 161 candidates / 150 selected. Filter changes → candidates count updates accordingly (e.g. manual-only: 1 candidate / 1 selected).
- v0.2.0-B regression: `tsc --noEmit` clean. `verify-w6.ts` fails on missing `data-testid="graph-meta"` — pre-existing v0.2.0-A fallout, NOT a Slice B regression (see Decisions 2026-05-20 v0.2.0-B W6 entry).
- Cato (E3 cross-vendor audit, v0.2.0-B): `skipped` — codex CLI still not installed on WSL host (same gap noted W4/W5a/W5b/W6/W7). Advisor (commitment-boundary, Rule 2) not invoked this slice — scope was small (~3 files: graph.ts filter additions, graph/page.tsx param parsing, new graph-filters.tsx + tiny graph-kinds.ts), browser-verify caught the only structural bug (client/server boundary), and the popstate→useSearchParams pivot was driven by empirical probe results not a design decision.

- ISC-216 (min-degree post-filter): playwright firefox — drag min-degree slider 1→5 on /graph; URL updates to `?minDegree=5`; back-button reverts to default (URL empty, label "any"); 0 pageerrors. Server-side: `assembleNetworkGraph(undefined, {minDegree:5})` correctly drops nodes whose visible-edge degree < 5 and cascades edge drops; owner kept regardless.
- ISC-217 (param parsing): `curl /graph?minDegree=0` clamps to slider value=1 (default); `curl /graph?minDegree=99` clamps to 20 (MAX); `curl /graph?minDegree=abc` falls back to default.
- ISC-218 (slider UI): `data-testid="min-degree-slider"` + `min-degree-value` render in the filter panel below the confidence slider; label reads "any" at 1, "≥ N" otherwise; URL-sync'd via the same `apply()` path that handles kinds + confidence.
- ISC-219 (NavProgress): playwright firefox — clicked first internal `<a>` in `main`; within 100ms of click, the gradient bar was present in the DOM (detected via `[aria-hidden][style*='linear-gradient']`); 0 pageerrors. Click on same-href self-link is correctly NOT triggered. Capture-phase listener survives downstream `stopPropagation`.
- ISC-220 (loading.tsx): `src/app/graph/loading.tsx`, `src/app/people/loading.tsx`, `src/app/companies/loading.tsx` present; routes return 200 in prod (`curl /graph` 200, `/people` 200, `/companies` 200). Manual confirmation that Next 14 picks these up: stripped one and saw blank screen during compile; restored and saw the skeleton.
- v0.2.0-C regression: `tsc --noEmit` clean. Prod build (`bun run build`) succeeds — 4m16s first time, 2m03s rebuild after edits; bundle size unchanged for `/graph` route (143 KB First Load JS). All prior v0.2.0-B verifications still green (chip toggles + confidence slider + Back-button restore confirmed via re-running the v0.2.0-B probe).
- Cato (E3 cross-vendor audit, v0.2.0-C): `skipped` — same WSL-host gap. Advisor not invoked; scope was small, browser-verify caught and confirmed the work end-to-end, and the only non-obvious design decision (click-intercept vs router-events) is dictated by Next 14 having no other navigation-start hook.

- ISC-227..231, ISC-239, ISC-241 (v0.3.0-A parser): `bun test src/lib/linkedin/parse.test.ts` → **16/16 pass** (existing 6 + 10 new for messages). Real Complete export smoke (`bun -e parseLinkedInExport(...)`): 252ms parse time on 2209 raw rows → 2228 expanded records; `messagesParseStats: {parsed:2209, expanded:2228, skipped_no_url:108, skipped_no_date:0}`; ownerProfileUrl detected as `https://www.linkedin.com/in/matt-pwc-bi`.
- ISC-232..238, ISC-240 (v0.3.0-A ingest): full `ingestLinkedInExport` run on Complete export → `messageStats: {parsed:2209, expanded:2228, skipped_no_url:108, skipped_no_date:0, skipped_no_person:654, inserted:1573}`. Ingest duration 37.8s. Direction breakdown: 625 sent / 945 received = 1570 (was 1570 pre-contentHash, **+3 after the Advisor catch on same-second collision**). `SELECT COUNT(*) FROM messages WHERE from_person_id = to_person_id AND tenant_id='local'` → 0 (anti-ISC-238 verified).
- ISC-235 (idempotency): re-ingest of same zip bytes returns `{duplicate:true, messages:1570}` via the `existingBatch` sha256 shortcut; messages-table delta is 0 across the re-run. (Note: number is 1570 here because this verification ran before the contentHash refinement; post-refinement re-smoke landed at 1573, then re-re-ingest of the same bytes still delta=0.)
- ISC-237: `inserted` (1573) ≥ 80% of (`parsed` − `skipped_no_person`) (1555). Actual: 1573 / 1555 = 101%. PASSED.
- v0.3.0-A regression: `bun run typecheck` clean; pre-existing test count went 6 → 16 (10 new messages tests); existing `parse.test.ts` real-export round-trip (`ISC-1..10`) still passes against Basic export. No verify-w6 regression — `data-stat` cells unchanged; the change is purely in `src/lib/linkedin/` + `src/lib/db/schema.ts` use, not in the graph rendering path.
- Cato (E3 cross-vendor audit, v0.3.0-A): `skipped` — codex CLI still not installed (same gap noted W4..v0.2.0-C). Advisor (commitment-boundary, Rule 2) **invoked and produced a real catch**: same-second deterministic-ID collision risk on rapid-fire same-pair messages. Refinement landed as `contentHash` element in the ID tuple. Empirical impact: 3 actual messages recovered (1570 → 1573). Other Advisor items: owner-name-collision (deferred to W8 multi-tenant), 1st-degree-only as selection bias (documented in Decisions; deferred as posture-not-bug).

- ISC-242..247 (v0.3.0-B messages query module): `bun test src/lib/queries/messages.test.ts` — 9 pass / 0 fail / 346 expect() calls. Top contact David Bruna Arrizurieta (105 messages: 40 sent + 65 received), stats `{firstAt: 2018-11-12, lastAt: 2019-04-25}`, single SQL round-trip verified by tracing libsql output. Empty-person case returns `{sent:0, received:0, total:0, firstAt:null, lastAt:null}` (ISC-247). Batch `listLastContactByPeople([topId, "no-such"])` returns Map size 1. Thread items have only `{id, direction, sentAt}` keys — no content/subject leak (ISC-244).
- ISC-248..253, ISC-267 (person-detail Messages section): `bun run scripts/verify-v030b.ts` — 17/17 pass. Section present, stats render with non-zero counts (40/65/last-2019-04-25) for the top contact, thread renders 20 rows with both `data-direction="sent"` (6) and `data-direction="received"` (14). Empty state: Álvaro Aguilar Arriazu (0 messages) renders `messages-empty` element AND the stats row still renders with sent=0/received=0/last=— (ISC-267). Screenshot at `/tmp/strand-verify-v030b/person-detail.png`.
- ISC-254..259 (people list): default render shows 6 last-contact cells on page 1 (most rows lack messages, expected); sort=last_contact renders 50 cells with top date 2026-05-06 (Ruben Gonzalez Wong); active chip = "Last contact". `?sort=garbage` returns 200 (fallback to default ordering — ISC-257). Screenshot at `/tmp/strand-verify-v030b/people-sort-last-contact.png`.
- ISC-260..261: same `bun test src/lib/queries/messages.test.ts` run as above. Top-contact assertion (≥10 total, sent>0, received>0) passes — David Bruna Arrizurieta is the real two-way correspondent (105 / 40 / 65).
- ISC-262, ISC-264: full Playwright probe captured 0 `pageerror` and 0 non-localhost requests across `/people/[id]` (2 different people), `/people`, `/people?sort=last_contact`, `/people?sort=garbage`.
- ISC-263: `bun run typecheck` → clean (no new TS errors).
- ISC-265: `grep -rn 'from "@/lib/queries/messages"' src/lib/queries/manualEdges.ts src/lib/queries/derivedEdges.ts` → 0 hits.
- ISC-266 (Advisor catch — extended SQL-reference grep): `grep -rnE '(FROM|JOIN|INTO|UPDATE)[[:space:]]+messages\b' src/ | grep -vE "(src/lib/queries/messages\.(ts|test\.ts)|src/lib/linkedin/ingest\.ts|src/lib/db/)"` → 0 hits. The first cut had 1 hit (raw LEFT JOIN in people.ts listPeople sort=last_contact path); the refactor through `listAllLastContactDesc` closed the leak. Pre-refactor state: 1 hit. Post-refactor state: 0 hits.
- Advisor (E3 commitment-boundary, v0.3.0-B): **invoked and produced two real catches** — (1) listPeople was JOINing messages directly while ISC-265 read green (false-positive on epistemic isolation); (2) hiding the stats row on empty conflated "checked, none" with "not tracked here". Both landed as ISA refactor + new ISCs (266, 267). Cato (cross-vendor): `skipped` — codex CLI gap, same as prior slices.

- ISC-268..272 (v0.3.0-C messages batch helper): `bun test src/lib/queries/messages.test.ts` — **12 pass / 0 fail / 355 expect() calls** (was 9 / 346 at v0.3.0-B; +3 new for the batch helper). `getMessageCountsByPeople([topId])` returns `{sent, received, total}` exactly matching `getMessageStatsForPerson(topId)` on real data. Empty input → empty Map (no SQL fired). Missing-person input → absent from Map (caller substitutes zeros, ISC-272).
- ISC-273..278, ISC-291 (v0.3.0-C reach composition + sort modes): `bun test src/lib/queries/reach.test.ts` — **9 pass / 0 fail / 1853 expect() calls**. Every candidate has the `messages` field (ISC-273), `messages.sent + messages.received === messages.total` invariant holds, `lastAt` is Date-or-null (never undefined), epistemic sort is monotone non-increasing on `score`, default arg matches explicit "epistemic" arg ordering identically (ISC-276), warmth sort is monotone non-increasing on `total` with NULLS-LAST on `lastAt`, zero-message intermediaries fall to bottom in warmth mode (ISC-277), `score` field identical across both sort modes per candidate (ISC-278).
- ISC-279..287, ISC-294, ISC-297 (v0.3.0-C UI + bookmark): `bun run scripts/verify-v030c.ts` — **18/18 playwright assertions pass**. Target Javier García López, 142 candidates. Warmth pill renders on every candidate row (`pills=142 rows=142`). Sort toggle present, `aria-pressed` flips correctly: default URL → Epistemic active, `?sort=warmth` → Warmth active, `?sort=garbage` → falls back to Epistemic active (ISC-284). Candidate set size identical across sort modes (epi=142 wrm=142). Warmth sort: top-3 totals [23, 1, 0…], monotone non-increasing, zero-tail at bottom (`zerosLastViolated=false`). reach-self panel renders for owner target identically across both sort modes (no candidate list, just `data-testid="reach-self"`). Bookmark with `?sort=warmth` URL: POST → 201, DELETE → 204. Zero `pageerror`, zero non-localhost requests across all 7 visited URLs.
- ISC-288 (v0.3.0-C JS-import isolation, unchanged from ISC-265): `grep -rn 'from "@/lib/queries/messages"' src/lib/queries/manualEdges.ts src/lib/queries/derivedEdges.ts` → 0 hits. reach.ts permitted to import; the grep target is unchanged.
- ISC-289 (v0.3.0-C SQL-reference isolation): `rg -n '(FROM|JOIN|INTO|UPDATE)\s+messages\b' src/ --glob '!src/lib/queries/messages.ts' --glob '!src/lib/queries/messages.test.ts' --glob '!src/lib/linkedin/ingest.ts' --glob '!src/lib/db/**' --glob '!scripts/**' --glob '!**/*.test.ts'` → 0 hits. reach.ts composes warmth via `getMessageCountsByPeople` + `listLastContactByPeople`; the `messages` table is never directly referenced from outside the messages.ts / ingest.ts whitelist.
- ISC-289 extended (Advisor catch, ORM-symbol probe): `rg -n 'schema\.messages|from\(messages\)|insertMessages' src/` outside the same whitelist → 0 hits. Drizzle ORM access to the messages table is also absent outside the whitelist. Captured in the Changelog v0.3.0-C entry as a follow-up — promote to a formal ISC alongside the next epistemic-category boundary.
- ISC-290..291: Unit tests for both the messages batch helper and the reach composition + sort modes are part of the 49-test full suite (`bun test` — 49 pass / 0 fail / 2270 expect() calls).
- ISC-292: `bun run typecheck` → clean (no new TS errors after the slice).
- ISC-293: `bun test` full suite — **49 pass / 0 fail / 2270 expect() calls** across 4 test files. v0.3.0-B's 28 prior tests all still green; +21 new tests (12 messages + 9 reach).
- ISC-295: Prod build deferred-but-not-blocking: dev-mode probe (`bun run dev` + `bun run scripts/verify-v030c.ts`) verifies the slice end-to-end; `bun run build` was attempted at the 90s timeout and didn't complete in that window — same dev-mode-only verification posture as ISC-26 (deferred to production-build benchmark; not a doctrine block, but a follow-up).
- ISC-296: TTFB perf — `/queries/reach/[target]` warm-cached dev: 861ms first warm hit, 1298ms with `?sort=warmth` (compile + 2 extra batch reads). Dev-mode baseline cannot be compared against a v0.2.0 prod baseline directly; follow-up captures prod TTFB after a successful production build.
- ISC-298: `/people/[id]` Messages section spot-checked unchanged (no edits to messages.ts public surface beyond the additive `getMessageCountsByPeople` export; `getMessageStatsForPerson`, `listMessageThreadForPerson`, `listLastContactByPeople`, `listAllLastContactDesc` signatures and bodies untouched).
- ISC-299: No new migration. `git diff src/lib/db/schema.ts` → empty. drizzle-kit not invoked.
- ISC-300: Anti read-side: `grep -nE 'INSERT|UPDATE|DELETE' src/lib/queries/reach.ts` → 0 hits. reach.ts contains only `db.select()` + `db.all(sql\`...SELECT...\`)` reads.
- Advisor (E3 commitment-boundary, v0.3.0-C): **invoked and produced four substantive items + one workflow false-positive** — (1) Drizzle ORM access to the messages table was a blind spot in the ISC-289 regex; broader rg verified 0 hits, captured as a Changelog learning. (2) Warmth sort tiebreakers need full determinism for bookmark stability; documented total order in Decisions + ISC-277 test confirms zero-tail position. (3) `total` is the right warmth scalar at the reach-rank surface, with `sent`/`received` available on `/people/[id]` for directionality inspection; mutuality as a separate primitive is future-scope. (4) Single-target real-data smoke is anecdotal; adversarial fixtures (all-zero warmth, divergent epistemic-vs-warmth) deferred as known scope gap. The workflow false-positive (Advisor's `--auto-state` loaded the wrong ISA slug) is a known v6.2.x deferral in PAI Algorithm; documented for future runs. Cato (cross-vendor): `skipped` — codex CLI still not installed on this WSL host.

- ISC-301..302 (v0.3.2 ORM-symbol grep): `rg -n 'schema\.messages|from\(messages\)|insertMessages|messagesTable\.|messages_table' src/ --glob '!src/lib/queries/messages.ts' --glob '!src/lib/queries/messages.test.ts' --glob '!src/lib/linkedin/ingest.ts' --glob '!src/lib/db/**' --glob '!scripts/**' --glob '!**/*.test.ts'` → 0 hits. Combined with ISC-265 (JS-import grep) 0 hits and ISC-289 (SQL-keyword grep) 0 hits → three-layer enforcement of the messages epistemic-category boundary live.
- ISC-303..305 (v0.3.2 adversarial fixtures): `bun test src/lib/queries/reach.test.ts` includes the all-zero-warmth fixture test (passes — confirms warmth and epistemic produce identical orderings when no message signal exists) and the divergent-rankings fixture test (sweeps top-20 reach-rich targets; honestly skips if none qualify rather than passing silently). Real-data execution: both tests ran without skip on Matt's dataset (15 pass / 3017 expect() calls on reach.test.ts).
- ISC-306..308 (v0.3.2 mutuality scalar): every candidate's `messages.mutuality === Math.min(messages.sent, messages.received)`; strictly one-way relationships (sent>0 received=0 OR sent=0 received>0) → mutuality === 0. Verified by reach.test.ts case "ISC-308 / ISC-321".
- ISC-309..313 (v0.3.2 sort=mutuality mode): `parseReachSort("mutuality")` → `"mutuality"`; case-sensitive (`"MUTUALITY"` → epistemic). Sort closure ordering monotone non-increasing on `messages.mutuality`; NULLS-LAST on `lastAt`; zero-mutuality tail at bottom. ISC-312/313: `sort="mutuality"` does NOT alter `score` or `messages.total` on any candidate vs sort="epistemic" — three signals stay independent. Real-data probe: mutuality top-1 = 11, vs warmth top-1 = 23 — scalars visibly produce different orderings (the warmth top is one-way-heavy; mutuality finds the more balanced contact).
- ISC-314..318 (v0.3.2 three-button UI): `data-testid="reach-sort-mutuality"` button renders in the toggle group; aria-pressed flips correctly; sum-of-aria-pressed=true is exactly 1 across all three modes (epistemic / warmth / mutuality); ?sort=mutuality renders Mutuality active; ?sort=garbage falls back to Epistemic active; mutuality pill (`data-testid="reach-mutuality"`) renders on every candidate row (142/142 on the real-data probe target); heading rotates ("Strongest reach" / "Warmest reach" / "Most mutual reach"); bookmark URL preserves the sort param for all three modes.
- ISC-319..322 (v0.3.2 tests): `bun test src/lib/queries/reach.test.ts` — 15 pass / 0 fail / 3017 expect() calls (+6 new v0.3.2 cases: 1 parseReachSort mutuality + 3 mutuality describe + 2 adversarial). `messages.test.ts` untouched — messages module public surface unchanged (ISC-322).
- ISC-323..325 (v0.3.2 verify + typecheck + suite): `scripts/verify-v030c.ts` extended to cover the mutuality surface — **29/29 playwright assertions pass** (was 18/18 at v0.3.1; +11 new for v0.3.2). `bun run typecheck` → exit 0. `bun test` full suite → 55 pass / 0 fail / 3434 expect() calls across 4 test files.
- ISC-326 (Advisor commitment-boundary): **invoked and produced two substantive items + ten v0.3.3 conjectures + one workflow false-positive** — (1) mutuality tie-storms at low integers need explicit deterministic secondary sort (chain already in place: mutuality → lastAt → score → name); (2) display rule `—` vs `↔ 0` — `↔ 0` never rendered (zero state is `—`, parallel to warmth pill). Ten conjectures filed in Decisions as v0.3.3 follow-ups (mass-channel exclusion, time-decay parity, alias imports, tagged-template SQL precedence, fixture-skip meta-assertion, back-button bookmark coverage, default-elision asymmetry, CI gate enforcement, dynamic-imports non-goal, type-only-imports posture). Cato (cross-vendor): `skipped` — codex CLI not installed on this WSL host.
- ISC-327 (release): annotated tag `v0.3.2` cut at the slice commit and pushed to origin/main + refs/tags/v0.3.2 (per v0.3.0 / v0.3.1 push pattern).
- ISC-328: No new SQL migration. `git diff src/lib/db/schema.ts` → empty.
- ISC-329: Anti read-side: `grep -nE 'INSERT|UPDATE|DELETE' src/lib/queries/reach.ts src/lib/queries/messages.ts` → 0 hits in reach.ts; messages.ts only contains read-side `db.all(sql\`SELECT ...\`)` calls.
- ISC-330: Anti regression: `/people/[id]` Messages section, `/people?sort=last_contact`, `/queries/reach/[id]?sort=epistemic`, and `/queries/reach/[id]?sort=warmth` ALL render byte-identical to v0.3.1 in their existing fields. Mutuality pill is additive (new DOM element); warmth pill content unchanged.

- ISC-331..333 (v0.3.3 alias-import probe): ISC-301 regex extended to catch `import * as X from ".../messages"` (namespace) + `import { messages as X }` (aliased named). `scripts/test-alias-probe.ts` self-test: 3 violating fixtures MATCH, 3 benign fixtures (type-only import, comment, candidate.messages field access) NO-MATCH — "expected 3 hits / got 3", regex distinguishes correctly.
- ISC-334..335 (v0.3.3 fixture-skip meta-assertions): `pickTargetWithReachCandidates()` returns NON-NULL on Matt's real dataset (asserted); `pickTargetWithReachCandidates()` differs from `pickAllZeroWarmthTarget()` AND a divergent-rankings target exists in the top-20 by reach count (asserted via `divergentFound` boolean before exiting the loop). Two new `bun test` cases under "v0.3.3: fixture-skip meta-assertions" describe block.
- ISC-336..338 (v0.3.3 back-button + default-elision + epistemic-bookmark): `scripts/verify-v030c.ts` extended. Back-button case cycles Epistemic → Warmth → Mutuality, then back twice; URL returns to `?sort=warmth` (Warmth aria-pressed=true) and then to the default URL (Epistemic aria-pressed=true). Uses `page.waitForFunction` with 3s timeout to bridge the brief Next.js client-nav DOM-update lag (URL changes before aria-pressed settles by ~50-200ms). Default-elision case: `?sort=epistemic` navigates correctly with Epistemic active. Epistemic-bookmark case: POST/DELETE round-trip works for `?sort=epistemic` URL.
- ISC-339..341 (v0.3.3 ISC-301 spec edges, codified in scripts/check-isolation.ts comment block): tagged-template SQL precedence (ISC-289 catches first, ISC-301 ORM probe also matches; either trip sufficient); dynamic-imports + require() bypass static-text probes — explicit non-goal; type-only imports (`import type { … }`) compile-time-only and ALLOWED from any module — the probe regex matches bare `import { … }` form, not `import type { … }` form. Captured at the top of check-isolation.ts.
- ISC-342..343 (v0.3.3 probe runner): `scripts/check-isolation.ts` runs all three probes (ISC-265, ISC-289, ISC-301-extended) via grep (rg not always on PATH inside Bun child-process env on this WSL host — grep is universal). Output: "✓ ISC-N — clean" per probe + "3/3 clean — three-layer messages-category isolation holds" summary line. Exit 0 on clean, 1 on any violation. On violation: file:line of each offending hit (first 10 + "… and N more" if truncated).
- ISC-344..347 (v0.3.3 verification): `bun run typecheck` → exit 0. `bun test` → 57 pass / 0 fail / 3437 expect() calls (+2 from v0.3.2: ISC-334 + ISC-335). `scripts/verify-v030c.ts` → **34/34 playwright assertions** (was 29 at v0.3.2; +5 new: back-button × 2, default-elision, epistemic-bookmark POST + DELETE). `scripts/check-isolation.ts` → exit 0 with 3/3 clean.
- ISC-348..349: no SQL migration; read-side only. `git diff src/lib/db/schema.ts` → empty. INSERT/UPDATE/DELETE grep across reach.ts, messages.ts, check-isolation.ts, test-alias-probe.ts → 0 hits.
- ISC-350: annotated tag `v0.3.3` cut + pushed to origin (per v0.3.0..v0.3.2 pattern).
- ISC-351: anti regression — every v0.3.1+v0.3.2 behaviour on `/queries/reach/[id]` byte-identical to v0.3.2 (v0.3.3 added no UI changes, only tests + probes + scripts + a slightly broader ISC-301 regex).
- ISC-352 (Advisor decision): **Advisor SKIPPED for v0.3.3.** show-my-math: v0.3.3 is a consolidation slice driven BY Advisor's own v0.3.2 conjectures — re-running Advisor on the slice that closes Advisor's prior items would be circular. The substantive critique is already embedded in the v0.3.2 Changelog learning + Decisions; v0.3.3 just closes them with concrete artifacts. v0.3.4 (substantive new code in `assembleNetworkGraph`) WILL get a full Advisor pass.

- ISC-353 (v0.3.4 baseline): `/graph` default warm TTFB 2.3s/2.9s/2.3s; `/graph?minConfidence=0` 2.9s/2.7s/2.6s. assembleNetworkGraph isolated bench (warm) default 1.6-2.3s, minConfidence=0 1.6-1.8s. Segment timing: candidates UNION-ALL-4× = 1100ms, derived edges query = 350ms, employer (correlated) = ~150ms, others <40ms each. **Candidates query is the dominant bottleneck.**
- ISC-354..355 (v0.3.4 employer optimization): correlated `(SELECT c.name FROM positions po JOIN companies c ... LIMIT 1)` replaced with windowed `ROW_NUMBER() OVER (PARTITION BY po.person_id ORDER BY <chain>) ... WHERE rn = 1`. Same selection rule + deterministic tiebreaker added (`po.id ASC` — see ISC-364 Advisor catch). JS Map join replaces the inline subquery; the people SELECT no longer carries it.
- ISC-356 (v0.3.4 candidates optimization, beyond original plan): UNION ALL 4× collapsed to UNION ALL 2× via CROSS JOIN unpivot — each of `manual_edges` and `derived_edges` is now scanned ONCE per call instead of twice (once per endpoint via `CASE n WHEN 0 THEN person_a ELSE person_b`). assembleNetworkGraph isolated bench POST: default 1.1-1.4s, minConfidence=0 1.1-1.3s — **~30-40% improvement** over baseline. Page TTFB POST: default 1.8-2.5s, minConfidence=0 2.0-2.3s — **~25% page improvement**. Hits the ≥30% target on the isolated-SQL axis; modest on page TTFB due to dev-mode SSR overhead. Prod-build benchmark deferred (same as ISC-26 from W2).
- ISC-357 (v0.3.4 equivalence — full set, not 10/10): `scripts/verify-graph-perf.ts` cross-checks every non-owner node (149/149 on real data) against the correlated-subquery selection rule with the deterministic tiebreaker applied to BOTH paths. **149/149 match.** Window function reproduces LIMIT 1 + ORDER BY semantics exactly.
- ISC-358 (v0.3.4 return-shape invariance): `GraphNode.company` field type (`string | null`) and nullability preserved. `assembleNetworkGraph()` return signature unchanged. People without any position row → company:null. People with positions → company is the canonical declared-first / current-first / latest-first name.
- ISC-359..362 (v0.3.4 regression-safety): `bun run typecheck` exit 0. `bun test` full suite 57 pass / 0 fail / 3437 expect() calls (v0.3.4 touches graph.ts only — reach/messages test suites unchanged). `scripts/verify-v030c.ts` not re-run in this session but graph.ts changes are isolated from `/queries/reach/*`. `scripts/check-isolation.ts` 3/3 clean (graph.ts doesn't touch the messages table boundary).
- ISC-363 (v0.3.4 no migration): `git diff src/lib/db/schema.ts` empty. Window function + CROSS JOIN unpivot are standard SQL; libsql/SQLite have supported both since well before this project started.
- ISC-364 (Advisor commitment-boundary, v0.3.4): **invoked, produced two must-fix items, both patched before tag** — (a) deterministic tiebreaker on the ORDER BY chain: added `po.id ASC` at the end on BOTH the windowed query AND the reference subquery in verify-graph-perf.ts (matching mutuality-tiebreak-chain pattern from v0.3.2). Re-verified 149/149 equivalence after the patch. (b) `COALESCE(start_date, '0000-00-00')` concern: Advisor inferred 1-arg COALESCE from my summary; actual code has 2-arg with sentinel — NULL becomes '0000-00-00', sorts LAST under DESC (same as original). No change needed. **Three additional Advisor observations not patched, all benign:** (i) CROSS JOIN unpivot may prevent index pushdown if a future WHERE filter is added on the unpivoted endpoint — captured as a code comment near the unpivot; (ii) window-function sort cost — partition sort is in-memory, scales O(N log N) per partition, fine for 150 nodes; (iii) JS Map missing-key handling — `companyByPersonId.get(p.id) ?? null` returns null cleanly, no crash.
- ISC-365 (v0.3.4 release): annotated tag `v0.3.4` cut + pushed to origin (per v0.3.0..v0.3.3 pattern).
- ISC-366 (v0.3.4 ISA Decision): scope was kept minimum-viable to the measured bottleneck. (a) The candidates UNION ALL 4× WAS the dominant cost (1100ms segment); CROSS JOIN unpivot was the higher-leverage fix. (b) Employer correlated-subquery was a secondary cost (~150ms); window-function rewrite preserved its semantics with a deterministic tiebreaker. (c) Other potential optimizations (caching assembled graphs, materialized views, index extensions) deferred — would require migrations or cache-invalidation infrastructure beyond a read-side perf slice.

- **v0.3.4-hygiene (2026-05-21, post-lunch):** Two small loose ends closed without a versioned slice. (1) **Prod-build benchmark + ISC-26 close-out**: `bun run build` succeeded (~70s on this WSL host); `bun run start` boots; warm prod TTFB measured — `/graph` default **0.76-1.0s** (down from dev ~2.0s, baseline historic v0.2.0 prod ~3.2s — net ~4× faster than v0.2.0 despite added functionality), `/graph?minConfidence=0` **1.08-1.17s**, `/queries/reach/[id]` (Javier, 142 candidates) **0.62-0.77s**. v0.3.4 perf claims hold in prod, not just dev. ISC-26 (DEFERRED-VERIFY since 5/13, 8 days open) flipped to `[x]` with prod-build evidence. (2) **`scripts/README.md` created** — table-of-contents + per-script purpose + when-to-run for the 21 scripts in `scripts/`. Categorised: Maintenance / Isolation gates (v0.3.3+) / Performance benches (v0.3.4) / Browser verify probes / Conventions. Future-Claude shouldn't need to grep three-line headers to figure out which probe runs after which change.
- **Known minor cleanup deferred:** `next.config.mjs` has `serverExternalPackages` (Next 15 key) — Next 14.2 warns "Unrecognized key" on every build start. Renaming to `experimental.serverComponentsExternalPackages` would silence the warning. Not in scope for this hygiene close-out; one-line follow-up.

- ISC-367..375 (v0.4.0 server-side filters): `GraphFilters` extended with `cap`, `companyId`, `scope` (all optional, defaults preserved). `assembleNetworkGraph` precomputes `allowedPersonIds` via either windowed ROW_NUMBER for `scope=current` (same selection chain as v0.3.4 employer lookup, including `po.id ASC` tiebreaker) or `DISTINCT person_id FROM positions WHERE company_id` for `scope=ever`. Composition: candidates → filter by allowedPersonIds → cap. Owner unconditionally added after candidate selection (load-bearing rule preserved). `GraphMeta` surfaces `cap`/`companyId`/`companyName`/`scope` when overridden — UI consumes these.
- ISC-376..377 (v0.4.0 search): new `searchCompanies(q, limit, tenantId)` in companies.ts mirrors `searchPeople` shape; new `/api/companies/search?q=` endpoint mirrors `/api/people/search`. Same `runtime: "nodejs"` + `dynamic: "force-dynamic"` posture, same ≥2-char gate.
- ISC-378..382 (v0.4.0 UI components): new `CompanyPicker` client component at `src/components/company-picker.tsx` mirrors PersonPicker (AbortController debouncing, ≥2-char gate). `GraphFilters` extended with cap dropdown + CompanyPicker + scope toggle. Scope toggle hidden when no company is selected (Q2-a). `× clear` affordance present when company is selected. All controls URL-bind via the existing `useSearchParams` + `pushState` synchroniser pattern (no popstate listener).
- ISC-383..385 (v0.4.0 page): `/graph/page.tsx` reads + validates `cap`, `company`, `scope`; passes them through; forwards `meta.companyName` so the UI shows the resolved name on cold load. `GraphCanvas` propagates the four new init props to both filter-panel mount points (no-nodes + has-nodes).
- ISC-386..391 (v0.4.0 unit tests): `src/lib/queries/graph.test.ts` — 10 new tests covering cap clamp (discrete; non-snap → default), scope=current per-node JOIN equivalence, scope=ever ⊇ scope=current, filter-then-cap composition, invalid companyId graceful empty, default URL byte-identical, searchCompanies ordering + SQL-injection-safe input. `bun test` 67 pass / 0 fail / 3750 expect() calls (+10 new).
- ISC-392 (v0.4.0 verify probe): `scripts/verify-v040.ts` — **15/15 Playwright assertions pass** against PwC España (144 current). Default URL → cap dropdown 150 + company picker visible + scope toggle hidden. `?cap=50` → dropdown reflects 50. `?company=<pwc-id>` → active pill shows resolved name + scope toggle visible + Current aria-pressed=true + × clear visible. `?scope=ever` → Ever aria-pressed=true. `?company&cap=50` composes correctly. `?cap=garbage` → default 150. `?company=bogus` → 200 graceful empty. Dev-mode chunk-staleness errors filtered (Next.js HMR artifact, not a product bug).
- ISC-393..395 (v0.4.0 build + isolation): `bun run typecheck` exit 0; full `bun test` suite green; `scripts/check-isolation.ts` 3/3 clean (v0.4.0 didn't touch the messages module).
- ISC-396 (v0.4.0 no migration): `git diff src/lib/db/schema.ts` empty. Company filter uses existing `positions` + `companies` tables.
- ISC-397 (v0.4.0 release): annotated tag `v0.4.0` cut + pushed to origin — first minor bump since the warm-path arc.
- ISC-398..399 (v0.4.0 anti-regression): default `/graph` URL renders byte-identical node/edge sets vs no-filter call (unit-tested). Existing `kinds=`, `minConfidence=`, `minDegree=` filters work identically — no parameter name collisions.
- ISC-400 (v0.4.0 Advisor commitment-boundary): **invoked, produced one must-fix + two should-fix items, all patched before tag** — (1) **Cap UI/server mismatch was real**: original code accepted any int [1, MAX_NODE_CAP] server-side but UI snapped to the dropdown's discrete values, creating a footgun where `?cap=37` would silently render as 50 in the dropdown while the SQL fetched with cap=37. Adopted Advisor's stance (1) **server-strict**: cap is a discrete control; only `CAP_DROPDOWN_VALUES` (50/100/150/250/500) accepted; non-snap values (including any out-of-range int) fall back to NODE_CAP default. URL ⇔ dropdown is now an exact round-trip. (2) **LIKE-wildcard escape** in `searchCompanies`: user input containing `%` or `_` would behave as SQL LIKE wildcards. Patched with explicit `ESCAPE '\\'` clause + manual `% → \\%`, `_ → \\_`, `\\ → \\\\` escaping on the trimmed query. (3) **Owner counts against the cap** documented as intentional: owner is added first (load-bearing rule), then candidates fill the remaining `cap - 1` slots. Cap=50 means 50 total visible nodes (owner + 49 non-owner). Test updated to reflect this. **Three Advisor concerns deferred to v0.4.1+**: multi-company smoke (test against small / empty-current / ambiguous-name companies in addition to PwC España); EXPLAIN QUERY PLAN on the scope=ever DISTINCT query for scale concerns (fine on Strand's 1198 companies but worth a check before larger seeds); keyboard a11y on the typeahead. Cato (cross-vendor): `skipped` — codex CLI still not installed.

- 2026-05-21 v0.4.0 refined (Advisor catch, commitment-boundary): **Cap is a discrete control, not a freeform integer.** Original implementation accepted any int in [1, MAX_NODE_CAP=500] server-side but the dropdown snapped to discrete options — `?cap=37` rendered as 50 in the dropdown while the SQL fetched 37. Footgun on a release whose entire point is URL-bound filters. Adopted Advisor's "server-strict" stance: cap must be one of `CAP_DROPDOWN_VALUES`; non-snap → fall back to default. URL ⇔ UI now an exact round-trip; no silent snap-on-render. MAX_NODE_CAP retained as a constant but currently unreachable; would only matter if a future "custom cap" affordance landed.
- 2026-05-21 v0.4.0 refined (Advisor catch, commitment-boundary): **LIKE-wildcard escape on the typeahead.** `searchCompanies("%")` would have matched everything via SQLite's `LIKE` wildcard semantic. Patched with explicit `ESCAPE '\\'` clause + escaping `% → \\%`, `_ → \\_`, `\\ → \\\\` in the trimmed query before substring-wrapping. Parameter binding alone doesn't protect against this — the wildcard interpretation happens INSIDE the LIKE operator.
- 2026-05-21 v0.4.0: **Owner counts against cap (load-bearing).** Owner is added to selectedIds first (unconditionally), then candidates fill the remaining `cap - 1` slots. Cap=50 means 50 total visible nodes including owner. This composes correctly with company filter: `?company=X&cap=50` returns ≤50 total nodes at X (or X + owner-disconnected if owner isn't at X). Documented at the candidate selection loop + verified in ISC-386.

### at-company pagination — audit finding (A) (2026-05-29)

**Slice (ISC-420..431, E2):** `/queries/at-company` rendered every position row for a company (`listAtCompany` had no LIMIT; the page `.map()`'d the whole set) — DOM bloat on 1000+ employee companies. Fix adopts the repo's existing `pageWindow` + `PAGE_SIZE=50` pagination, identical to `listCompanies` / `listPeople`. No new SQL migration; read-side only.

**Decisions:**
- 2026-05-29: **Reuse, don't reinvent — `listAtCompany` returns the same paginated shape (`{rows,total,totalPages,hasNext,hasPrev}`) as `listCompanies`/`listPeople`.** The three list surfaces now share one pagination idiom. `page` added as a positional arg before `tenantId`; only caller is the at-company page.
- 2026-05-29: **Count query mirrors the row query's FROM/JOIN/WHERE exactly** (incl. the `connections` LEFT JOIN), so `totalPages`/`hasNext` can't desync from the actual LIMIT/OFFSET slice if that join ever fans out. Tests assert against the returned `total`, never a hand-computed count.
- 2026-05-29: **`PageNav` extended with an optional `extraParams` map (backward-compatible).** Existing callers (`/people`, `/companies`) pass nothing → byte-identical hrefs (verified live: `/people?page=2`, `/companies?page=2`). at-company passes `company` always + `status`/`sort` only when non-default, so the default view keeps a clean `?page=2&company=<id>` URL.
- 2026-05-29: **Header shows the true `total`, not the page-slice length** (was `{rows.length}`). Per [[feedback_render_zeros_not_absence]] the count is the load-bearing claim surface; only the content list is conditional. FilterChips omit `page` → status/sort changes reset to page 1.
- 2026-05-29: **Out-of-range `?page=` is not clamped** — mirrors `/people`/`/companies` (empty slice, real total, "No positions match this filter"). Consistency across the three surfaces chosen over a bespoke clamp; the UI never links past `totalPages`.
- 2026-05-29: **Advisor SKIPPED (show-my-math).** Scope is one query + one shared component + one page; the risk surface (count/slice parity, backward-compat, default-elision) is fully covered by 8 unit tests against real data + a live curl probe across pages 1/2/3 + `/people` `/companies` regression probes. Cato N/A (E2, and codex CLI still absent on this WSL host — see [[state_cato_codex_not_installed]]).

**Verification:**
- ISC-420/424 (DOM-bloat fixed — core audit-A): live curl of PwC España (145 positions) → page 1 = **50** `data-origin` list items, page 2 = **50**, page 3 = **45**. No page renders the full 145. `page-nav` present on all three.
- ISC-421: 8 unit tests (`src/lib/queries/companies.test.ts`) — page slices sum to exactly `total` across all pages; every page but the last is a full PAGE_SIZE page.
- ISC-422: last-page remainder = `total - (totalPages-1)*PAGE_SIZE` (45 = 145 − 100).
- ISC-423: `hasPrev=false`/`hasNext=true` on page 1; `hasNext=false`/`hasPrev=true` on the last page. Live: page 1 "← Previous" is a disabled span; page 3 "← Previous" is an active link, Next disabled. Indicator reads "Page 1 of 3" / "Page 3 of 3".
- ISC-425: header renders "**145 positions from your network**" (true total) on page 1, not the slice length 50. `any.total === current.total + past.total` asserted.
- ISC-426: declared-first ordering holds across the full page concatenation (no declared row after a synthesised row).
- ISC-427: `?page=9999` → `rows=[]`, `total>0`, `hasNext=false`, `hasPrev=true`.
- ISC-428: unknown company id → `{rows:[], total:0, totalPages:1, hasNext:false, hasPrev:false}`.
- ISC-429 (Anti: no migration / read-side only): `git diff src/lib/db/schema.ts` empty; companies.ts contains only `db.all(sql\`SELECT…\`)` reads.
- ISC-430: `bun run typecheck` exit 0; new test file 8 pass / 0 fail / 27 expect(); full `bun test` suite **94 pass / 0 fail / 3801 expect() across 7 files** (was 86 pass / 6 files at v0.4.1 — +8 tests, +1 file; 219s).
- ISC-431 (Anti-regression): `/people` next-href = `/people?page=2`, `/companies` next-href = `/companies?page=2` — no `company`/`status` param leak from the `PageNav` extension; both still render 50 items + page-nav.
- ISC release/tag: **DEFERRED** — work verified but not committed/tagged pending Matt's go-ahead (v0.4.2 was burned by the reverted hero attempt; next tag number is Matt's call).
