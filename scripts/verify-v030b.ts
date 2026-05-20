// v0.3.0-B verify: messages section on /people/[id] + last-contact column +
// sort=last_contact toggle on /people. Same shape as verify-w6.ts.
import { firefox } from "playwright";
import { mkdirSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const ROOT = "http://localhost:3000";
const OUT_DIR = "/tmp/strand-verify-v030b";
mkdirSync(OUT_DIR, { recursive: true });

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];

// Find the top-messaged contact directly from the DB so the probe is
// data-aware. This is the same query the test file uses.
async function topContact(): Promise<{ id: string; total: number; name: string }> {
  const [row] = await db.all<{ other_id: string; total: number }>(sql`
    SELECT
      CASE WHEN direction = 'sent' THEN to_person_id ELSE from_person_id END AS other_id,
      COUNT(*) AS total
    FROM messages
    WHERE tenant_id = 'local'
    GROUP BY other_id
    ORDER BY total DESC
    LIMIT 1
  `);
  if (!row) throw new Error("no messages in db — re-ingest first");
  const [p] = await db.all<{ full_name: string }>(sql`
    SELECT full_name FROM people WHERE id = ${row.other_id}
  `);
  return {
    id: row.other_id,
    total: Number(row.total),
    name: p?.full_name ?? "(unknown)",
  };
}

const top = await topContact();
console.log(`Top messaged contact: ${top.name} (${top.total} messages)`);

const browser = await firefox.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const pageErrors: string[] = [];
const network: { url: string }[] = [];
page.on("pageerror", (err) => pageErrors.push(err.message));
page.on("request", (req) => network.push({ url: req.url() }));

// ── /people/[id] of top contact ────────────────────────────────────────
const detailUrl = `${ROOT}/people/${top.id}`;
const resp = await page.goto(detailUrl, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT_DIR}/person-detail.png`, fullPage: true });

checks.push({
  name: "ISC-248 /people/[id] → 200",
  ok: resp?.status() === 200,
  detail: `status=${resp?.status()}`,
});

await page
  .waitForSelector('[data-testid="messages-section"]', { timeout: 3000 })
  .catch(() => null);

const sectionCount = await page
  .locator('[data-testid="messages-section"]')
  .count();
checks.push({
  name: "ISC-248 messages-section present",
  ok: sectionCount === 1,
  detail: `count=${sectionCount}`,
});

const statsCount = await page.locator('[data-testid="messages-stats"]').count();
checks.push({
  name: "ISC-249 messages-stats present",
  ok: statsCount === 1,
  detail: `count=${statsCount}`,
});

const sentText = (
  await page.locator('[data-stat="sent"]').textContent()
)?.trim() ?? "";
const receivedText = (
  await page.locator('[data-stat="received"]').textContent()
)?.trim() ?? "";
const lastContactText = (
  await page.locator('[data-stat="last-contact"]').textContent()
)?.trim() ?? "";
const sentN = Number(sentText);
const receivedN = Number(receivedText);
checks.push({
  name: "ISC-249 stats show non-zero sent + received",
  ok: sentN > 0 && receivedN > 0 && sentN + receivedN === top.total,
  detail: `sent=${sentN} received=${receivedN} total=${top.total}`,
});
checks.push({
  name: "ISC-249 last-contact shows YYYY-MM-DD date",
  ok: /^\d{4}-\d{2}-\d{2}$/.test(lastContactText),
  detail: `last-contact="${lastContactText}"`,
});

const threadRowCount = await page
  .locator('[data-testid="messages-thread-row"]')
  .count();
checks.push({
  name: "ISC-251 thread has ≥1 row",
  ok: threadRowCount > 0,
  detail: `rows=${threadRowCount}`,
});

const sentRowCount = await page
  .locator('[data-testid="messages-thread-row"][data-direction="sent"]')
  .count();
const receivedRowCount = await page
  .locator('[data-testid="messages-thread-row"][data-direction="received"]')
  .count();
checks.push({
  name: "ISC-252 both sent and received directions render in thread",
  ok: sentRowCount > 0 && receivedRowCount > 0,
  detail: `sent_rows=${sentRowCount} received_rows=${receivedRowCount}`,
});

// ── /people empty-state (different person, no messages) ────────────────
// Pick a person known to have 0 messages: any synthesised position connection
// that isn't in the top-N. Easiest: get a person from /people page where
// listLastContactByPeople returned no entry.
const [nilPerson] = await db.all<{ id: string; full_name: string }>(sql`
  SELECT p.id, p.full_name
  FROM people p
  LEFT JOIN messages m
    ON m.tenant_id = p.tenant_id
    AND (
      (m.direction = 'sent' AND m.to_person_id = p.id) OR
      (m.direction = 'received' AND m.from_person_id = p.id)
    )
  WHERE p.tenant_id = 'local'
    AND p.id != (SELECT owner_person_id FROM tenants WHERE id = 'local')
    AND m.id IS NULL
  LIMIT 1
`);

if (nilPerson) {
  await page.goto(`${ROOT}/people/${nilPerson.id}`, {
    waitUntil: "networkidle",
  });
  const emptyCount = await page
    .locator('[data-testid="messages-empty"]')
    .count();
  checks.push({
    name: "ISC-250 empty state renders for person with 0 messages",
    ok: emptyCount === 1,
    detail: `person="${nilPerson.full_name}" empty_count=${emptyCount}`,
  });
  // ISC-267: stats row STILL renders in the zero state — "we checked,
  // there were none" must remain visually distinguishable from "this view
  // doesn't track messages". (Advisor 2026-05-20)
  const zeroStatsCount = await page
    .locator('[data-testid="messages-stats"]')
    .count();
  const zeroSent = (
    await page.locator('[data-stat="sent"]').textContent()
  )?.trim();
  const zeroReceived = (
    await page.locator('[data-stat="received"]').textContent()
  )?.trim();
  const zeroLast = (
    await page.locator('[data-stat="last-contact"]').textContent()
  )?.trim();
  checks.push({
    name: "ISC-267 zero-state stats row still renders (sent=0, received=0, last=—)",
    ok:
      zeroStatsCount === 1 &&
      zeroSent === "0" &&
      zeroReceived === "0" &&
      zeroLast === "—",
    detail: `stats=${zeroStatsCount} sent="${zeroSent}" received="${zeroReceived}" last="${zeroLast}"`,
  });
} else {
  checks.push({
    name: "ISC-250 empty state",
    ok: false,
    detail: "no person with 0 messages found in dataset — skipping",
  });
}

// ── /people list with default sort ─────────────────────────────────────
await page.goto(`${ROOT}/people`, { waitUntil: "networkidle" });
const lastContactCellsDefault = await page
  .locator('[data-testid="people-last-contact"]')
  .count();
checks.push({
  name: "ISC-254 /people default renders some last-contact cells",
  ok: lastContactCellsDefault > 0,
  detail: `${lastContactCellsDefault} cells on page 1`,
});

const sortNavCount = await page.locator('[data-testid="people-sort"]').count();
checks.push({
  name: "ISC-255 /people sort nav present",
  ok: sortNavCount === 1,
  detail: `count=${sortNavCount}`,
});

// ── /people?sort=last_contact ──────────────────────────────────────────
await page.goto(`${ROOT}/people?sort=last_contact`, {
  waitUntil: "networkidle",
});
await page.screenshot({
  path: `${OUT_DIR}/people-sort-last-contact.png`,
  fullPage: true,
});
const lastContactCellsSorted = await page
  .locator('[data-testid="people-last-contact"]')
  .count();
checks.push({
  name: "ISC-255 sort=last_contact page 1 has last-contact cells",
  ok: lastContactCellsSorted >= 10,
  detail: `${lastContactCellsSorted} cells (expected ≥10 — top of sort is well-populated)`,
});

const activeChip = await page
  .locator('[data-testid="people-sort"] [data-active="true"]')
  .textContent();
checks.push({
  name: "ISC-255 active sort chip = 'Last contact'",
  ok: (activeChip ?? "").trim() === "Last contact",
  detail: `active="${activeChip?.trim()}"`,
});

// Probe the top row's date — should be the most recent message in dataset.
const topRowDateText = await page
  .locator('[data-testid="people-list"] [data-testid="people-last-contact"]')
  .first()
  .textContent();
checks.push({
  name: "ISC-255 sort=last_contact: top row carries a recent YYYY-MM-DD date",
  ok: /\d{4}-\d{2}-\d{2}/.test(topRowDateText ?? ""),
  detail: `top_row_date="${topRowDateText?.trim()}"`,
});

// ── /people?sort=garbage ───────────────────────────────────────────────
const badResp = await page.goto(`${ROOT}/people?sort=garbage`, {
  waitUntil: "networkidle",
});
checks.push({
  name: "ISC-257 unknown sort value returns 200 (fallback to default)",
  ok: badResp?.status() === 200,
  detail: `status=${badResp?.status()}`,
});

// ── ISC-264: zero pageerror across all visits ──────────────────────────
checks.push({
  name: "ISC-264 zero pageerror across all visited routes (no hydration mismatch)",
  ok: pageErrors.length === 0,
  detail: pageErrors.join("; "),
});

// ── ISC-262: zero non-localhost requests ───────────────────────────────
const nonLocal = network.filter(
  (r) =>
    !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(r.url) &&
    !r.url.startsWith("data:") &&
    !r.url.startsWith("about:") &&
    !r.url.startsWith("blob:"),
);
checks.push({
  name: "ISC-262 zero non-localhost requests",
  ok: nonLocal.length === 0,
  detail: `${nonLocal.length} non-local${nonLocal.length > 0 ? ` — ${nonLocal.slice(0, 3).map((r) => r.url).join(", ")}` : ""}`,
});

await browser.close();

const passed = checks.filter((c) => c.ok).length;
const failed = checks.filter((c) => !c.ok);
console.log(`\nVERIFY-V0.3.0-B RESULTS: ${passed}/${checks.length} passed`);
for (const c of checks) {
  console.log(`  ${c.ok ? "✓" : "✗"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}
if (failed.length > 0) {
  console.error(`\nFAILED:\n${failed.map((c) => `  ${c.name}: ${c.detail}`).join("\n")}`);
  process.exit(1);
}
console.log(`screenshots in ${OUT_DIR}/`);
