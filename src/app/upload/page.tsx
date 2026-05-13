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
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <header className="border-b border-border pb-8">
        <h1 className="text-3xl font-semibold tracking-tight">
          Import LinkedIn export
        </h1>
        <p className="mt-3 text-base text-muted-foreground">
          Drop your LinkedIn data export .zip below. Nothing leaves this
          machine.
        </p>
      </header>

      <section className="mt-10">
        <div
          data-testid="upload-dropzone"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center justify-center rounded-md border-2 border-dashed px-8 py-16 text-center transition",
            dragging
              ? "border-foreground bg-muted/40"
              : "border-border bg-muted/10",
            busy && "opacity-60 pointer-events-none",
          )}
        >
          <p className="text-base font-medium">
            Drop your LinkedIn .zip here
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Or pick a file:{" "}
            <label className="cursor-pointer font-medium text-foreground underline underline-offset-4">
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
            <p className="mt-6 text-sm text-muted-foreground">
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
            className="mt-8 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
          >
            <p className="font-medium text-destructive">
              Import failed: {result.filename}
            </p>
            <p className="mt-1 text-muted-foreground">{result.message}</p>
          </div>
        )}
      </section>

      <footer className="mt-16 border-t border-border pt-6 text-xs text-muted-foreground">
        <p>
          Re-uploading the same export is a no-op — Strand recognises identical
          files by their SHA-256.
        </p>
      </footer>
    </main>
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
        "mt-8 rounded-md border px-4 py-4",
        tone === "success"
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-muted-foreground/30 bg-muted/30",
      )}
    >
      <p className="text-sm font-medium">{heading}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
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
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-lg font-medium tabular-nums">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
