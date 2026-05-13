// W5a verification: /queries/at-company across param combinations + the
// /api/bookmarks flow (POST 201, duplicate 409, empty 400, DELETE 204+404).
// Captures screenshots to /tmp/strand-verify-w5 and exits non-zero on any
// failure.
import { firefox } from "playwright";
import { mkdirSync } from "node:fs";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const ROOT = "http://localhost:3000";
const OUT_DIR = "/tmp/strand-verify-w5";
mkdirSync(OUT_DIR, { recursive: true });

const pwc = await db.all<{ id: string }>(sql`
  SELECT id FROM companies
  WHERE tenant_id='local' AND lower(normalized_name)='pwc espana'
  LIMIT 1
`);
if (pwc.length === 0) {
  console.error("PwC España not in DB");
  process.exit(1);
}
const pwcId = pwc[0].id;

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];

const browser = await firefox.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const pageErrors: string[] = [];
const network: { route: string; url: string }[] = [];
let currentRoute = "";

page.on("pageerror", (err) => pageErrors.push(`${currentRoute}: ${err.message}`));
page.on("request", (req) => network.push({ route: currentRoute, url: req.url() }));

async function probe(
  route: string,
  fn: () => Promise<Check[]>,
): Promise<void> {
  currentRoute = route;
  const resp = await page.goto(`${ROOT}${route}`, { waitUntil: "networkidle" });
  const file = `${OUT_DIR}${route.replace(/[\/?&=%']/g, "_").slice(0, 80)}.png`;
  await page.screenshot({ path: file, fullPage: true });
  checks.push({
    name: `${route} → 200`,
    ok: resp?.status() === 200,
    detail: `status=${resp?.status()}`,
  });
  for (const c of await fn()) checks.push(c);
}

// ISC-98: picker visible with no company selected
await probe(`/queries/at-company`, async () => {
  const picker = await page.locator('[data-testid="company-picker"] li').count();
  const sidebar = await page.locator('[data-testid="saved-queries-section"]').count();
  return [
    {
      name: "ISC-98 picker shows ≤20 companies, sidebar visible",
      ok: picker > 0 && picker <= 20 && sidebar === 1,
      detail: `picker=${picker} sidebar=${sidebar}`,
    },
  ];
});

// ISC-99: ?q=pwc filters picker (case-insensitive)
await probe(`/queries/at-company?q=pwc`, async () => {
  const rows = await page.locator('[data-testid="company-picker"] li').count();
  const html = await page.content();
  return [
    {
      name: "ISC-99 ?q=pwc filter renders, mentions PwC",
      ok: rows > 0 && html.includes("PwC"),
      detail: `rows=${rows}`,
    },
  ];
});

// ISC-101: notFound for unknown company
{
  const resp = await page.goto(`${ROOT}/queries/at-company?company=NONEXISTENT_DEADBEEF`, {
    waitUntil: "domcontentloaded",
  });
  checks.push({
    name: "ISC-101 /queries/at-company?company=<bogus> → 404",
    ok: resp?.status() === 404,
    detail: `status=${resp?.status()}`,
  });
}

// ISC-100 + ISC-108 + ISC-104: company selected; default status=any → declared rows first
await probe(`/queries/at-company?company=${pwcId}`, async () => {
  const heading = await page.locator('[data-testid="at-company-name"]').textContent();
  const rows = await page.locator('[data-testid="at-company-list"] li').count();
  return [
    {
      name: "ISC-100 heading is PwC España",
      ok: (heading ?? "").includes("PwC España"),
      detail: heading ?? "(none)",
    },
    {
      name: "ISC-108 ≥20 rows on PwC España",
      ok: rows >= 20,
      detail: `${rows} rows`,
    },
  ];
});

// ISC-102: status=current
await probe(`/queries/at-company?company=${pwcId}&status=current`, async () => {
  const currentBadges = await page.locator('span:has-text("Current")').count();
  const rows = await page.locator('[data-testid="at-company-list"] li').count();
  return [
    {
      name: "ISC-102 status=current filters to current=true only",
      ok: rows > 0 && currentBadges >= rows - 1, // owner row + many connections
      detail: `${rows} rows, ${currentBadges} current badges`,
    },
  ];
});

// ISC-103: status=past — should be empty for PwC España (everybody is currently there per synthesised data)
await probe(`/queries/at-company?company=${pwcId}&status=past`, async () => {
  const rows = await page.locator('[data-testid="at-company-list"] li').count();
  const empty = await page.locator('[data-testid="empty-list"]').count();
  return [
    {
      name: "ISC-103 status=past at PwC España = 0 (all synthesised are current)",
      ok: rows === 0 && empty === 1,
      detail: `rows=${rows} empty=${empty}`,
    },
  ];
});

// ISC-106: sort=connected — page renders OK
await probe(`/queries/at-company?company=${pwcId}&sort=connected`, async () => {
  const rows = await page.locator('[data-testid="at-company-list"] li').count();
  const chipActive = await page
    .locator('[data-testid="chip-by-connection-date"][data-active="true"]')
    .count();
  return [
    {
      name: "ISC-106 sort=connected renders, chip marked active",
      ok: rows > 0 && chipActive === 1,
      detail: `rows=${rows} chipActive=${chipActive}`,
    },
  ];
});

// ISC-105: sort=name renders
await probe(`/queries/at-company?company=${pwcId}&sort=name`, async () => {
  const chipActive = await page
    .locator('[data-testid="chip-by-name"][data-active="true"]')
    .count();
  return [
    {
      name: "ISC-105 sort=name chip marked active",
      ok: chipActive === 1,
      detail: `chipActive=${chipActive}`,
    },
  ];
});

// ISC-115: SQL injection probe on ?q
{
  const url = `${ROOT}/queries/at-company?q=${encodeURIComponent("' OR 1=1 --")}`;
  const resp = await page.goto(url, { waitUntil: "domcontentloaded" });
  checks.push({
    name: "ISC-115 SQL inj on ?q → 200, no crash",
    ok: resp?.status() === 200,
    detail: `status=${resp?.status()}`,
  });
}

// --- bookmark API probes ---
const ts = Date.now();
const bmName = `verify-w5 ${ts}`;
const bmUrl = `/queries/at-company?company=${pwcId}&status=current`;

// ISC-109: POST 201
{
  const r = await fetch(`${ROOT}/api/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: bmName, url: bmUrl }),
  });
  const body = (await r.json()) as { id?: string };
  checks.push({
    name: "ISC-109 POST /api/bookmarks → 201",
    ok: r.status === 201 && typeof body.id === "string",
    detail: `status=${r.status} id=${body.id ?? "(none)"}`,
  });
  // ISC-111: duplicate → 409
  const r2 = await fetch(`${ROOT}/api/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: bmName, url: bmUrl }),
  });
  checks.push({
    name: "ISC-111 duplicate name → 409",
    ok: r2.status === 409,
    detail: `status=${r2.status}`,
  });
  // ISC-110: empty name → 400
  const r3 = await fetch(`${ROOT}/api/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "   ", url: bmUrl }),
  });
  checks.push({
    name: "ISC-110 whitespace-only name → 400",
    ok: r3.status === 400,
    detail: `status=${r3.status}`,
  });
  // ISC-115 (post-advisor): offsite URL rejected (Anti: local-first)
  const offsite = await fetch(`${ROOT}/api/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `offsite-${ts}`, url: "https://evil.com/x" }),
  });
  checks.push({
    name: "ISC-115b offsite url POST → 400 (local-first)",
    ok: offsite.status === 400,
    detail: `status=${offsite.status}`,
  });
  // Protocol-relative URL also rejected
  const protoRel = await fetch(`${ROOT}/api/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `proto-${ts}`, url: "//evil.com/x" }),
  });
  checks.push({
    name: "ISC-115c protocol-relative url POST → 400",
    ok: protoRel.status === 400,
    detail: `status=${protoRel.status}`,
  });
  // ISC-114: GET /api/bookmarks reflects the new row
  const list = await fetch(`${ROOT}/api/bookmarks`).then((r) => r.json());
  const found = list.results?.find((b: { name: string }) => b.name === bmName);
  checks.push({
    name: "ISC-114 GET /api/bookmarks returns the new bookmark",
    ok: !!found,
    detail: found ? "present" : "missing",
  });
  // ISC-112: DELETE → 204, then 404
  if (body.id) {
    const d1 = await fetch(`${ROOT}/api/bookmarks/${body.id}`, { method: "DELETE" });
    const d2 = await fetch(`${ROOT}/api/bookmarks/${body.id}`, { method: "DELETE" });
    checks.push({
      name: "ISC-112 DELETE existing → 204, DELETE again → 404",
      ok: d1.status === 204 && d2.status === 404,
      detail: `d1=${d1.status} d2=${d2.status}`,
    });
  }
}

// ISC-113: page renders SaveBookmark when company is selected
await probe(`/queries/at-company?company=${pwcId}`, async () => {
  const sb = await page.locator('[data-testid="save-bookmark"]').count();
  return [
    {
      name: "ISC-113 SaveBookmark visible on selected-company page",
      ok: sb === 1,
      detail: `count=${sb}`,
    },
  ];
});

// ISC-114 (UI side): after POST then refresh, bookmark appears in sidebar
{
  const r = await fetch(`${ROOT}/api/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `ui-${ts}`, url: bmUrl }),
  });
  const created = await r.json();
  await page.goto(`${ROOT}/queries/at-company`, { waitUntil: "networkidle" });
  const rows = await page.locator('[data-testid="saved-query-row"]').count();
  const text = await page.content();
  checks.push({
    name: "ISC-114 sidebar shows the saved bookmark after refresh",
    ok: rows >= 1 && text.includes(`ui-${ts}`),
    detail: `rows=${rows}`,
  });
  // cleanup
  if (created.id) await fetch(`${ROOT}/api/bookmarks/${created.id}`, { method: "DELETE" });
}

await browser.close();

const nonLocal = network.filter(
  (r) =>
    !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(r.url) &&
    !r.url.startsWith("data:") &&
    !r.url.startsWith("about:"),
);
checks.push({
  name: "ISC-36 (reaffirmed) zero non-localhost requests",
  ok: nonLocal.length === 0,
  detail: `${nonLocal.length} non-local hits`,
});
checks.push({
  name: "zero page errors",
  ok: pageErrors.length === 0,
  detail: pageErrors.join("; "),
});

const passed = checks.filter((c) => c.ok).length;
const failed = checks.filter((c) => !c.ok);
console.log(`\nVERIFY-W5 RESULTS: ${passed}/${checks.length} passed`);
for (const c of checks) {
  console.log(`  ${c.ok ? "✓" : "✗"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}
if (failed.length > 0) {
  console.error(`\nFAILED:\n${failed.map((c) => `  ${c.name}: ${c.detail}`).join("\n")}`);
  process.exit(1);
}
console.log(`screenshots in ${OUT_DIR}/`);
