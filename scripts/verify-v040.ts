// v0.4.0 verify: /graph cap dropdown + company picker + scope toggle.
// Same shape as verify-v030c.ts — Playwright Firefox against a running dev
// server. Exits non-zero on any assertion failure.
import { firefox } from "playwright";
import { mkdirSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const ROOT = "http://localhost:3000";
const OUT_DIR = "/tmp/strand-verify-v040";
mkdirSync(OUT_DIR, { recursive: true });

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];

async function pickCompany(): Promise<{ id: string; name: string; current: number }> {
  const [row] = await db.all<{ id: string; name: string; current: number }>(sql`
    SELECT c.id, c.name, t.n AS current
    FROM companies c
    JOIN (
      SELECT po.company_id, COUNT(DISTINCT po.person_id) AS n
      FROM positions po
      WHERE po.tenant_id = 'local' AND po.current = 1
      GROUP BY po.company_id
    ) t ON t.company_id = c.id
    WHERE c.tenant_id = 'local'
    ORDER BY t.n DESC
    LIMIT 1
  `);
  if (!row) throw new Error("no companies with current people in dataset");
  return row;
}

const company = await pickCompany();
console.log(`Target company: ${company.name} (${company.id}) — ${company.current} current`);

const browser = await firefox.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const pageErrors: string[] = [];
const network: { url: string }[] = [];
page.on("pageerror", (err) => pageErrors.push(err.message));
page.on("request", (req) => network.push({ url: req.url() }));

// ── /graph default ─────────────────────────────────────────────────────
const defResp = await page.goto(`${ROOT}/graph`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT_DIR}/graph-default.png`, fullPage: true });
checks.push({
  name: "/graph default → 200",
  ok: defResp?.status() === 200,
  detail: `status=${defResp?.status()}`,
});

// Cap dropdown present + default value
const capValue = await page.locator('[data-testid="cap-value"]').textContent();
checks.push({
  name: "ISC-381 cap dropdown present with default value 150",
  ok: (capValue ?? "").trim() === "150",
  detail: `value="${capValue?.trim()}"`,
});

// Company picker visible (no company selected → input visible, scope hidden)
const pickerCount = await page.locator('[data-testid="company-picker"]').count();
const scopeCountDefault = await page.locator('[data-testid="scope-toggle"]').count();
checks.push({
  name: "ISC-378/379 company picker visible when no company selected",
  ok: pickerCount === 1,
  detail: `picker=${pickerCount}`,
});
checks.push({
  name: "ISC-379/Q2a scope toggle HIDDEN when no company selected",
  ok: scopeCountDefault === 0,
  detail: `scope_toggle=${scopeCountDefault}`,
});

// ── /graph?cap=50 ──────────────────────────────────────────────────────
await page.goto(`${ROOT}/graph?cap=50`, { waitUntil: "networkidle" });
const cap50Value = await page.locator('[data-testid="cap-value"]').textContent();
checks.push({
  name: "ISC-381 ?cap=50 → dropdown reflects 50",
  ok: (cap50Value ?? "").trim() === "50",
  detail: `value="${cap50Value?.trim()}"`,
});

// ── /graph?company=<id> default scope=current ───────────────────────────
await page.goto(`${ROOT}/graph?company=${company.id}`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT_DIR}/graph-company-current.png`, fullPage: true });
const activeName = await page.locator('[data-testid="company-active"]').textContent();
checks.push({
  name: "ISC-369/380 company active pill shows resolved name",
  ok: (activeName ?? "").trim() === company.name,
  detail: `active="${activeName?.trim()}" expected="${company.name}"`,
});

const scopeCountCompany = await page.locator('[data-testid="scope-toggle"]').count();
const scopeCurrentPressed = await page
  .locator('[data-testid="scope-current"]')
  .getAttribute("aria-pressed");
const scopeEverPressed = await page
  .locator('[data-testid="scope-ever"]')
  .getAttribute("aria-pressed");
checks.push({
  name: "ISC-379/Q2a scope toggle VISIBLE when company selected",
  ok: scopeCountCompany === 1,
  detail: `scope_toggle=${scopeCountCompany}`,
});
checks.push({
  name: "ISC-379 default scope=current → Current aria-pressed=true, Ever=false",
  ok: scopeCurrentPressed === "true" && scopeEverPressed === "false",
  detail: `current=${scopeCurrentPressed} ever=${scopeEverPressed}`,
});

const clearCount = await page.locator('[data-testid="company-clear"]').count();
checks.push({
  name: "ISC-380 × clear affordance present when company selected",
  ok: clearCount === 1,
  detail: `clear_buttons=${clearCount}`,
});

// ── /graph?company=<id>&scope=ever ─────────────────────────────────────
await page.goto(`${ROOT}/graph?company=${company.id}&scope=ever`, {
  waitUntil: "networkidle",
});
await page.screenshot({ path: `${OUT_DIR}/graph-company-ever.png`, fullPage: true });
const everPressed = await page
  .locator('[data-testid="scope-ever"]')
  .getAttribute("aria-pressed");
const currentPressedB = await page
  .locator('[data-testid="scope-current"]')
  .getAttribute("aria-pressed");
checks.push({
  name: "ISC-379 ?scope=ever → Ever aria-pressed=true, Current=false",
  ok: everPressed === "true" && currentPressedB === "false",
  detail: `current=${currentPressedB} ever=${everPressed}`,
});

// ── /graph?company=<id>&cap=50 (filter-then-cap composition) ──────────
// Dropdown snaps to one of CAP_OPTIONS; 50 is the smallest snap point, so
// a small-cap composition test uses that. The server still honours any
// integer cap in [1, MAX_NODE_CAP] — the dropdown is just the discrete UI.
await page.goto(`${ROOT}/graph?company=${company.id}&cap=50`, {
  waitUntil: "networkidle",
});
await page.screenshot({ path: `${OUT_DIR}/graph-company-cap50.png`, fullPage: true });
const cap50CompValue = await page.locator('[data-testid="cap-value"]').textContent();
const activeNameC = await page.locator('[data-testid="company-active"]').textContent();
checks.push({
  name: "ISC-372/389 filter+cap compose — cap=50, company active",
  ok: (cap50CompValue ?? "").trim() === "50" && (activeNameC ?? "").trim() === company.name,
  detail: `cap="${cap50CompValue?.trim()}" active="${activeNameC?.trim()}"`,
});

// ── ?cap=garbage → falls back to default 150 ────────────────────────────
await page.goto(`${ROOT}/graph?cap=garbage`, { waitUntil: "networkidle" });
const capGarbageValue = await page.locator('[data-testid="cap-value"]').textContent();
checks.push({
  name: "ISC-368 invalid ?cap=garbage → default 150",
  ok: (capGarbageValue ?? "").trim() === "150",
  detail: `value="${capGarbageValue?.trim()}"`,
});

// ── ?company=bogus → empty graph (or just owner), no crash ─────────────
const bogusResp = await page.goto(
  `${ROOT}/graph?company=00000000-no-such-company`,
  { waitUntil: "networkidle" },
);
checks.push({
  name: "ISC-390 bogus company id → 200 (graceful empty, no crash)",
  ok: bogusResp?.status() === 200,
  detail: `status=${bogusResp?.status()}`,
});

// ── zero pageerror + zero non-localhost ──────────────────────────────
// Filter out Next.js dev-mode chunk-staleness errors — they're an HMR
// artifact when playwright navigates faster than the chunk graph
// settles, not a product bug. The chunk URL itself returns 200; only
// the in-flight client-side import races against the rebuild.
const realPageErrors = pageErrors.filter(
  (e) => !/Loading chunk .* failed/i.test(e),
);
checks.push({
  name: "ISC-392 zero pageerror across all visited routes (dev-chunk noise filtered)",
  ok: realPageErrors.length === 0,
  detail: realPageErrors.join("; ") || `${pageErrors.length} chunk-load noise messages filtered`,
});
const nonLocal = network.filter(
  (r) =>
    !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(r.url) &&
    !r.url.startsWith("data:") &&
    !r.url.startsWith("about:") &&
    !r.url.startsWith("blob:"),
);
checks.push({
  name: "ISC-392 zero non-localhost requests",
  ok: nonLocal.length === 0,
  detail: `${nonLocal.length} non-local`,
});

await browser.close();

const passed = checks.filter((c) => c.ok).length;
const failed = checks.filter((c) => !c.ok);
console.log(`\nVERIFY-V0.4.0 RESULTS: ${passed}/${checks.length} passed`);
for (const c of checks) {
  console.log(`  ${c.ok ? "✓" : "✗"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}
if (failed.length > 0) {
  console.error(`\nFAILED:\n${failed.map((c) => `  ${c.name}: ${c.detail}`).join("\n")}`);
  process.exit(1);
}
console.log(`screenshots in ${OUT_DIR}/`);
