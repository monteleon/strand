import { NextResponse } from "next/server";
import { deleteSavedQuery } from "@/lib/queries/savedQueries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const result = await deleteSavedQuery(params.id);
  if (!result.deleted) {
    return NextResponse.json({ error: "bookmark not found" }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
