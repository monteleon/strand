import { NextResponse } from "next/server";
import { ingestLinkedInExport } from "@/lib/linkedin/ingest";

export const runtime = "nodejs";
// LinkedIn export is small (≤ a few MB). Don't cache, don't pre-render.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart/form-data with a `file` field" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "expected multipart/form-data with a `file` field" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let result;
  try {
    result = await ingestLinkedInExport(buffer, file.name);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("missing from export")) {
      return NextResponse.json(
        { error: "linkedin_export_missing_files", detail: message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "ingest_failed", detail: message },
      { status: 500 },
    );
  }

  if (result.duplicate) {
    return NextResponse.json(
      {
        reason: "duplicate_export",
        existing_batch_id: result.batchId,
        counts: result.counts,
      },
      { status: 409 },
    );
  }

  return NextResponse.json(
    { batch_id: result.batchId, counts: result.counts },
    { status: 200 },
  );
}
