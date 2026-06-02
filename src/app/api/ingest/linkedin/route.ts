import { NextResponse } from "next/server";
import { ingestLinkedInExport } from "@/lib/linkedin/ingest";

export const runtime = "nodejs";
// LinkedIn export is small (≤ a few MB). Don't cache, don't pre-render.
export const dynamic = "force-dynamic";

// Upper bound on an ingestable upload. Real LinkedIn exports are a few MB at
// most (Matt's is ~600 KB; the largest connection lists hit single-digit MB).
// 50 MB leaves comfortable headroom while preventing a multi-GB body from
// being materialised into the Node heap by `file.arrayBuffer()`.
export const MAX_INGEST_BYTES = 50 * 1024 * 1024;

function tooLargeResponse(byteLen: number) {
  return NextResponse.json(
    { error: "upload_too_large", maxBytes: MAX_INGEST_BYTES, gotBytes: byteLen },
    { status: 413 },
  );
}

export async function POST(request: Request): Promise<Response> {
  // Cheap fail-fast: if the client declared a content-length over the limit,
  // reject before parsing the body. Treat absent / non-numeric headers as
  // "unknown" and fall through to the post-parse check.
  const declaredLen = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(declaredLen) && declaredLen > MAX_INGEST_BYTES) {
    return tooLargeResponse(declaredLen);
  }

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

  // Defence in depth — content-length may be missing, lied about, or
  // a chunked-encoding upload. The File's own .size is authoritative for
  // the part we're about to read into memory. Reject BEFORE arrayBuffer()
  // so a multi-GB part never materialises in heap.
  if (file.size > MAX_INGEST_BYTES) {
    return tooLargeResponse(file.size);
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
