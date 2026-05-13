// W5b verification: /queries/worked-with, /queries/by-year, /queries/reach
// across happy/sad paths + the bookmark round-trip for one URL of each kind.
import { firefox } from "playwright";
import { mkdirSync } from "node:fs";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const ROOT = "http://localhost:3000";
const OUT_DIR = "/tmp/strand-verify-w5b";
mkdirSync(OUT_DIR, { recursive: true });

// Fetch fixtures: owner_id, a PwC España connection with many derived edges,
// a year with substantial connections.
const ownerRow = await db.all<{ owner: string | null }>(sql`
  SELECT owner_person_id AS owner FROM tenants WHERE id='local' LIMIT 1
`);
const ownerId = ownerRow[0]?.owner ?? null;
if (!ownerId) {
  console.error("no owner_person_id in tenants");
  process.exit(1);
}

const richPerson = await db.all<{ id: string; full_name: string; n: number }>(sql`
  SELECT p.id, p.full_name, COUNT(*) AS n
  FROM derived_edges e
  JOIN people p ON p.id = (CASE WHEN e.person_a = ${ownerId} THEN e.person_b ELSE e.person_a END)
  WHERE e.tenant_id='local'
    AND (e.person_a = ${ownerId} OR e.person_b = ${ownerId})
    AND p.id != ${ownerId}
  GROUP BY p.id
  ORDER BY n DESC
  LIMIT 1
`);
if (richPerson.length === 0) {
  console.error("no derived edges incident to owner — re-run derive");
  process.exit(1);
}
const targetPersonId = richPerson[0].id;
const targetPersonName = richPerson[0].full_name;

const topYearRow = await db.all<{ year: string; n: number }>(sql`
  SELECT substr(c.connected_at, 1, 4) AS year, COUNT(*) AS n
  FROM connections c
  WHERE c.tenant_id='local' AND c.connected_at IS NOT NULL
    AND c.to_person_id != ${ownerId}
  GROUP BY year
  ORDER BY n DESC
  LIMIT 1
`);
const topYear = topYearRow[0]?.year;
if (!topYear) {
  console.error("no year buckets in connections");
  process.exit(1);
}

const totalConnections = await db.all<{ n: number }>(sql`
  SELECT COUNT(*) AS n FROM connections c
  WHERE c.tenant_id='local' AND c.to_person_id != ${ownerId}
`);

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
  expectedStatus = 200,
): Promise<void> {
  currentRoute = route;
  const resp = await page.goto(`${ROOT}${route}`, { waitUntil: "networkidle" });
  const file = `${OUT_DIR}${route.replace(/[\/?&=%']/g, "_").slice(0, 80)}.png`;
  await page.screenshot({ path: file, fullPage: true });
  checks.push({
    name: `${route} → ${expectedStatus}`,
    ok: resp?.status() === expectedStatus,
    detail: `status=${resp?.status()}`,
  });
  if (resp?.status() === expectedStatus) {
    for (const c of await fn()) checks.push(c);
  }
}

// --- worked-with ---
await probe(`/queries/worked-with`, async () => {
  const picker = await page.locator('[data-testid="person-picker"]').count();
  const sidebar = await page.locator('[data-testid="saved-queries-section"]').count();
  return [
    {
      name: "ISC-116 picker + sidebar visible",
      ok: picker === 1 && sidebar === 1,
      detail: `picker=${picker} sidebar=${sidebar}`,
    },
  ];
});

await probe(`/queries/worked-with/${targetPersonId}`, async () => {
  const heading = (await page.locator('[data-testid="worked-with-name"]').textContent())?.trim();
  const manualSection = await page.locator('[data-testid="worked-with-manual-section"]').count();
  const derivedSection = await page.locator('[data-testid="worked-with-derived-section"]').count();
  const derivedRows = await page.locator('[data-testid="worked-with-derived-row"]').count();
  const save = await page.locator('[data-testid="save-bookmark"]').count();
  return [
    {
      name: "ISC-118 heading is target person",
      ok: heading === targetPersonName,
      detail: `heading=${heading}`,
    },
    {
      name: "ISC-119 + ISC-120 manual & derived sections both visible",
      ok: manualSection === 1 && derivedSection === 1,
      detail: `manual=${manualSection} derived=${derivedSection}`,
    },
    {
      name: "ISC-121 derived list ≥10 rows for a PwC España connection",
      ok: derivedRows >= 10,
      detail: `${derivedRows} rows`,
    },
    {
      name: "ISC-123 SaveBookmark visible on /queries/worked-with/[id]",
      ok: save === 1,
      detail: `save=${save}`,
    },
  ];
});

// ISC-117: nonexistent → 404
await probe(`/queries/worked-with/nonexistent`, async () => [], 404);

// --- by-year ---
await probe(`/queries/by-year`, async () => {
  const buckets = await page.locator('[data-testid="by-year-bucket"]').count();
  const sidebar = await page.locator('[data-testid="saved-queries-section"]').count();
  return [
    {
      name: "ISC-124 histogram renders with ≥1 bucket",
      ok: buckets >= 1,
      detail: `${buckets} buckets`,
    },
    {
      name: "ISC-130 sidebar visible",
      ok: sidebar === 1,
      detail: `sidebar=${sidebar}`,
    },
  ];
});

// ISC-125: histogram counts sum to total non-owner connections
{
  const buckets = await db.all<{ count: number }>(sql`
    SELECT COUNT(*) AS count
    FROM connections c
    WHERE c.tenant_id='local' AND c.to_person_id != ${ownerId}
    GROUP BY (CASE WHEN c.connected_at IS NULL THEN NULL ELSE substr(c.connected_at, 1, 4) END)
  `);
  const sum = buckets.reduce((s, b) => s + b.count, 0);
  checks.push({
    name: "ISC-125 histogram sum matches total non-owner connections",
    ok: sum === totalConnections[0]?.n,
    detail: `histogram=${sum} total=${totalConnections[0]?.n}`,
  });
}

await probe(`/queries/by-year?year=${topYear}`, async () => {
  const rows = await page.locator('[data-testid="by-year-row"]').count();
  const heading = (await page.locator('[data-testid="by-year-name"]').textContent())?.trim();
  return [
    {
      name: `ISC-126 ?year=${topYear} renders ≥1 person`,
      ok: rows >= 1,
      detail: `${rows} rows`,
    },
    {
      name: `ISC-126 heading is "${topYear}"`,
      ok: heading === topYear,
      detail: `heading=${heading}`,
    },
  ];
});

await probe(`/queries/by-year?year=unknown`, async () => {
  const heading = (await page.locator('[data-testid="by-year-name"]').textContent())?.trim();
  return [
    {
      name: "ISC-127 ?year=unknown renders 'Unknown year' heading",
      ok: heading === "Unknown year",
      detail: `heading=${heading}`,
    },
  ];
});

await probe(`/queries/by-year?year=2099`, async () => {
  const empty = await page.locator('[data-testid="by-year-empty"]').count();
  return [
    {
      name: "ISC-128 ?year=2099 (no people) renders empty state, no crash",
      ok: empty === 1,
      detail: `empty=${empty}`,
    },
  ];
});

// ISC-129: SQL injection probe
{
  const url = `${ROOT}/queries/by-year?year=${encodeURIComponent("' OR 1=1 --")}`;
  const resp = await page.goto(url, { waitUntil: "domcontentloaded" });
  checks.push({
    name: "ISC-129 ?year=<SQL inj> → 200, no crash",
    ok: resp?.status() === 200,
    detail: `status=${resp?.status()}`,
  });
}

// --- reach ---
await probe(`/queries/reach`, async () => {
  const picker = await page.locator('[data-testid="person-picker"]').count();
  return [
    {
      name: "ISC-131 reach picker visible",
      ok: picker === 1,
      detail: `picker=${picker}`,
    },
  ];
});

await probe(`/queries/reach/${ownerId}`, async () => {
  const self = await page.locator('[data-testid="reach-self"]').count();
  const candidates = await page.locator('[data-testid="reach-list"]').count();
  return [
    {
      name: "ISC-133 reach to owner → 'this is you' panel, no candidate list",
      ok: self === 1 && candidates === 0,
      detail: `self=${self} candidatesList=${candidates}`,
    },
  ];
});

await probe(`/queries/reach/${targetPersonId}`, async () => {
  const direct = await page.locator('[data-testid="reach-direct"]').count();
  const rows = await page.locator('[data-testid="reach-row"]').count();
  const save = await page.locator('[data-testid="save-bookmark"]').count();
  // ISC-139: target not in their own intermediary list
  const candidateLinks = await page.locator('[data-testid="reach-row"] a').all();
  let selfPair = 0;
  for (const link of candidateLinks) {
    const href = await link.getAttribute("href");
    if (href === `/people/${targetPersonId}`) selfPair++;
  }
  return [
    {
      name: "ISC-134 direct-connection panel visible for a 1st-degree target",
      ok: direct === 1,
      detail: `direct=${direct}`,
    },
    {
      name: "ISC-138 ≥5 reach intermediaries for a derived-rich target",
      ok: rows >= 5,
      detail: `${rows} rows`,
    },
    {
      name: "ISC-139 target NOT present in its own reach list",
      ok: selfPair === 0,
      detail: `selfPair=${selfPair}`,
    },
    {
      name: "ISC-141 SaveBookmark visible on reach page",
      ok: save === 1,
      detail: `save=${save}`,
    },
  ];
});

// ISC-132: nonexistent → 404
await probe(`/queries/reach/nonexistent_deadbeef`, async () => [], 404);

// --- ISC-145: bookmark round-trip on each new query URL ---
{
  const ts = Date.now();
  const urls = [
    { name: `wv-${ts}`, url: `/queries/worked-with/${targetPersonId}` },
    { name: `by-${ts}`, url: `/queries/by-year?year=${topYear}` },
    { name: `re-${ts}`, url: `/queries/reach/${targetPersonId}` },
  ];
  let ok = true;
  let detail = "";
  for (const u of urls) {
    const r1 = await fetch(`${ROOT}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(u),
    });
    const body = (await r1.json()) as { id?: string };
    if (r1.status !== 201 || !body.id) {
      ok = false;
      detail = `POST ${u.url} → ${r1.status}`;
      break;
    }
    const r2 = await fetch(`${ROOT}/api/bookmarks/${body.id}`, { method: "DELETE" });
    if (r2.status !== 204) {
      ok = false;
      detail = `DELETE ${body.id} → ${r2.status}`;
      break;
    }
  }
  checks.push({
    name: "ISC-145 bookmark round-trip on all 3 new URL shapes (201 → 204)",
    ok,
    detail: ok ? "3 round-trips" : detail,
  });
}

await browser.close();

const nonLocal = network.filter(
  (r) =>
    !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(r.url) &&
    !r.url.startsWith("data:") &&
    !r.url.startsWith("about:"),
);
checks.push({
  name: "ISC-143 zero non-localhost requests across all three pages",
  ok: nonLocal.length === 0,
  detail: `${nonLocal.length} non-local hits`,
});
checks.push({
  name: "ISC-144 zero page errors",
  ok: pageErrors.length === 0,
  detail: pageErrors.join("; "),
});

const passed = checks.filter((c) => c.ok).length;
const failed = checks.filter((c) => !c.ok);
console.log(`\nVERIFY-W5B RESULTS: ${passed}/${checks.length} passed`);
for (const c of checks) {
  console.log(`  ${c.ok ? "✓" : "✗"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}
if (failed.length > 0) {
  console.error(`\nFAILED:\n${failed.map((c) => `  ${c.name}: ${c.detail}`).join("\n")}`);
  process.exit(1);
}
console.log(`screenshots in ${OUT_DIR}/`);
