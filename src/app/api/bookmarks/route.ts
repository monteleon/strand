import { NextResponse } from "next/server";
import {
  createSavedQuery,
  listSavedQueries,
} from "@/lib/queries/savedQueries";
import { isLocalAppPath } from "@/lib/url-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateBody = { name?: unknown; url?: unknown };

async function parseBody(request: Request): Promise<CreateBody | null> {
  try {
    return (await request.json()) as CreateBody;
  } catch {
    return null;
  }
}

export async function GET() {
  const rows = await listSavedQueries();
  // v0.4.16 (review-#4): re-validate every stored URL on read. POST has
  // hardened input validation since v0.4.9 (isLocalAppPath), but rows
  // persisted by older versions or written via direct DB access can hold
  // malicious URLs (`//evil.com`, `/\evil.com`, `javascript:`, etc.).
  // command-palette renders bookmark URLs into router.push() on click,
  // so an unfiltered GET path lets pre-hardening rows execute off-origin
  // navigation. Filter at read so the hardening covers both write AND
  // read paths; the bad rows linger in storage but never surface.
  const safe = rows.filter((r) => isLocalAppPath(r.url));
  return NextResponse.json(
    { results: safe.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) },
    { status: 200 },
  );
}

export async function POST(request: Request) {
  const body = await parseBody(request);
  if (
    !body ||
    typeof body.name !== "string" ||
    typeof body.url !== "string" ||
    !body.name.trim() ||
    !body.url.trim()
  ) {
    return NextResponse.json(
      { error: "expected JSON body with non-empty string `name` and `url`" },
      { status: 400 },
    );
  }
  // Local-first invariant: bookmarks point at in-app URLs only.
  // isLocalAppPath rejects everything that resolves to a different origin
  // after WHATWG URL parsing — `//evil.com`, `https://evil.com`,
  // `/\evil.com` (browsers normalise backslash to slash, so the old
  // string-only check let this through), `javascript:`, and so on.
  const trimmedUrl = body.url.trim();
  if (!isLocalAppPath(trimmedUrl)) {
    return NextResponse.json(
      { error: "url must be a relative in-app path (starts with /)" },
      { status: 400 },
    );
  }
  const result = await createSavedQuery({ name: body.name, url: body.url });
  if (result.kind === "duplicate_name") {
    return NextResponse.json(
      { reason: "duplicate_name" },
      { status: 409 },
    );
  }
  return NextResponse.json(
    {
      id: result.query.id,
      name: result.query.name,
      url: result.query.url,
      created_at: result.query.createdAt.toISOString(),
    },
    { status: 201 },
  );
}
