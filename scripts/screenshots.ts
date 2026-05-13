// Capture the six README screenshots. Boots Playwright Firefox against an
// already-running `bun dev` at localhost:3000. Output to docs/screenshots/.
// Re-run when the UI changes — README references these paths.
import { firefox } from "playwright";
import { mkdirSync } from "node:fs";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const ROOT = process.env.STRAND_ROOT ?? "http://localhost:3000";
const OUT_DIR = "docs/screenshots";
mkdirSync(OUT_DIR, { recursive: true });

// Resolve a sample company id to deep-link into. PwC España is Matt's biggest
// cluster on the real export; fall back to any company if absent.
const sample = await db.all<{ id: string; name: string; n: number }>(sql`
  SELECT c.id, c.name, COUNT(DISTINCT p.person_id) AS n
  FROM companies c
  LEFT JOIN positions p ON p.company_id = c.id AND p.tenant_id = c.tenant_id
  WHERE c.tenant_id = 'local'
  GROUP BY c.id
  ORDER BY n DESC
  LIMIT 1
`);
if (sample.length === 0) {
  console.error("no companies in DB — run bun run scripts/ingest-cli.ts first");
  process.exit(1);
}
const companyId = sample[0].id;
const companyName = sample[0].name;

const shots = [
  { name: "01-upload.png", route: "/upload" },
  { name: "02-profile.png", route: "/profile" },
  { name: "03-people.png", route: "/people" },
  { name: "04-company-detail.png", route: `/companies/${companyId}` },
  {
    name: "05-queries-at-company.png",
    route: `/queries/at-company?company=${companyId}&status=current`,
  },
  { name: "06-graph.png", route: "/graph" },
];

const browser = await firefox.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const page = await ctx.newPage();

for (const s of shots) {
  const url = `${ROOT}${s.route}`;
  const resp = await page.goto(url, { waitUntil: "networkidle" });
  if (resp?.status() !== 200) {
    console.error(`  ✗  ${s.name} ${s.route} → ${resp?.status()}`);
    continue;
  }
  // For the graph, give the cose layout a moment to settle.
  if (s.route === "/graph") await page.waitForTimeout(2500);
  // Viewport-only capture — keeps README screenshots small. Full-page on
  // pages with 145-row lists balloons to 2MB+ and bloats the repo.
  await page.screenshot({ path: `${OUT_DIR}/${s.name}`, fullPage: false });
  console.log(`  ✓  ${s.name} ← ${s.route}`);
}

await browser.close();
console.log(`\nSaved 6 screenshots to ${OUT_DIR}/ (sample company: ${companyName})`);
