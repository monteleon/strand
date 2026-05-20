// W6 verify: /graph renders, Cytoscape canvas mounts, ≥100 visible nodes
// on the real data, no page errors, no non-localhost. Bookmark round-trip
// for /graph as the new URL shape.
import { firefox } from "playwright";
import { mkdirSync } from "node:fs";

const ROOT = "http://localhost:3000";
const OUT_DIR = "/tmp/strand-verify-w6";
mkdirSync(OUT_DIR, { recursive: true });

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];

const browser = await firefox.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const pageErrors: string[] = [];
const network: { url: string }[] = [];
page.on("pageerror", (err) => pageErrors.push(err.message));
page.on("request", (req) => network.push({ url: req.url() }));

const t0 = Date.now();
const resp = await page.goto(`${ROOT}/graph`, { waitUntil: "networkidle" });
const loadMs = Date.now() - t0;
await page.screenshot({ path: `${OUT_DIR}/graph.png`, fullPage: true });

checks.push({
  name: "ISC-151 /graph → 200",
  ok: resp?.status() === 200,
  detail: `status=${resp?.status()}`,
});

checks.push({
  name: "ISC-152 page loaded within 10s (cose layout convergence)",
  ok: loadMs < 10000,
  detail: `${loadMs}ms`,
});

// Wait for Cytoscape canvas to mount.
await page.waitForSelector('[data-testid="graph-container"] canvas', {
  timeout: 5000,
}).catch(() => null);

const container = await page.locator('[data-testid="graph-container"]').count();
const canvas = await page.locator('[data-testid="graph-container"] canvas').count();
checks.push({
  name: "ISC-160 graph-container present with Cytoscape canvas inside",
  ok: container === 1 && canvas >= 1,
  detail: `container=${container} canvas=${canvas}`,
});

// Stats grid (v0.2.0-A onwards: structured DOM, not regex against a label).
// The rail's `<dl data-testid="graph-stats">` carries one `<dd
// data-stat="...">` per metric. Reading by data-stat survives label-copy
// changes and renders the verify suite self-documenting again.
await page.waitForSelector('[data-testid="graph-stats"]', { timeout: 5000 });
const nodeText = (await page.locator('[data-stat="nodes"]').textContent()) ?? "";
const edgeText = (await page.locator('[data-stat="edges"]').textContent()) ?? "";
const nodeCount = parseInt(nodeText.trim(), 10) || 0;
// Edge cell may render as "M" or "M / N" (when EDGE_CAP fires). Both forms
// start with a leading integer that IS the rendered edge count.
const edgeMatch = edgeText.match(/^\s*(\d+)/);
const edgeCount = edgeMatch ? Number(edgeMatch[1]) : 0;
checks.push({
  name: "ISC-161 stats grid shows node + edge counts",
  ok: nodeCount > 0 && edgeCount > 0,
  detail: `nodes=${nodeCount} edges=${edgeCount}`,
});
checks.push({
  name: "ISC-156 ≥100 nodes rendered on real data",
  ok: nodeCount >= 100,
  detail: `${nodeCount} nodes`,
});

// Anti: no non-localhost network requests
const nonLocal = network.filter(
  (r) =>
    !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(r.url) &&
    !r.url.startsWith("data:") &&
    !r.url.startsWith("about:") &&
    !r.url.startsWith("blob:"),
);
checks.push({
  name: "ISC-157 zero non-localhost requests",
  ok: nonLocal.length === 0,
  detail: `${nonLocal.length} non-local hits${nonLocal.length > 0 ? ` — ${nonLocal.slice(0, 3).map((r) => r.url).join(", ")}` : ""}`,
});

checks.push({
  name: "ISC-159 zero page errors",
  ok: pageErrors.length === 0,
  detail: pageErrors.join("; "),
});

// ISC-158: initial HTML payload < 200KB
const html = await page.content();
const htmlKB = Buffer.byteLength(html, "utf8") / 1024;
checks.push({
  name: "ISC-158 initial HTML payload < 200KB",
  ok: htmlKB < 200,
  detail: `${htmlKB.toFixed(1)}KB`,
});

// ISC-163: /graph round-trips through /api/bookmarks
{
  const ts = Date.now();
  const r1 = await fetch(`${ROOT}/api/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `graph-${ts}`, url: "/graph" }),
  });
  const body = (await r1.json()) as { id?: string };
  const r2 = body.id
    ? await fetch(`${ROOT}/api/bookmarks/${body.id}`, { method: "DELETE" })
    : null;
  checks.push({
    name: "ISC-163 /graph bookmark round-trip (201 → 204)",
    ok: r1.status === 201 && r2?.status === 204,
    detail: `POST=${r1.status} DELETE=${r2?.status}`,
  });
}

// ISC-164: home page lists /graph as live
{
  await page.goto(`${ROOT}/`, { waitUntil: "networkidle" });
  const html = await page.content();
  const hasGraphLive = html.includes("/graph") && html.includes("Force-directed");
  checks.push({
    name: "ISC-164 home roadmap lists /graph as a live link",
    ok: hasGraphLive,
    detail: hasGraphLive ? "present" : "missing",
  });
  // ISC-165: stale "Derived edges" entry pointing at /graph removed
  const hasStaleDerivedEdges = html.includes("Derived edges") && html.includes("/graph");
  checks.push({
    name: "ISC-165 stale 'Derived edges' standalone entry removed from roadmap",
    ok: !hasStaleDerivedEdges,
    detail: hasStaleDerivedEdges ? "still present" : "removed",
  });
}

await browser.close();

const passed = checks.filter((c) => c.ok).length;
const failed = checks.filter((c) => !c.ok);
console.log(`\nVERIFY-W6 RESULTS: ${passed}/${checks.length} passed`);
for (const c of checks) {
  console.log(`  ${c.ok ? "✓" : "✗"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}
if (failed.length > 0) {
  console.error(`\nFAILED:\n${failed.map((c) => `  ${c.name}: ${c.detail}`).join("\n")}`);
  process.exit(1);
}
console.log(`screenshots in ${OUT_DIR}/`);
