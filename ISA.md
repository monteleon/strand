---
project: strand
current_task: v0.3.0-A — Messages.csv ingest (slice 1: parser + ingest path, data layer only)
slug: v0.3.0-A-messages-ingest
effort: E3
phase: complete
progress: 16/16
mode: ALGORITHM
started: 2026-05-20
updated: 2026-05-20
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
