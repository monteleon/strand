import { NextResponse } from "next/server";
import { deriveSharedEmployerEdges, countDerivedEdges } from "@/lib/derived/edges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Single-flight gate. deriveSharedEmployerEdges holds the SQLite writer for
// the duration of the pass (clear-then-rebuild of derived_edges across the
// tenant). The route had no concurrency control: a loop of POSTs — a stale
// tab retrying, a same-origin CSRF, an accidental for-loop in the terminal
// — would queue N full re-derives behind the writer, starving every UI
// fetch until they drained. The fix is to admit one derive at a time and
// reject the rest with 409. The in-flight Promise is module-level so it
// survives across requests within a single Node process; on restart it
// resets, which is fine — there's no derive across processes to coordinate.
let inFlight: Promise<{
  result: Awaited<ReturnType<typeof deriveSharedEmployerEdges>>;
  byKindInDb: Awaited<ReturnType<typeof countDerivedEdges>>;
}> | null = null;

export async function POST() {
  if (inFlight) {
    return NextResponse.json(
      { error: "derive_in_progress" },
      { status: 409 },
    );
  }
  inFlight = (async () => {
    const result = await deriveSharedEmployerEdges();
    const byKindInDb = await countDerivedEdges();
    return { result, byKindInDb };
  })();
  try {
    const { result, byKindInDb } = await inFlight;
    return NextResponse.json({ ...result, byKindInDb }, { status: 200 });
  } finally {
    inFlight = null;
  }
}
