// v0.3.0-C + v0.3.2 verify: warm-path-finder on /queries/reach/[id].
// Asserts warmth + mutuality pills render on every row, three-button sort
// toggle (Epistemic ↔ Warmth ↔ Mutuality), aria-pressed reflects active
// mode, unknown sort falls back, self panel + direct connection panel
// render identically across all sort modes, bookmark URL round-trips with
// ?sort=warmth and ?sort=mutuality.
import { firefox } from "playwright";
import { mkdirSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const ROOT = "http://localhost:3000";
const OUT_DIR = "/tmp/strand-verify-v030c";
mkdirSync(OUT_DIR, { recursive: true });

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];

// Find a target X with ≥3 reach candidates, biased toward ones with some
// messages in the candidate set (so warmth sort produces visible reordering).
async function pickTarget(): Promise<{ id: string; name: string } | null> {
  const [row] = await db.all<{ target_id: string }>(sql`
    SELECT t.target_id
    FROM (
      SELECT
        CASE WHEN e.person_a = c.to_person_id THEN e.person_b ELSE e.person_a END AS intermediary_id,
        CASE WHEN e.person_a = c.to_person_id THEN e.person_a ELSE e.person_b END AS target_id
      FROM derived_edges e
      JOIN tenants tn ON tn.id = e.tenant_id
      JOIN connections c
        ON c.tenant_id = e.tenant_id
       AND c.from_person_id = tn.owner_person_id
       AND (c.to_person_id = e.person_a OR c.to_person_id = e.person_b)
      WHERE e.tenant_id = 'local'
    ) t
    WHERE t.intermediary_id != t.target_id
      AND t.target_id != (SELECT owner_person_id FROM tenants WHERE id = 'local')
    GROUP BY t.target_id
    HAVING COUNT(*) >= 3
    ORDER BY COUNT(*) DESC
    LIMIT 1
  `);
  if (!row) return null;
  const [p] = await db.all<{ full_name: string }>(sql`
    SELECT full_name FROM people WHERE id = ${row.target_id}
  `);
  return { id: row.target_id, name: p?.full_name ?? "(unknown)" };
}

const [ownerRow] = await db.all<{ owner_person_id: string }>(sql`
  SELECT owner_person_id FROM tenants WHERE id = 'local'
`);
const ownerId = ownerRow?.owner_person_id;
if (!ownerId) throw new Error("owner not configured");

const target = await pickTarget();
if (!target) throw new Error("no target with ≥3 reach candidates");
console.log(`Target: ${target.name} (${target.id})`);

const browser = await firefox.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const pageErrors: string[] = [];
const network: { url: string }[] = [];
page.on("pageerror", (err) => pageErrors.push(err.message));
page.on("request", (req) => network.push({ url: req.url() }));

// ── default /queries/reach/[id] (sort=epistemic) ──────────────────────
const defaultUrl = `${ROOT}/queries/reach/${target.id}`;
const defaultResp = await page.goto(defaultUrl, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT_DIR}/reach-epistemic.png`, fullPage: true });
checks.push({
  name: "default /queries/reach/[id] → 200",
  ok: defaultResp?.status() === 200,
  detail: `status=${defaultResp?.status()}`,
});

const sortToggleCount = await page
  .locator('[data-testid="reach-sort-toggle"]')
  .count();
checks.push({
  name: "ISC-280 sort toggle renders",
  ok: sortToggleCount === 1,
  detail: `count=${sortToggleCount}`,
});

const epiPressed = await page
  .locator('[data-testid="reach-sort-epistemic"]')
  .getAttribute("aria-pressed");
const wrmPressed = await page
  .locator('[data-testid="reach-sort-warmth"]')
  .getAttribute("aria-pressed");
const mutPressed = await page
  .locator('[data-testid="reach-sort-mutuality"]')
  .getAttribute("aria-pressed");
checks.push({
  name: "ISC-281 / ISC-316 default URL → Epistemic active (aria-pressed=true), Warmth + Mutuality inactive",
  ok: epiPressed === "true" && wrmPressed === "false" && mutPressed === "false",
  detail: `epi=${epiPressed} wrm=${wrmPressed} mut=${mutPressed}`,
});

// ISC-315: sum of aria-pressed=true across toggle group == 1 (exactly one active)
const pressedSumEpi = [epiPressed, wrmPressed, mutPressed].filter((v) => v === "true").length;
checks.push({
  name: "ISC-315 aria-pressed sum-is-1 invariant (epistemic mode)",
  ok: pressedSumEpi === 1,
  detail: `pressed_count=${pressedSumEpi}`,
});

const warmthPills = await page.locator('[data-testid="reach-warmth"]').count();
const mutualityPills = await page.locator('[data-testid="reach-mutuality"]').count();
const rowCount = await page.locator('[data-testid="reach-row"]').count();
checks.push({
  name: "ISC-279 warmth pill renders on EVERY candidate row (render-zeros-not-absence)",
  ok: warmthPills === rowCount && rowCount > 0,
  detail: `pills=${warmthPills} rows=${rowCount}`,
});
checks.push({
  name: "ISC-317 mutuality pill renders on EVERY candidate row (render-zeros-not-absence)",
  ok: mutualityPills === rowCount && rowCount > 0,
  detail: `pills=${mutualityPills} rows=${rowCount}`,
});

// Capture epistemic ordering (intermediary IDs in order).
const epistemicIds = await page
  .locator('[data-testid="reach-row"]')
  .evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).querySelector("a")?.getAttribute("href")),
  );

// ── /queries/reach/[id]?sort=warmth ───────────────────────────────────
const warmthUrl = `${ROOT}/queries/reach/${target.id}?sort=warmth`;
const warmthResp = await page.goto(warmthUrl, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT_DIR}/reach-warmth.png`, fullPage: true });
checks.push({
  name: "?sort=warmth → 200",
  ok: warmthResp?.status() === 200,
  detail: `status=${warmthResp?.status()}`,
});

const epiPressedW = await page
  .locator('[data-testid="reach-sort-epistemic"]')
  .getAttribute("aria-pressed");
const wrmPressedW = await page
  .locator('[data-testid="reach-sort-warmth"]')
  .getAttribute("aria-pressed");
checks.push({
  name: "ISC-282 ?sort=warmth → Warmth active (aria-pressed=true), Epistemic inactive",
  ok: epiPressedW === "false" && wrmPressedW === "true",
  detail: `epi=${epiPressedW} wrm=${wrmPressedW}`,
});

const warmthIds = await page
  .locator('[data-testid="reach-row"]')
  .evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).querySelector("a")?.getAttribute("href")),
  );
checks.push({
  name: "ISC-282 candidate set is the same across sort modes",
  ok:
    epistemicIds.length === warmthIds.length &&
    new Set(epistemicIds).size === new Set([...epistemicIds, ...warmthIds]).size,
  detail: `epi=${epistemicIds.length} wrm=${warmthIds.length}`,
});

// Confirm warmth-total values are monotone non-increasing in warmth mode.
const warmthTotals = await page
  .locator('[data-testid="reach-warmth"]')
  .evaluateAll((els) =>
    els.map((el) => Number((el as HTMLElement).getAttribute("data-warmth-total") ?? "0")),
  );
let monotone = true;
let zerosLastViolated = false;
let sawZero = false;
for (let i = 0; i < warmthTotals.length; i++) {
  if (i > 0 && warmthTotals[i - 1]! < warmthTotals[i]!) monotone = false;
  if (warmthTotals[i] === 0) sawZero = true;
  else if (sawZero) zerosLastViolated = true;
}
checks.push({
  name: "ISC-277 warmth sort: totals monotone non-increasing across rows",
  ok: monotone,
  detail: `totals=[${warmthTotals.slice(0, 8).join(", ")}${warmthTotals.length > 8 ? ", …" : ""}]`,
});
checks.push({
  name: "ISC-277 warmth sort: zero-message intermediaries fall to the bottom (NULLS LAST)",
  ok: !zerosLastViolated,
  detail: `violation=${zerosLastViolated}`,
});

// ── ?sort=mutuality → Mutuality active, mutuality-sort ordering ────────
const mutUrl = `${ROOT}/queries/reach/${target.id}?sort=mutuality`;
const mutResp = await page.goto(mutUrl, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT_DIR}/reach-mutuality.png`, fullPage: true });
checks.push({
  name: "?sort=mutuality → 200",
  ok: mutResp?.status() === 200,
  detail: `status=${mutResp?.status()}`,
});

const epiPressedM = await page
  .locator('[data-testid="reach-sort-epistemic"]')
  .getAttribute("aria-pressed");
const wrmPressedM = await page
  .locator('[data-testid="reach-sort-warmth"]')
  .getAttribute("aria-pressed");
const mutPressedM = await page
  .locator('[data-testid="reach-sort-mutuality"]')
  .getAttribute("aria-pressed");
checks.push({
  name: "ISC-316 ?sort=mutuality → Mutuality active, Epistemic + Warmth inactive",
  ok: epiPressedM === "false" && wrmPressedM === "false" && mutPressedM === "true",
  detail: `epi=${epiPressedM} wrm=${wrmPressedM} mut=${mutPressedM}`,
});
const pressedSumMut = [epiPressedM, wrmPressedM, mutPressedM].filter((v) => v === "true").length;
checks.push({
  name: "ISC-315 aria-pressed sum-is-1 invariant (mutuality mode)",
  ok: pressedSumMut === 1,
  detail: `pressed_count=${pressedSumMut}`,
});

const headingMut = (
  await page
    .locator('[data-testid="reach-candidates-section"] h2')
    .first()
    .textContent()
)?.trim();
checks.push({
  name: "ISC-318 mutuality mode heading reads 'Most mutual reach'",
  ok: headingMut === "Most mutual reach",
  detail: `heading="${headingMut}"`,
});

// Confirm mutuality values monotone non-increasing in mutuality mode.
const mutualityTotals = await page
  .locator('[data-testid="reach-mutuality"]')
  .evaluateAll((els) =>
    els.map((el) => Number((el as HTMLElement).getAttribute("data-mutuality") ?? "0")),
  );
let mutMonotone = true;
let mutZerosLastViolated = false;
let mutSawZero = false;
for (let i = 0; i < mutualityTotals.length; i++) {
  if (i > 0 && mutualityTotals[i - 1]! < mutualityTotals[i]!) mutMonotone = false;
  if (mutualityTotals[i] === 0) mutSawZero = true;
  else if (mutSawZero) mutZerosLastViolated = true;
}
checks.push({
  name: "ISC-311 mutuality sort: totals monotone non-increasing across rows",
  ok: mutMonotone,
  detail: `mut=[${mutualityTotals.slice(0, 8).join(", ")}${mutualityTotals.length > 8 ? ", …" : ""}]`,
});
checks.push({
  name: "ISC-311 mutuality sort: zero-mutuality intermediaries fall to the bottom (NULLS LAST)",
  ok: !mutZerosLastViolated,
  detail: `violation=${mutZerosLastViolated}`,
});

const mutualityIds = await page
  .locator('[data-testid="reach-row"]')
  .evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).querySelector("a")?.getAttribute("href")),
  );
checks.push({
  name: "ISC-312 candidate set identical across all three sort modes (epi/wrm/mut)",
  ok:
    epistemicIds.length === mutualityIds.length &&
    new Set([...epistemicIds, ...mutualityIds]).size === new Set(epistemicIds).size,
  detail: `epi=${epistemicIds.length} mut=${mutualityIds.length}`,
});

// ── ?sort=garbage → fallback to epistemic ────────────────────────────
const badResp = await page.goto(`${ROOT}/queries/reach/${target.id}?sort=garbage`, {
  waitUntil: "networkidle",
});
checks.push({
  name: "ISC-284 unknown ?sort=garbage → 200",
  ok: badResp?.status() === 200,
  detail: `status=${badResp?.status()}`,
});
const epiPressedBad = await page
  .locator('[data-testid="reach-sort-epistemic"]')
  .getAttribute("aria-pressed");
checks.push({
  name: "ISC-284 ?sort=garbage → falls back to Epistemic active",
  ok: epiPressedBad === "true",
  detail: `epi=${epiPressedBad}`,
});

// ── reach-self (target = owner) ────────────────────────────────────────
const selfResp = await page.goto(`${ROOT}/queries/reach/${ownerId}`, {
  waitUntil: "networkidle",
});
checks.push({
  name: "ISC-286 reach-self renders for owner target",
  ok: selfResp?.status() === 200,
  detail: `status=${selfResp?.status()}`,
});
const selfCount = await page.locator('[data-testid="reach-self"]').count();
const selfListCount = await page.locator('[data-testid="reach-list"]').count();
checks.push({
  name: "ISC-286 reach-self panel present; no candidate list rendered",
  ok: selfCount === 1 && selfListCount === 0,
  detail: `self=${selfCount} list=${selfListCount}`,
});

// Self path under ?sort=warmth — sort param has no effect on the self render.
await page.goto(`${ROOT}/queries/reach/${ownerId}?sort=warmth`, {
  waitUntil: "networkidle",
});
const selfWarmthCount = await page.locator('[data-testid="reach-self"]').count();
const selfWarmthListCount = await page.locator('[data-testid="reach-list"]').count();
checks.push({
  name: "ISC-286 reach-self renders identically with ?sort=warmth (sort has no effect on self)",
  ok: selfWarmthCount === 1 && selfWarmthListCount === 0,
  detail: `self=${selfWarmthCount} list=${selfWarmthListCount}`,
});

// ── bookmark round-trip with ?sort=mutuality URL ───────────────────────
const bookmarkMutBody = JSON.stringify({
  name: `verify-v032-mut-${Date.now()}`,
  url: `/queries/reach/${target.id}?sort=mutuality`,
});
const postMutResp = await fetch(`${ROOT}/api/bookmarks`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: bookmarkMutBody,
});
const postMutJson = postMutResp.ok ? await postMutResp.json() : null;
checks.push({
  name: "POST /api/bookmarks with ?sort=mutuality URL → 201",
  ok: postMutResp.status === 201 && !!postMutJson?.id,
  detail: `status=${postMutResp.status} id=${postMutJson?.id ?? "—"}`,
});
if (postMutJson?.id) {
  const delMutResp = await fetch(`${ROOT}/api/bookmarks/${postMutJson.id}`, {
    method: "DELETE",
  });
  checks.push({
    name: "DELETE /api/bookmarks/[id] (?sort=mutuality bookmark) → 204",
    ok: delMutResp.status === 204,
    detail: `status=${delMutResp.status}`,
  });
}

// ── bookmarks round-trip with ?sort=warmth URL (ISC-297) ──────────────
const bookmarkBody = JSON.stringify({
  name: `verify-v030c-${Date.now()}`,
  url: `/queries/reach/${target.id}?sort=warmth`,
});
const postResp = await fetch(`${ROOT}/api/bookmarks`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: bookmarkBody,
});
const postJson = postResp.ok ? await postResp.json() : null;
checks.push({
  name: "ISC-297 POST /api/bookmarks with ?sort=warmth URL → 201",
  ok: postResp.status === 201 && !!postJson?.id,
  detail: `status=${postResp.status} id=${postJson?.id ?? "—"}`,
});
if (postJson?.id) {
  const delResp = await fetch(`${ROOT}/api/bookmarks/${postJson.id}`, {
    method: "DELETE",
  });
  checks.push({
    name: "ISC-297 DELETE /api/bookmarks/[id] → 204",
    ok: delResp.status === 204,
    detail: `status=${delResp.status}`,
  });
}

// ── zero pageerror + zero non-localhost ──────────────────────────────
checks.push({
  name: "ISC-294 zero pageerror across all visited routes",
  ok: pageErrors.length === 0,
  detail: pageErrors.join("; "),
});
const nonLocal = network.filter(
  (r) =>
    !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(r.url) &&
    !r.url.startsWith("data:") &&
    !r.url.startsWith("about:") &&
    !r.url.startsWith("blob:"),
);
checks.push({
  name: "ISC-294 zero non-localhost requests",
  ok: nonLocal.length === 0,
  detail: `${nonLocal.length} non-local${nonLocal.length > 0 ? ` — ${nonLocal.slice(0, 3).map((r) => r.url).join(", ")}` : ""}`,
});

await browser.close();

const passed = checks.filter((c) => c.ok).length;
const failed = checks.filter((c) => !c.ok);
console.log(`\nVERIFY-V0.3.0-C RESULTS: ${passed}/${checks.length} passed`);
for (const c of checks) {
  console.log(`  ${c.ok ? "✓" : "✗"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}
if (failed.length > 0) {
  console.error(`\nFAILED:\n${failed.map((c) => `  ${c.name}: ${c.detail}`).join("\n")}`);
  process.exit(1);
}
console.log(`screenshots in ${OUT_DIR}/`);
