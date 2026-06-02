import { describe, expect, test } from "bun:test";
import { MAX_INGEST_BYTES, POST } from "./route";

// Route-level regression for /code-review finding #12 (size guard) and
// v0.4.18 (review-#6). The audit showed `await request.formData()`
// materialises the full multipart body into the Node heap BEFORE the
// post-parse `file.size` check fires. An attacker omitting
// Content-Length or using Transfer-Encoding: chunked bypassed the cheap
// check. Fix: Content-Length is now mandatory (411 on absent /
// non-numeric / negative), and the cheap-check ceiling allows a small
// envelope-overhead margin (64 KiB) so legitimate uploads at the
// boundary aren't falsely rejected.

// Conservative ceiling above which the cheap check fires. Matches the
// MULTIPART_ENVELOPE_OVERHEAD constant in route.ts.
const CHEAP_CHECK_CEILING = MAX_INGEST_BYTES + 64 * 1024;

function buildIngestRequest(file: File, contentLengthOverride?: string): Request {
  const form = new FormData();
  form.append("file", file);
  const headers: Record<string, string> = {};
  if (contentLengthOverride !== undefined) {
    headers["content-length"] = contentLengthOverride;
  }
  return new Request("http://strand.local/api/ingest/linkedin", {
    method: "POST",
    body: form,
    headers,
  });
}

describe("/api/ingest/linkedin — size guard (finding #12 + review-#6)", () => {
  test("rejects 413 when content-length declares > MAX_INGEST_BYTES + envelope overhead (fail-fast)", async () => {
    const tiny = new File([new Uint8Array(8)], "tiny.zip", { type: "application/zip" });
    const declared = String(CHEAP_CHECK_CEILING + 1);
    const res = await POST(buildIngestRequest(tiny, declared));
    expect(res.status).toBe(413);
    const body = await res.json() as { error: string; maxBytes: number; gotBytes: number };
    expect(body.error).toBe("upload_too_large");
    expect(body.maxBytes).toBe(MAX_INGEST_BYTES);
    expect(body.gotBytes).toBe(CHEAP_CHECK_CEILING + 1);
  });

  test("v0.4.18: rejects 411 when Content-Length is non-numeric (closes formData heap-bypass)", async () => {
    const tiny = new File([new Uint8Array(8)], "tiny.zip", { type: "application/zip" });
    const res = await POST(buildIngestRequest(tiny, "not-a-number"));
    expect(res.status).toBe(411);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("content_length_required");
  });

  test("v0.4.18: rejects 411 when Content-Length is negative", async () => {
    const tiny = new File([new Uint8Array(8)], "tiny.zip", { type: "application/zip" });
    const res = await POST(buildIngestRequest(tiny, "-1"));
    expect(res.status).toBe(411);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("content_length_required");
  });

  test("rejects 413 when File.size exceeds the limit (post-parse, pre-arrayBuffer)", async () => {
    // Allocate just past the limit so the file.size branch fires. ~50MB +
    // 1 byte; the test process owns it for one assertion and releases it.
    // Declare content-length at the cheap-check ceiling so the lie-detector
    // doesn't fire first — we want the post-parse file.size branch.
    const oversize = new Uint8Array(MAX_INGEST_BYTES + 1);
    const file = new File([oversize], "huge.zip", { type: "application/zip" });
    const res = await POST(buildIngestRequest(file, String(CHEAP_CHECK_CEILING)));
    expect(res.status).toBe(413);
    const body = await res.json() as { error: string; maxBytes: number; gotBytes: number };
    expect(body.error).toBe("upload_too_large");
    expect(body.gotBytes).toBe(MAX_INGEST_BYTES + 1);
  }, 30_000);

  test("missing file in multipart still returns the existing 400 (no size-check regression on the empty path)", async () => {
    const form = new FormData();
    const req = new Request("http://strand.local/api/ingest/linkedin", {
      method: "POST",
      body: form,
      headers: { "content-length": "200" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("multipart/form-data");
  });

  test("non-multipart body returns the existing 400 (size guard does not swallow malformed input)", async () => {
    const json = JSON.stringify({ not: "form-data" });
    const req = new Request("http://strand.local/api/ingest/linkedin", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(json.length),
      },
      body: json,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("MAX_INGEST_BYTES is exactly 50 MiB (50 * 1024 * 1024 — guard against accidental constant drift)", () => {
    expect(MAX_INGEST_BYTES).toBe(50 * 1024 * 1024);
  });
});
