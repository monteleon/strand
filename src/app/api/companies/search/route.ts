// v0.4.0 (ISC-377): typeahead search endpoint for the CompanyPicker on
// /graph. Mirrors /api/people/search — same q + limit gate, same empty-for-
// short-query posture, same JSON shape.
import { NextResponse } from "next/server";
import { searchCompanies } from "@/lib/queries/companies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [] }, { status: 200 });
  }
  const results = await searchCompanies(q, 8);
  return NextResponse.json({ results }, { status: 200 });
}
