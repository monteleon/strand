import { describe, expect, test } from "bun:test";
import { MAX_INGEST_BYTES, POST } from "./route";

// Route-level regression for /code-review finding #12. The ingest POST used
// to call `Buffer.from(await file.arrayBuffer())` with no size check, so a
// multi-GB body would materialise in heap and OOM the dev server / WSL host
// before any sha256 / parse / ingest logic ran. Now the route fails fast at
// two layers: declared content-length and the parsed File's actual .size.

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

describe("/api/ingest/linkedin — size guard (finding #12)", () => {
  test("rejects 413 when content-length declares > MAX_INGEST_BYTES (fail-fast, no body read)", async () => {
    const tiny = new File([new Uint8Array(8)], "tiny.zip", { type: "application/zip" });
    const declared = String(MAX_INGEST_BYTES + 1);
    const res = await POST(buildIngestRequest(tiny, declared));
    expect(res.status).toBe(413);
    const body = await res.json() as { error: string; maxBytes: number; gotBytes: number };
    expect(body.error).toBe("upload_too_large");
    expect(body.maxBytes).toBe(MAX_INGEST_BYTES);
    expect(body.gotBytes).toBe(MAX_INGEST_BYTES + 1);
  });

  test("rejects 413 when File.size exceeds the limit (post-parse, pre-arrayBuffer)", async () => {
    // Allocate just past the limit so the file.size branch fires. ~50MB +
    // 1 byte; the test process owns it for one assertion and releases it.
    const oversize = new Uint8Array(MAX_INGEST_BYTES + 1);
    const file = new File([oversize], "huge.zip", { type: "application/zip" });
    const res = await POST(buildIngestRequest(file));
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
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("multipart/form-data");
  });

  test("non-multipart body returns the existing 400 (size guard does not swallow malformed input)", async () => {
    const req = new Request("http://strand.local/api/ingest/linkedin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ not: "form-data" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("MAX_INGEST_BYTES is exactly 50 MiB (50 * 1024 * 1024 — guard against accidental constant drift)", () => {
    expect(MAX_INGEST_BYTES).toBe(50 * 1024 * 1024);
  });
});
