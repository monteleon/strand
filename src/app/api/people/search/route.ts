import { NextResponse } from "next/server";
import { searchPeople } from "@/lib/queries/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const exclude = searchParams.get("exclude") ?? undefined;
  if (q.length < 2) {
    return NextResponse.json({ results: [] }, { status: 200 });
  }
  const results = await searchPeople(q, 8);
  const filtered = exclude
    ? results.filter((r) => r.id !== exclude)
    : results;
  return NextResponse.json({ results: filtered }, { status: 200 });
}
