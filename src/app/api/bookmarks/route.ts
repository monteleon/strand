import { NextResponse } from "next/server";
import {
  createSavedQuery,
  listSavedQueries,
} from "@/lib/queries/savedQueries";

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
  return NextResponse.json(
    { results: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) },
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
  // Local-first invariant: bookmarks point at in-app URLs only. A relative
  // path starting with `/` and NOT `//` (which would be a protocol-relative
  // URL pointing offsite). Blocks a client from saving a bookmark to
  // https://evil.com that would render as a normal link in the sidebar.
  const trimmedUrl = body.url.trim();
  if (!trimmedUrl.startsWith("/") || trimmedUrl.startsWith("//")) {
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
