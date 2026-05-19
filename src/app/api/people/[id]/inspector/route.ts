import { NextResponse } from "next/server";
import { getPersonInspector } from "@/lib/queries/personInspector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const data = await getPersonInspector(params.id);
  if (!data) {
    return NextResponse.json({ error: "person not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}
