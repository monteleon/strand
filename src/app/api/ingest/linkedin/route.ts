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
// Multipart envelope overhead — Content-Disposition + Content-Type headers
// per part, the boundary delimiters between parts and the terminator, plus
// any sibling fields. 64 KiB covers realistic envelopes by a wide margin
// without giving an attacker meaningful extra body bytes. The cheap check
// compares declared content-length against MAX_INGEST_BYTES + this overhead
// so a legitimate 49 MiB file in a multipart envelope is not falsely
// rejected at the boundary (review-#6 cleanup).
const MULTIPART_ENVELOPE_OVERHEAD = 64 * 1024;

function tooLargeResponse(byteLen: number) {
  return NextResponse.json(
    { error: "upload_too_large", maxBytes: MAX_INGEST_BYTES, gotBytes: byteLen },
    { status: 413 },
  );
}

export async function POST(request: Request): Promise<Response> {
  // v0.4.18 (review-#6): content-length is mandatory. The audit found that
  // `await request.formData()` buffers the entire multipart body into
  // memory (Next 14 uses undici, which materialises every part into an
  // in-memory Blob) — so an attacker who omits content-length or uses
  // Transfer-Encoding: chunked bypasses the pre-parse cheap check and
  // can OOM the worker before the post-parse `file.size` guard fires.
  // Rejecting absent / non-numeric Content-Length closes that bypass:
  // every legitimate client (browsers via fetch / XHR, curl --form, node
  // fetch) sets the header for a multipart POST. The cheap check then
  // becomes authoritative for body-size fail-fast.
  const declaredHeader = request.headers.get("content-length");
  const declaredLen = Number.parseInt(declaredHeader ?? "", 10);
  if (!declaredHeader || !Number.isFinite(declaredLen) || declaredLen < 0) {
    return NextResponse.json(
      { error: "content_length_required" },
      { status: 411 },
    );
  }
  if (declaredLen > MAX_INGEST_BYTES + MULTIPART_ENVELOPE_OVERHEAD) {
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

  // Defence in depth — content-length is now mandatory but a client may
  // still lie (declare 1 KB, send 1 MB; undici will truncate or error).
  // The File's own .size is authoritative for the bytes we're about to
  // read into memory.
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
