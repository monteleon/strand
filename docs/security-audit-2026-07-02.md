# Security Audit — 2026-07-02

**Scope:** Full request surface — 8 API routes, DB/query layer, LinkedIn ingest/parse, Next config, Dockerfile, git hygiene, dependencies.
**Stack:** Next.js 14.2.35, Bun, SQLite/Drizzle. Local-first, single-tenant, **no authentication by design** (the SQLite file on disk is the access boundary).

## Summary

The codebase is well-hardened — prior review cycles already closed SQL injection (all queries Drizzle parameter-bound, LIKE wildcards escaped with `ESCAPE '\'`), open-redirect via bookmarks (`isLocalAppPath` WHATWG-parses on read *and* write), upload-size bypass (mandatory `Content-Length` + `file.size` defence-in-depth), and dependencies are current. The findings below are architectural gaps, not sloppiness.

All findings were fixed and verified; see **Status** per finding and the **Verification** section.

## Findings

### 1 — HIGH — CSRF + DNS-rebinding against the unauthenticated local server
No auth, no middleware, no `Origin`/`Host` validation — so a page the user visits, or a rebound DNS name, was the whole attack surface.
- `POST /api/ingest/linkedin` uses `multipart/form-data`, a CORS **simple** request → no preflight → any site can silently mutate the graph.
- `POST /api/derive` (no body/custom content-type) → also a simple request → CSRF-triggerable expensive recompute.
- **DNS rebinding:** no `Host` allowlist → an attacker rebinding a domain to `127.0.0.1` can issue same-origin reads and **exfiltrate the entire network graph**.

**Fix:** `src/middleware.ts` guards `/api/*` — rejects any request whose `Host` isn't loopback, or whose `Origin` (when present) isn't loopback, with `403 forbidden_origin`. Loopback-only by default; opt into LAN/remote via `STRAND_ALLOWED_HOSTS`. **Status: FIXED.**

### 2 — HIGH — Docker binds `0.0.0.0` with zero auth
`Dockerfile` sets `ENV HOSTNAME=0.0.0.0`; anyone on the LAN could read/modify the graph.
**Fix:** the finding-#1 host guard blocks non-loopback access by default. Recommended run form: `-p 127.0.0.1:3000:3000` for loopback-only exposure. **Status: MITIGATED (by #1).**

### 3 — MEDIUM — Zip decompression bomb (memory-exhaustion DoS)
The upload cap (50 MB) bounds the *compressed* zip; `JSZip` then decompressed each entry into memory with no uncompressed-size cap. A 50 MB zip of zeros expands to ~50 GB → OOM.
**Fix:** `assertNoZipBomb` in `parse.ts` sums per-entry uncompressed sizes from the zip central directory (read at `loadAsync`, before any decompression) and rejects above a 200 MB total budget. **Status: FIXED.**

### 4 — LOW — Internal error detail leaked to clients
`/api/derive` and `/api/ingest/linkedin` returned `{ detail: err.message }` on 500 — can expose paths, SQL, parser state.
**Fix:** log the real error server-side; return a bare error code. The controlled `linkedin_export_missing_files` 400 (user-actionable) is retained. **Status: FIXED.**

### 5 — LOW — No security response headers / CSP
No CSP, `X-Frame-Options`, or `X-Content-Type-Options`.
**Fix:** `next.config.mjs` `headers()` adds CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`, DNS-prefetch off. `frame-ancestors 'none'` also blunts the rebinding surface. **Status: FIXED.**

### 6 — LOW — Dead unescaped LIKE helper
`likeIgnoreCase` built `%${q}%` without `escapeLikePattern` (parameter-bound, so no injection — only wildcard leakage), and was unused.
**Fix:** removed (a correct escape needs the `ESCAPE` clause the `like()` helper can't express; the function had no callers). **Status: FIXED.**

## Non-security improvements (not blocking)
- Pin `^` dependency ranges to exact versions to match the frozen `bun.lock` intent.
- Consider a shared error-shape helper across routes for consistent client contracts.
- Overall code quality, test coverage, and the review-trail comments are strong — no structural changes warranted.

## Verification
- `tsc --noEmit`: clean.
- Tests (isolation): derive 5/5, parse 38/38, ingest 41/41.
- Live probes against a running server:
  - legit same-origin GET → 200
  - `Origin: https://evil.com` POST /api/derive → 403
  - same-origin POST /api/derive → 200 (guard doesn't break the app)
  - `Host: evil.com` GET → 403 (DNS-rebind blocked)
  - multipart CSRF w/ evil Origin → 403
  - security headers present on `/`
  - 255 KB zip declaring 250 MB uncompressed → rejected before expansion

## Disclosure note
This repository is **public**. The fixes (finding #1/#2 especially) are already merged to `main` — the vulnerability classes are therefore public history. For future security work, coordinate via a private branch or a GitHub Security Advisory before publishing if disclosure timing matters.
