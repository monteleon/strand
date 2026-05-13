import { firefox } from "playwright";
import { mkdirSync } from "node:fs";

const ROOT = "http://localhost:3000";
const OUT_DIR = "/tmp/strand-verify";
mkdirSync(OUT_DIR, { recursive: true });

type RouteCheck = {
  path: string;
  expectSelector: string;
  expectText: string;
};

const checks: RouteCheck[] = [
  { path: "/upload", expectSelector: '[data-testid="upload-dropzone"]', expectText: "Drop your LinkedIn .zip here" },
  { path: "/profile", expectSelector: '[data-testid="profile-name"]', expectText: "Matt Alexander" },
];

const browser = await firefox.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const allPageErrors: { route: string; err: string }[] = [];
const allConsole: { route: string; msg: string }[] = [];
const allNetwork: { route: string; url: string; method: string }[] = [];

page.on("pageerror", (err) =>
  allPageErrors.push({ route: currentRoute, err: err.message }),
);
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") {
    allConsole.push({ route: currentRoute, msg: `${msg.type()}: ${msg.text()}` });
  }
});
page.on("request", (req) => {
  allNetwork.push({ route: currentRoute, url: req.url(), method: req.method() });
});

let currentRoute = "";
const routeResults: Array<{
  path: string;
  status: number | null;
  selectorFound: boolean;
  textFound: boolean;
  screenshot: string;
}> = [];

for (const check of checks) {
  currentRoute = check.path;
  const url = `${ROOT}${check.path}`;
  const resp = await page.goto(url, { waitUntil: "networkidle" });
  const screenshot = `${OUT_DIR}${check.path.replace(/\//g, "_")}.png`;
  await page.screenshot({ path: screenshot, fullPage: true });
  const selectorFound = (await page.locator(check.expectSelector).count()) > 0;
  const html = await page.content();
  const textFound = html.includes(check.expectText);
  routeResults.push({
    path: check.path,
    status: resp?.status() ?? null,
    selectorFound,
    textFound,
    screenshot,
  });
}

await browser.close();

// Anti-criterion ISC-36: every network request must be localhost / 127.0.0.1
const nonLocal = allNetwork.filter(
  (r) =>
    !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(r.url) &&
    !r.url.startsWith("data:") &&
    !r.url.startsWith("about:"),
);

const report = {
  routes: routeResults,
  pageerrors: allPageErrors,
  console_errors_warnings: allConsole,
  total_network_requests: allNetwork.length,
  non_local_requests: nonLocal,
};
console.log(JSON.stringify(report, null, 2));

const allOk =
  allPageErrors.length === 0 &&
  nonLocal.length === 0 &&
  routeResults.every((r) => r.status === 200 && r.selectorFound && r.textFound);
if (!allOk) {
  console.error("UI VERIFY FAILED");
  process.exit(1);
}
console.error("UI VERIFY PASSED");
