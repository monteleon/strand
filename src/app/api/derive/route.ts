import { NextResponse } from "next/server";
import { deriveSharedEmployerEdges, countDerivedEdges } from "@/lib/derived/edges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const result = await deriveSharedEmployerEdges();
  const byKindInDb = await countDerivedEdges();
  return NextResponse.json({ ...result, byKindInDb }, { status: 200 });
}
