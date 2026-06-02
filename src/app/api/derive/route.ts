import { NextResponse } from "next/server";
import {
  countDerivedEdges,
  deriveSharedEmployerEdges,
  isDeriveInFlight,
  runDeriveSerialized,
} from "@/lib/derived/edges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The single-flight lock lives in @/lib/derived/edges so the implicit derive
// at the end of ingest (src/lib/linkedin/ingest.ts) goes through the same
// gate. The route's job is just to (a) reject fail-fast with 409 if the
// lock is already held — protecting against UI retry storms — and (b) wrap
// the derive in JSON error reporting so a throw never becomes Next's
// default HTML 500 page.
export async function POST() {
  if (isDeriveInFlight()) {
    return NextResponse.json({ error: "derive_in_progress" }, { status: 409 });
  }
  try {
    const { result, byKindInDb } = await runDeriveSerialized(async () => {
      const result = await deriveSharedEmployerEdges();
      const byKindInDb = await countDerivedEdges();
      return { result, byKindInDb };
    });
    return NextResponse.json({ ...result, byKindInDb }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "derive_failed", detail: message },
      { status: 500 },
    );
  }
}
