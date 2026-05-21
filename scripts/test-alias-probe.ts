#!/usr/bin/env bun
// v0.3.3 (ISC-333): self-test for the ISC-301 extended alias-import regex.
//
// Three violating fixtures + three benign fixtures. The probe regex should
// match exactly 3 lines. If it matches a different number, the regex is
// broken — fail loudly so a future refactor doesn't silently weaken the
// isolation gate.

// The extended ISC-301 pattern (kept in sync with scripts/check-isolation.ts).
// We test it in JS regex form, mirroring what grep -E would do.
const PATTERN = new RegExp(
  [
    // ORM-symbol clauses
    "schema\\.messages",
    "from\\(messages\\)",
    "insertMessages",
    "messagesTable\\.",
    "messages_table",
    // Namespace import targeting a messages module
    "import\\s+\\*\\s+as\\s+\\w+\\s+from\\s+[\"'][^\"']*messages",
    // Aliased named import: { messages as X }
    "\\bmessages\\s+as\\s+\\w+",
  ].join("|"),
);

type Fixture = { line: string; shouldMatch: boolean; reason: string };

const FIXTURES: Fixture[] = [
  // ── 3 violating fixtures ────────────────────────────────────────
  {
    line: 'import * as M from "@/lib/queries/messages";',
    shouldMatch: true,
    reason: "namespace import targeting messages module",
  },
  {
    line: 'import { messages as MsgTable } from "@/lib/db/schema";',
    shouldMatch: true,
    reason: "aliased named import — would bypass a `messages` text grep",
  },
  {
    line: 'const rows = await db.select().from(schema.messages);',
    shouldMatch: true,
    reason: "drizzle ORM access via schema.messages",
  },
  // ── 3 benign fixtures (must NOT match) ──────────────────────────
  {
    line: 'import type { MessageStats } from "@/lib/queries/messages";',
    shouldMatch: false,
    reason: "compile-time-only type import — explicitly allowed (ISC-341)",
  },
  {
    line: '// see messages.ts for the canonical batch helpers',
    shouldMatch: false,
    reason: "comment mentioning messages — not an executable statement",
  },
  {
    line: 'const totalMessages = candidates.reduce((acc, c) => acc + c.messages.total, 0);',
    shouldMatch: false,
    reason: "field access on a candidate's `messages` property — not a table reference",
  },
];

let actualMatches = 0;
const surprises: { fixture: Fixture; matched: boolean }[] = [];

for (const f of FIXTURES) {
  const matched = PATTERN.test(f.line);
  if (matched) actualMatches++;
  if (matched !== f.shouldMatch) {
    surprises.push({ fixture: f, matched });
  }
  const symbol = matched === f.shouldMatch ? "✓" : "✗";
  const verdict = matched ? "MATCH" : "no-match";
  console.log(`${symbol}  ${verdict.padEnd(8)} ${f.line}`);
  if (matched !== f.shouldMatch) {
    console.log(`     expected ${f.shouldMatch ? "MATCH" : "no-match"} — ${f.reason}`);
  }
}

console.log(`\nexpected 3 hits / got ${actualMatches}`);
if (surprises.length > 0) {
  console.error(`\n${surprises.length} fixture(s) produced unexpected verdict — regex is broken`);
  process.exit(1);
}
console.log("alias-probe regex self-test PASSED");
process.exit(0);
