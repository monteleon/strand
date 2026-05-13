import { firefox } from "playwright";
import { createClient } from "@libsql/client";

const ROOT = "http://localhost:3000";

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`[${ok ? "✓" : "✗"}] ${name} — ${detail}`);
}

// Pick a couple of stable person ids from DB to drive detail-page + manual-edge probes.
const db = createClient({ url: "file:data/strand.db" });
const ownerRow = await db.execute("SELECT owner_person_id FROM tenants WHERE id='local'");
const ownerId = ownerRow.rows[0].owner_person_id as string;
const twoPeople = await db.execute({
  sql: "SELECT id, full_name FROM people WHERE tenant_id='local' AND id != ? ORDER BY full_name LIMIT 2",
  args: [ownerId],
});
const alice = twoPeople.rows[0] as unknown as { id: string; full_name: string };
const bob = twoPeople.rows[1] as unknown as { id: string; full_name: string };

// Clear any pre-existing manual edges for a clean test
await db.execute("DELETE FROM manual_edges WHERE tenant_id='local'");
db.close();

// --- HTTP probes ---
async function http(path: string, init?: RequestInit) {
  const res = await fetch(`${ROOT}${path}`, init);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}

// ISC-49,50,51,52,53: /people list, owner excluded, filter, pagination, links
{
  const r1 = await http("/people");
  const total = (r1.text.match(/<p[^>]*>(\d{1,3},?\d{0,3})<!-- --> <!-- -->people/)?.[1] ?? "").replace(",", "");
  record("ISC-49+50 /people lists non-owner count", r1.status === 200 && total === "1796", `status=${r1.status} total=${total}`);
  record("ISC-53 row has /people/<id> link", r1.text.includes('href="/people/'), "regex check");
  const r2 = await http("/people?page=2");
  // React's RSC stream inserts comment markers between adjacent text nodes,
  // so "Page 2 of 36" appears as "Page <!-- -->2<!-- --> of <!-- -->36".
  // Strip HTML tags + comments before matching.
  const plain = r2.text.replace(/<!--[^>]*-->/g, "").replace(/<[^>]+>/g, " ");
  const onPage2 = /Page\s+2\s+of\s+\d+/.test(plain);
  record("ISC-52 ?page=2 nav text present", r2.status === 200 && onPage2, `status=${r2.status} onPage2=${onPage2}`);
  const r3 = await http("/people?q=garcia");
  const garciaFilter = r3.text.toLowerCase().includes("garcia");
  record("ISC-51 ?q=garcia filter renders", r3.status === 200 && garciaFilter, `status=${r3.status}`);
  // ISC-60 SQL injection probe
  const evil = await http(`/people?q=${encodeURIComponent("' OR 1=1 --")}`);
  record("ISC-60 SQL injection probe safe", evil.status === 200, `status=${evil.status}`);
}

// ISC-54,55,56: /companies
{
  const r1 = await http("/companies");
  record("ISC-54 /companies renders", r1.status === 200 && r1.text.includes("companies-list"), `status=${r1.status}`);
  const r2 = await http("/companies?q=pwc");
  const hasPwc = /pwc/i.test(r2.text);
  record("ISC-55 ?q=pwc filter renders", r2.status === 200 && hasPwc, `status=${r2.status}`);
  const r3 = await http("/companies?page=2");
  record("ISC-56 ?page=2 status ok", r3.status === 200, `status=${r3.status}`);
}

// ISC-57,58: /people/[id], 404 on bogus
{
  const r1 = await http(`/people/${encodeURIComponent(alice.id)}`);
  record("ISC-57 /people/[id] renders", r1.status === 200 && r1.text.includes(alice.full_name), `status=${r1.status}`);
  const r2 = await http("/people/nonexistent-id-xyz");
  record("ISC-58 /people/<bogus> returns 404", r2.status === 404, `status=${r2.status}`);
}

// ISC-59: /companies/[id]
{
  // pick first company id
  const cdb = createClient({ url: "file:data/strand.db" });
  const c = await cdb.execute("SELECT id, name FROM companies WHERE tenant_id='local' LIMIT 1");
  cdb.close();
  const company = c.rows[0] as unknown as { id: string; name: string };
  const r = await http(`/companies/${encodeURIComponent(company.id)}`);
  record("ISC-59 /companies/[id] renders", r.status === 200 && r.text.includes(company.name), `status=${r.status} name=${company.name}`);
}

// ISC-41,45,46: POST /api/edges/manual create + validation
{
  // Create
  const r1 = await http("/api/edges/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ person_a_id: alice.id, person_b_id: bob.id, note: "test edge" }),
  });
  record("ISC-41 POST creates edge → 201", r1.status === 201 && r1.json?.existing === false, `status=${r1.status}`);
  // ISC-48: re-POST same → 200 existing:true
  const r2 = await http("/api/edges/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ person_a_id: alice.id, person_b_id: bob.id }),
  });
  record("ISC-48 POST same edge → 200 existing:true", r2.status === 200 && r2.json?.existing === true, `status=${r2.status}`);
  // ISC-40 canonicalisation: POST (bob, alice) should also return existing:true
  const r3 = await http("/api/edges/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ person_a_id: bob.id, person_b_id: alice.id }),
  });
  record("ISC-40 POST reverse pair → same canonical edge", r3.status === 200 && r3.json?.existing === true, `status=${r3.status}`);
  // ISC-45: self-edge → 400
  const r4 = await http("/api/edges/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ person_a_id: alice.id, person_b_id: alice.id }),
  });
  record("ISC-45 POST self-edge → 400", r4.status === 400, `status=${r4.status}`);
  // ISC-46: nonexistent → 400
  const r5 = await http("/api/edges/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ person_a_id: alice.id, person_b_id: "no-such-id" }),
  });
  record("ISC-46 POST nonexistent person → 400", r5.status === 400, `status=${r5.status}`);
}

// ISC-43,44: person-detail shows manual edge
{
  const r = await http(`/people/${encodeURIComponent(alice.id)}`);
  const showsBob = r.text.includes(bob.full_name);
  const showsAddUi = r.text.includes('data-testid="add-connection"');
  record("ISC-43 person-detail shows add-connection UI", r.status === 200 && showsAddUi, `status=${r.status} addUi=${showsAddUi}`);
  record("ISC-44 person-detail lists manual edges", r.status === 200 && showsBob, `status=${r.status} showsBob=${showsBob}`);
}

// ISC-42: DELETE
{
  const r1 = await http("/api/edges/manual", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ person_a_id: alice.id, person_b_id: bob.id }),
  });
  record("ISC-42 DELETE existing edge → 204", r1.status === 204, `status=${r1.status}`);
  const r2 = await http("/api/edges/manual", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ person_a_id: alice.id, person_b_id: bob.id }),
  });
  record("ISC-42 DELETE nonexistent edge → 404", r2.status === 404, `status=${r2.status}`);
}

// ISC-47: no combined edges query that unions manual+derived
{
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  async function* walk(dir: string): AsyncGenerator<string> {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) yield* walk(full);
      else if (/\.(ts|tsx)$/.test(e.name)) yield full;
    }
  }
  const bad: string[] = [];
  for await (const f of walk("src")) {
    const text = await fs.readFile(f, "utf8");
    if (/manual_edges.*union.*derived_edges/i.test(text) ||
        /derived_edges.*union.*manual_edges/i.test(text)) {
      bad.push(f);
    }
  }
  record("ISC-47 no UNION of manual_edges and derived_edges", bad.length === 0, `${bad.length} bad files`);
}

// --- Playwright probe: visit each new route, no pageerrors, no non-local network ---
{
  const browser = await firefox.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(e.message));
  const nonLocal: string[] = [];
  page.on("request", (req) => {
    const u = req.url();
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) &&
        !u.startsWith("data:") && !u.startsWith("about:")) {
      nonLocal.push(u);
    }
  });
  for (const path of ["/people", "/companies", `/people/${alice.id}`]) {
    await page.goto(`${ROOT}${path}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: `/tmp/strand-w3${path.replace(/\//g, "_")}.png`, fullPage: true });
  }
  await browser.close();
  record("Playwright: no pageerrors across new routes", errs.length === 0, `errs=${errs.length}`);
  record("ISC-36 (reaffirmed): no non-local network during browse", nonLocal.length === 0, `nonLocal=${nonLocal.length}`);
}

const failed = results.filter((r) => !r.ok);
console.log();
console.log(`SUMMARY: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log("FAILED:");
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
