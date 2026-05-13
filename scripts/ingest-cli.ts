import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { ingestLinkedInExport } from "@/lib/linkedin/ingest";

const path = process.argv[2];
if (!path) {
  console.error("usage: bun run scripts/ingest-cli.ts <path-to-export.zip>");
  process.exit(1);
}

const bytes = await readFile(path);
const result = await ingestLinkedInExport(bytes, basename(path));
console.log(JSON.stringify(result, null, 2));
