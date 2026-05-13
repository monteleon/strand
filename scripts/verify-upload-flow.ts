// Exercise /upload's success and duplicate panels by driving a real upload
// through the browser. DB is expected to have the export already ingested
// (so the first upload exercises the duplicate path); we then clear and
// re-upload to exercise the success path.
import { firefox } from "playwright";
import { createClient } from "@libsql/client";

const ZIP_PATH = "/mnt/c/Users/mca/Downloads/Basic_LinkedInDataExport_05-12-2026.zip.zip";

async function clearDb() {
  const c = createClient({ url: "file:data/strand.db" });
  // Retry on SQLITE_BUSY — dev server may hold WAL locks briefly.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await c.execute("BEGIN IMMEDIATE");
      await c.execute("DELETE FROM connections");
      await c.execute("DELETE FROM positions");
      await c.execute("DELETE FROM people");
      await c.execute("DELETE FROM companies");
      await c.execute("DELETE FROM export_batches");
      await c.execute("UPDATE tenants SET owner_person_id=NULL WHERE id='local'");
      await c.execute("COMMIT");
      c.close();
      return;
    } catch (e) {
      try {
        await c.execute("ROLLBACK");
      } catch {}
      if (attempt === 9) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

const browser = await firefox.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(e.message));

// Step 1: clear DB, upload via UI, expect success panel
await clearDb();
await page.goto("http://localhost:3000/upload");
await page.locator('input[type="file"]').setInputFiles(ZIP_PATH);
await page.locator('[data-testid="result-success"]').waitFor({ timeout: 240000 });
const successText = await page.locator('[data-testid="result-success"]').innerText();

// Step 2: upload same file again, expect duplicate panel
await page.goto("http://localhost:3000/upload");
await page.locator('input[type="file"]').setInputFiles(ZIP_PATH);
await page.locator('[data-testid="result-info"]').waitFor({ timeout: 240000 });
const duplicateText = await page.locator('[data-testid="result-info"]').innerText();

await page.screenshot({ path: "/tmp/strand-verify_upload_duplicate.png", fullPage: true });

await browser.close();

const out = {
  pageerrors: errs,
  success_panel: successText,
  duplicate_panel: duplicateText,
};
console.log(JSON.stringify(out, null, 2));

const ok =
  errs.length === 0 &&
  /Imported/i.test(successText) &&
  /People/i.test(successText) &&
  /1,?797/.test(successText) &&
  /Already imported/i.test(duplicateText) &&
  /1,?796/.test(duplicateText);
if (!ok) {
  console.error("UPLOAD FLOW VERIFY FAILED");
  process.exit(1);
}
console.error("UPLOAD FLOW VERIFY PASSED");
