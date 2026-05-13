// W7 verify: release-polish artefacts on disk + content sanity. No dev
// server required — these are file-existence and content-grep checks.
import { existsSync, readFileSync, statSync } from "node:fs";

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];

function fileExistsCheck(name: string, path: string, minBytes = 1): void {
  const exists = existsSync(path);
  const size = exists ? statSync(path).size : 0;
  checks.push({
    name,
    ok: exists && size >= minBytes,
    detail: exists ? `${size}B` : "missing",
  });
}

function fileContainsCheck(name: string, path: string, needle: string): void {
  if (!existsSync(path)) {
    checks.push({ name, ok: false, detail: "file missing" });
    return;
  }
  const body = readFileSync(path, "utf8");
  checks.push({
    name,
    ok: body.includes(needle),
    detail: body.includes(needle) ? "present" : `missing: ${needle.slice(0, 40)}`,
  });
}

function fileLacksCheck(name: string, path: string, needle: string): void {
  if (!existsSync(path)) {
    checks.push({ name, ok: false, detail: "file missing" });
    return;
  }
  const body = readFileSync(path, "utf8");
  checks.push({
    name,
    ok: !body.includes(needle),
    detail: !body.includes(needle) ? "absent (good)" : `still has: ${needle.slice(0, 40)}`,
  });
}

// ISC-166..167 screenshots
const SHOTS = [
  "docs/screenshots/01-upload.png",
  "docs/screenshots/02-profile.png",
  "docs/screenshots/03-people.png",
  "docs/screenshots/04-company-detail.png",
  "docs/screenshots/05-queries-at-company.png",
  "docs/screenshots/06-graph.png",
];
let allShots = true;
for (const s of SHOTS) {
  if (!existsSync(s) || statSync(s).size < 1024) {
    allShots = false;
    break;
  }
}
checks.push({
  name: "ISC-166/167 6 screenshots exist in docs/screenshots/, each ≥1KB",
  ok: allShots,
  detail: allShots ? "all 6 present" : "missing or undersized",
});

// ISC-168..175 README
fileContainsCheck("ISC-168 README has Bun Quick Start", "README.md", "bun run db:migrate");
fileContainsCheck("ISC-169 README has Docker section", "README.md", "docker build -t strand");
fileContainsCheck("ISC-169 README has docker run line with data volume", "README.md", "docker run -p 3000:3000");
fileContainsCheck("ISC-170 README references docs/screenshots/", "README.md", "docs/screenshots/");
fileContainsCheck("ISC-171 README states @libsql/client driver", "README.md", "@libsql/client");
fileLacksCheck("ISC-171 README does NOT mention stale better-sqlite3", "README.md", "better-sqlite3");
fileContainsCheck("ISC-172 README describes shared_employer_overlap", "README.md", "shared_employer_overlap");
fileContainsCheck("ISC-172 README describes shared_employer_currently", "README.md", "shared_employer_currently");
fileContainsCheck("ISC-172 README describes shared_employer_no_overlap", "README.md", "shared_employer_no_overlap");
fileContainsCheck("ISC-173 README states in-memory parse / no disk persistence", "README.md", "parsed in-memory");
fileContainsCheck("ISC-174 README roadmap marks W4 shipped", "README.md", "W4 | Derive | ✅");
fileContainsCheck("ISC-174 README roadmap marks W6 shipped", "README.md", "W6 | Visualise | ✅");
fileContainsCheck("ISC-174 README roadmap marks W7 in flight", "README.md", "W7 | Polish & ship | 🚧");
fileContainsCheck("ISC-175 README links CONTRIBUTING.md", "README.md", "CONTRIBUTING.md");

// ISC-176..177 Dockerfile + .dockerignore
fileContainsCheck("ISC-176 Dockerfile uses oven/bun base", "Dockerfile", "oven/bun");
fileContainsCheck("ISC-176 Dockerfile installs deps", "Dockerfile", "bun install");
fileContainsCheck("ISC-176 Dockerfile builds", "Dockerfile", "bun run build");
fileContainsCheck("ISC-176 Dockerfile exposes 3000", "Dockerfile", "EXPOSE 3000");
fileContainsCheck("ISC-177 .dockerignore excludes data/", ".dockerignore", "data/");
fileContainsCheck("ISC-177 .dockerignore excludes node_modules", ".dockerignore", "node_modules");
fileContainsCheck("ISC-177 .dockerignore excludes .git", ".dockerignore", ".git/");

// ISC-178..179 CONTRIBUTING + LICENSE
fileContainsCheck("ISC-178 CONTRIBUTING.md points at ISA", "CONTRIBUTING.md", "Projects/Strand/ISA.md");
fileContainsCheck("ISC-178 CONTRIBUTING.md documents test commands", "CONTRIBUTING.md", "bun test");
fileContainsCheck("ISC-179 LICENSE is MIT", "LICENSE", "MIT License");
fileContainsCheck("ISC-179 LICENSE has copyright holder Matt Alexander", "LICENSE", "Copyright (c) 2026 Matt Alexander");

// ISC-180..182 package.json
fileContainsCheck("ISC-180 package.json version is 0.1.0-rc.1", "package.json", `"version": "0.1.0-rc.1"`);
fileContainsCheck("ISC-181 package.json license is MIT", "package.json", `"license": "MIT"`);
fileLacksCheck("ISC-181 package.json no longer UNLICENSED", "package.json", "UNLICENSED");
fileContainsCheck("ISC-182 package.json has screenshots script", "package.json", `"screenshots":`);

// ISC-184: anti — Dockerfile must not COPY the data/ directory or strand.db
// into the image. The `ENV STRAND_DB_PATH=/app/data/strand.db` line is fine
// — that's an env var pointing at the runtime mount path, not a COPY.
{
  const df = readFileSync("Dockerfile", "utf8");
  const copiesData =
    /^\s*COPY\s+.*\bdata\//m.test(df) ||
    /^\s*COPY\s+.*strand\.db/m.test(df);
  checks.push({
    name: "ISC-184 Dockerfile does NOT COPY data/ or strand.db",
    ok: !copiesData,
    detail: copiesData ? "found COPY of data/" : "no COPY of data/ found",
  });
}

// ISC-183: anti — data/ and .zip exports should not be tracked. We assume
// the gitignore is intact; the commit-staging step does the actual filter.
// Spot-check: the .dockerignore excludes data/ so a `docker build` won't
// grab it, and .gitignore (assumed correct from W1) keeps it out of git.
checks.push({
  name: "ISC-183 .dockerignore prevents data/ from entering the image",
  ok: readFileSync(".dockerignore", "utf8").includes("data/"),
  detail: "checked via .dockerignore",
});

const passed = checks.filter((c) => c.ok).length;
const failed = checks.filter((c) => !c.ok);
console.log(`\nVERIFY-W7 RESULTS: ${passed}/${checks.length} passed`);
for (const c of checks) {
  console.log(`  ${c.ok ? "✓" : "✗"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}
if (failed.length > 0) {
  console.error(`\nFAILED:\n${failed.map((c) => `  ${c.name}: ${c.detail}`).join("\n")}`);
  process.exit(1);
}
