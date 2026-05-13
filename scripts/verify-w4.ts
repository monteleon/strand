// W4 verification: synthesised positions visible on /companies/[id]; derived
// edges section visible on /people/[id]; profile has no synthesised rows;
// derived UI cleanly separate from manual UI. Captures screenshots + a
// network log to /tmp/strand-verify-w4 and exits non-zero on any failure.
import { firefox } from "playwright";
import { mkdirSync } from "node:fs";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const ROOT = "http://localhost:3000";
const OUT_DIR = "/tmp/strand-verify-w4";
mkdirSync(OUT_DIR, { recursive: true });

// Pick a real connection at PwC España so the page has lots of derived edges.
const pwcCompany = await db.all<{ id: string; name: string }>(sql`
  SELECT c.id, c.name FROM companies c
  WHERE c.tenant_id='local' AND lower(c.normalized_name) = 'pwc espana'
  LIMIT 1
`);
if (pwcCompany.length === 0) {
  console.error("no PwC España row found; re-ingest first");
  process.exit(1);
}
const company = pwcCompany[0];

const personAtPwc = await db.all<{ id: string; full_name: string }>(sql`
  SELECT p.id, p.full_name
  FROM positions po
  JOIN people p ON p.id = po.person_id
  JOIN tenants t ON t.id = po.tenant_id
  WHERE po.tenant_id='local'
    AND po.company_id = ${company.id}
    AND p.id != t.owner_person_id
  ORDER BY p.full_name
  LIMIT 1
`);
if (personAtPwc.length === 0) {
  console.error("no non-owner person at PwC España");
  process.exit(1);
}
const person = personAtPwc[0];

const browser = await firefox.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const pageErrors: string[] = [];
const consoleProblems: string[] = [];
const network: { route: string; url: string }[] = [];
let currentRoute = "";

page.on("pageerror", (err) => pageErrors.push(`${currentRoute}: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") {
    consoleProblems.push(`${currentRoute}: ${msg.type()}: ${msg.text()}`);
  }
});
page.on("request", (req) => network.push({ route: currentRoute, url: req.url() }));

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];

async function probe(route: string, fn: () => Promise<Check[]>) {
  currentRoute = route;
  const url = `${ROOT}${route}`;
  const resp = await page.goto(url, { waitUntil: "networkidle" });
  const screenshot = `${OUT_DIR}${route.replace(/\//g, "_")}.png`;
  await page.screenshot({ path: screenshot, fullPage: true });
  checks.push({
    name: `${route} → 200`,
    ok: resp?.status() === 200,
    detail: `status=${resp?.status()}`,
  });
  for (const c of await fn()) checks.push(c);
}

// /companies/[id] — at least 20 people listed, derived-pairs section visible,
// some synthesised positions present.
await probe(`/companies/${company.id}`, async () => {
  const peopleRows = await page.locator('[data-testid="company-people"] li').count();
  const synthesisedRows = await page
    .locator('[data-testid="company-people"] li[data-origin="synthesised"]')
    .count();
  const derivedSection = await page
    .locator('[data-testid="derived-pairs-section"]')
    .count();
  const derivedRows = await page.locator('[data-testid="derived-pair-row"]').count();
  return [
    {
      name: "ISC-72 /companies/PwC España lists ≥20 people",
      ok: peopleRows >= 20,
      detail: `${peopleRows} rows`,
    },
    {
      name: "synthesised rows present on /companies/[id]",
      ok: synthesisedRows >= 1,
      detail: `${synthesisedRows} synthesised`,
    },
    {
      name: "ISC-93 derived-pairs section visible on /companies/[id]",
      ok: derivedSection === 1 && derivedRows >= 1,
      detail: `section=${derivedSection} rows=${derivedRows}`,
    },
  ];
});

// /people/[id] — derived-edges section visible, synthesised position label
// present, manual-edges and derived-edges sections both visible (distinct
// sections — ISC-94 visual distinctness).
await probe(`/people/${person.id}`, async () => {
  const derivedSection = await page
    .locator('[data-testid="derived-edges-section"]')
    .count();
  const derivedRows = await page.locator('[data-testid="derived-edge-row"]').count();
  const synthesisedLabel = await page
    .locator('[data-testid="position-synthesised"]')
    .count();
  const manualSection = await page.getByText("Manual connections").count();
  return [
    {
      name: "ISC-92 derived-edges section visible on /people/[id]",
      ok: derivedSection === 1 && derivedRows >= 1,
      detail: `section=${derivedSection} rows=${derivedRows}`,
    },
    {
      name: "ISC-75 synthesised position labelled distinctly",
      ok: synthesisedLabel >= 1,
      detail: `${synthesisedLabel} synthesised label(s)`,
    },
    {
      name: "ISC-94 manual + derived sections both present (distinct)",
      ok: manualSection >= 1 && derivedSection === 1,
      detail: `manual=${manualSection} derived=${derivedSection}`,
    },
  ];
});

// /profile — synthesised positions never appear in owner timeline.
await probe(`/profile`, async () => {
  const synthesisedOnProfile = await page
    .locator('[data-testid="position-synthesised"]')
    .count();
  return [
    {
      name: "ISC-74 anti: profile has no synthesised position rows",
      ok: synthesisedOnProfile === 0,
      detail: `${synthesisedOnProfile} synthesised on profile`,
    },
  ];
});

await browser.close();

// Anti: zero non-localhost requests.
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

console.log(`\nVERIFY-W4 RESULTS: ${passed}/${checks.length} passed`);
for (const c of checks) {
  console.log(`  ${c.ok ? "✓" : "✗"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}
if (failed.length > 0) {
  console.error(`\nFAILED:\n${failed.map((c) => `  ${c.name}: ${c.detail}`).join("\n")}`);
  process.exit(1);
}
console.log(`screenshots in ${OUT_DIR}/`);
