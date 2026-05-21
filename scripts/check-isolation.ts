#!/usr/bin/env bun
// v0.3.3 (ISC-342, ISC-343, ISC-347): single-command runner for the three
// isolation probes that enforce the messages epistemic-category boundary.
//
// Three layers of enforcement (each necessary but not sufficient on its own):
//   ISC-265 — JS-import grep: manualEdges.ts + derivedEdges.ts must not import
//             from @/lib/queries/messages
//   ISC-289 — SQL-keyword grep: only messages.ts + ingest.ts may write raw
//             SQL referencing the `messages` table (FROM/JOIN/INTO/UPDATE)
//   ISC-301 — ORM-symbol grep (v0.3.2 + v0.3.3): only the whitelist may
//             reference schema.messages, from(messages), insertMessages,
//             messagesTable.*, messages_table, OR alias-import the
//             messages query module
//
// Non-goals (Advisor v0.3.2 conjectures #9, #10 — documented but not enforced
// at the regex level):
//   - Dynamic imports (`await import("...")`) and require() calls bypass the
//     static text probes. An AST-based probe is the future option if a
//     violation surfaces.
//   - `import type { … } from "@/lib/queries/messages"` is compile-time-only
//     and is ALLOWED from any module — the probes match the bare `import { …
//     }` form, not the type-only form.
//
// Tagged-template SQL precedence (ISC-339): `db.all(sql\`SELECT ... FROM
// messages\`)` outside the whitelist trips ISC-289 first (SQL-keyword match
// on the template-literal content). ISC-301's ORM probe ALSO matches because
// the bare identifier `messages` appears. Either trip is sufficient; both is
// belt-and-braces.
import { spawnSync } from "node:child_process";
import { cwd } from "node:process";

// We use GNU grep instead of ripgrep — rg is not always on PATH (notably
// inside the Bun child-process env on this WSL host where rg is a shell
// function wrapping the claude binary). grep is universal.
type Probe = {
  isc: string;
  description: string;
  args: string[];
};

// Exclusions reused across the recursive probes — the same whitelist shape
// as ISC-265 / ISC-289 / ISC-301: only the messages query module + ingest
// pipeline + db schema + scripts + tests may legitimately reference the
// messages table / module.
const RECURSIVE_EXCLUDES = [
  "--exclude=messages.ts",
  "--exclude=messages.test.ts",
  "--exclude=ingest.ts",
  "--exclude-dir=db",
  "--exclude-dir=scripts",
  "--exclude=*.test.ts",
];

const PROBES: Probe[] = [
  {
    isc: "ISC-265",
    description: "JS-import isolation — manualEdges + derivedEdges must not import messages",
    args: [
      "-nE",
      'from "@/lib/queries/messages"',
      "src/lib/queries/manualEdges.ts",
      "src/lib/queries/derivedEdges.ts",
    ],
  },
  {
    isc: "ISC-289",
    description: "SQL-keyword isolation — only messages.ts + ingest.ts may FROM/JOIN/INTO/UPDATE messages",
    args: [
      "-rnE",
      "(FROM|JOIN|INTO|UPDATE)[[:space:]]+messages\\b",
      "src/",
      ...RECURSIVE_EXCLUDES,
    ],
  },
  {
    isc: "ISC-301 (extended v0.3.3)",
    description:
      "ORM-symbol + alias-import isolation — drizzle access + alias/namespace imports",
    // (a) schema.messages / from(messages) / insertMessages / messagesTable. / messages_table
    // (b) import * as <name> from "...messages..."  (namespace import)
    // (c) import { messages as <alias> }            (aliased named import)
    args: [
      "-rnE",
      'schema\\.messages|from\\(messages\\)|insertMessages|messagesTable\\.|messages_table|import[[:space:]]+\\*[[:space:]]+as[[:space:]]+[A-Za-z0-9_]+[[:space:]]+from[[:space:]]+["\x27][^"\x27]*messages|\\bmessages[[:space:]]+as[[:space:]]+[A-Za-z0-9_]+',
      "src/",
      ...RECURSIVE_EXCLUDES,
    ],
  },
];

let totalViolations = 0;
const violations: { isc: string; hits: string[] }[] = [];

for (const probe of PROBES) {
  const result = spawnSync("grep", probe.args, {
    cwd: cwd(),
    encoding: "utf8",
  });
  // grep exits: 0 = matches found, 1 = clean (no matches), 2 = error
  if (result.status === 2 || result.error) {
    console.error(
      `error running probe ${probe.isc}: ${result.error ?? result.stderr}`,
    );
    process.exit(2);
  }
  const hits = (result.stdout ?? "")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (hits.length > 0) {
    totalViolations += hits.length;
    violations.push({ isc: probe.isc, hits });
    console.log(`✗ ${probe.isc} — ${hits.length} violation(s)`);
    for (const h of hits.slice(0, 10)) console.log(`    ${h}`);
    if (hits.length > 10) console.log(`    … and ${hits.length - 10} more`);
  } else {
    console.log(`✓ ${probe.isc} — clean`);
  }
}

const summary = totalViolations === 0
  ? `\n3/3 clean — three-layer messages-category isolation holds`
  : `\n${PROBES.length - violations.length}/${PROBES.length} clean — ${totalViolations} total violation(s) across ${violations.length} probe(s)`;
console.log(summary);
process.exit(totalViolations === 0 ? 0 : 1);
