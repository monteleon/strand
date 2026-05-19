"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type Counts = {
  people: number;
  companies: number;
  positions: number;
  connections: number;
};

type Result =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string }
  | { kind: "success"; filename: string; batchId: string; counts: Counts }
  | {
      kind: "duplicate";
      filename: string;
      existingBatchId: string;
      counts: Counts;
    }
  | { kind: "error"; filename: string; message: string };

export default function UploadPage() {
  const [result, setResult] = useState<Result>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);

  async function upload(file: File) {
    setResult({ kind: "uploading", filename: file.name });
    const body = new FormData();
    body.append("file", file);
    let res: Response;
    try {
      res = await fetch("/api/ingest/linkedin", { method: "POST", body });
    } catch (err) {
      setResult({
        kind: "error",
        filename: file.name,
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      setResult({
        kind: "error",
        filename: file.name,
        message: `unexpected non-JSON response (${res.status})`,
      });
      return;
    }
    if (res.status === 200) {
      const data = json as { batch_id: string; counts: Counts };
      setResult({
        kind: "success",
        filename: file.name,
        batchId: data.batch_id,
        counts: data.counts,
      });
      return;
    }
    if (res.status === 409) {
      const data = json as {
        existing_batch_id: string;
        counts: Counts;
      };
      setResult({
        kind: "duplicate",
        filename: file.name,
        existingBatchId: data.existing_batch_id,
        counts: data.counts,
      });
      return;
    }
    const errData = json as { error?: string; detail?: string };
    setResult({
      kind: "error",
      filename: file.name,
      message: errData.detail ?? errData.error ?? `HTTP ${res.status}`,
    });
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) upload(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload(file);
  }

  const busy = result.kind === "uploading";

  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <div className="mx-auto max-w-3xl px-8 py-12">
        <header className="border-b border-border-subtle pb-6">
          <p className="font-mono text-[11px] uppercase tracking-wide text-text-tertiary">
            Upload
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
            Import LinkedIn export
          </h1>
          <p className="mt-3 text-base text-text-secondary">
            Drop your LinkedIn data export .zip below. Nothing leaves this
            machine.
          </p>
        </header>

        <section className="mt-8">
          <div
            data-testid="upload-dropzone"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex flex-col items-center justify-center rounded-md border-2 border-dashed px-8 py-16 text-center transition-colors duration-base ease-cubic-out",
              dragging
                ? "border-accent-signal bg-accent-signal/5"
                : "border-border-subtle bg-surface",
              busy && "pointer-events-none opacity-60",
            )}
          >
            <p className="font-display text-lg font-medium text-text-primary">
              Drop your LinkedIn .zip here
            </p>
            <p className="mt-2 text-sm text-text-secondary">
              Or pick a file:{" "}
              <label className="cursor-pointer font-medium text-accent-signal underline decoration-accent-signal/40 underline-offset-4 transition-colors duration-fast ease-cubic-out hover:decoration-accent-signal">
                browse
                <input
                  type="file"
                  accept=".zip,application/zip"
                  onChange={onFileChange}
                  className="sr-only"
                  disabled={busy}
                />
              </label>
            </p>
            {busy && (
              <p className="mt-6 font-mono text-sm text-text-secondary">
                Ingesting {result.filename}…
              </p>
            )}
          </div>

          {result.kind === "success" && (
            <ResultPanel
              heading={`Imported ${result.filename}`}
              tone="success"
              note={`batch ${result.batchId.slice(0, 8)}…`}
              counts={result.counts}
            />
          )}

          {result.kind === "duplicate" && (
            <ResultPanel
              heading={`Already imported (${result.filename})`}
              tone="info"
              note={`existing batch ${result.existingBatchId.slice(0, 8)}…`}
              counts={result.counts}
            />
          )}

          {result.kind === "error" && (
            <div
              role="alert"
              className="mt-6 rounded-md border border-accent-warmth/40 bg-accent-warmth/5 px-4 py-3 text-sm"
            >
              <p className="font-medium text-accent-warmth">
                Import failed: {result.filename}
              </p>
              <p className="mt-1 text-text-secondary">{result.message}</p>
            </div>
          )}
        </section>

        <footer className="mt-10 border-t border-border-subtle pt-4">
          <p className="font-mono text-xs text-text-tertiary">
            Re-uploading the same export is a no-op — Strand recognises
            identical files by their SHA-256.
          </p>
        </footer>
      </div>
    </div>
  );
}

function ResultPanel({
  heading,
  tone,
  note,
  counts,
}: {
  heading: string;
  tone: "success" | "info";
  note: string;
  counts: Counts;
}) {
  return (
    <div
      data-testid={`result-${tone}`}
      className={cn(
        "mt-6 rounded-md border px-4 py-4",
        tone === "success"
          ? "border-accent-signal/40 bg-accent-signal/5"
          : "border-border-subtle bg-surface",
      )}
    >
      <p className="font-medium text-text-primary">{heading}</p>
      <p className="mt-1 font-mono text-xs text-text-tertiary">{note}</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <CountItem label="People" value={counts.people} />
        <CountItem label="Connections" value={counts.connections} />
        <CountItem label="Companies" value={counts.companies} />
        <CountItem label="Positions" value={counts.positions} />
      </dl>
    </div>
  );
}

function CountItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-lg font-medium text-text-primary">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
