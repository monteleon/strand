import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Local-first origin guard. Strand has no authentication by design — the DB
// file on your disk IS the access control. That makes the network boundary the
// only thing between a malicious web page (CSRF) or a rebound DNS name (DNS
// rebinding) and your entire network graph. Two checks close the class:
//
//   * Host — defeats DNS rebinding. An attacker who points `evil.com` at
//     127.0.0.1 sends `Host: evil.com`; loopback-only rejects it, so the
//     browser can never read a same-origin response off the local server.
//   * Origin — defeats CSRF. Browsers attach `Origin` to every cross-origin
//     request (and all POSTs); a form on evil.com posting multipart to
//     /api/ingest/linkedin (a CORS "simple" request that skips preflight)
//     carries `Origin: https://evil.com` and is rejected here.
//
// Loopback-only by default. A user who genuinely wants LAN/remote access opts
// in explicitly via STRAND_ALLOWED_HOSTS (comma-separated hostnames, no port).
// Non-browser clients (curl, scripts) that send no Origin still work as long
// as their Host is allowed — the guard blocks the browser attack, not tooling.

function hostname(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  // Strip the port. IPv6 hosts arrive bracketed (`[::1]:3000`); the bracket
  // survives the port strip and is normalised below.
  return hostHeader.replace(/:\d+$/, "").toLowerCase();
}

function isAllowedHostname(host: string | null): boolean {
  if (!host) return false;
  const h = host.replace(/^\[|\]$/g, ""); // unwrap IPv6 brackets
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  const extra = (process.env.STRAND_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return extra.includes(h) || extra.includes(host);
}

function isAllowedOrigin(origin: string | null): boolean {
  // Absent Origin: same-origin GET/navigation and non-browser tooling. The
  // Host check still applies, so this is safe to allow.
  if (!origin) return true;
  try {
    return isAllowedHostname(hostname(new URL(origin).host));
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest): NextResponse {
  const host = hostname(request.headers.get("host"));
  const origin = request.headers.get("origin");
  if (!isAllowedHostname(host) || !isAllowedOrigin(origin)) {
    return NextResponse.json(
      { error: "forbidden_origin" },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

// Guard the API surface only. Page navigation is same-origin by construction
// and the data-bearing/state-changing risk lives entirely behind /api.
export const config = {
  matcher: "/api/:path*",
};
