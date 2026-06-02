import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Subprocess pattern: ingest writes to the DB, and the rest of the test suite
// runs against the real `data/strand.db`. Running ingest in-process would
// contaminate that DB. Each test below spawns a fresh subprocess with
// STRAND_DB_PATH pointing at a per-test temp file, migrates it, runs the
// ingest scenario, prints a result line prefixed with __INGEST_TEST_RESULT__,
// and exits. The test process only parses and asserts on that line.

const REPO_ROOT = "/mnt/c/Users/mca/Projects/Strand";
const REAL_EXPORT_PATH =
  "/mnt/c/Users/mca/Downloads/Basic_LinkedInDataExport_05-12-2026.zip.zip";
const RESULT_MARKER = "__INGEST_TEST_RESULT__";

async function freshDbWithMigrations(): Promise<{ dbPath: string; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "strand-ingest-test-"));
  const dbPath = join(dir, "test.db");
  const proc = Bun.spawn(["bun", "run", "src/lib/db/migrate.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, STRAND_DB_PATH: dbPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`migrate failed (${exitCode}):\n${stderr}`);
  }
  return {
    dbPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function runSubprocessScript<T = unknown>(
  dbPath: string,
  script: string,
): Promise<T> {
  const proc = Bun.spawn(["bun", "-e", script], {
    cwd: REPO_ROOT,
    env: { ...process.env, STRAND_DB_PATH: dbPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  if (exitCode !== 0) {
    throw new Error(
      `subprocess exited ${exitCode}\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`,
    );
  }
  const line = stdout
    .split("\n")
    .reverse()
    .find((l) => l.startsWith(RESULT_MARKER));
  if (!line) {
    throw new Error(
      `no ${RESULT_MARKER} line in subprocess stdout:\n${stdout}\nSTDERR:\n${stderr}`,
    );
  }
  return JSON.parse(line.slice(RESULT_MARKER.length)) as T;
}

type IngestCounts = {
  people: number;
  companies: number;
  positions: number;
  connections: number;
  messages: number;
};

type IngestResult = {
  batchId: string;
  duplicate: boolean;
  counts: IngestCounts;
  messageStats?: {
    parsed: number;
    expanded: number;
    skipped_no_url: number;
    skipped_no_date: number;
    skipped_no_person: number;
    inserted: number;
  };
};

describe("ingestLinkedInExport — fresh ingest from real export", () => {
  let result: IngestResult;
  let invariants: {
    ownerExists: boolean;
    ownerLinkedinUrlBackfilled: boolean;
    ownerInToPersonId: number;
    declaredPositions: number;
    synthesisedPositions: number;
    placeholderCompanies: number;
    personIdShape: string;
  };
  let cleanup: () => void;

  beforeAll(async () => {
    const fresh = await freshDbWithMigrations();
    cleanup = fresh.cleanup;
    const data = await runSubprocessScript<{
      result: IngestResult;
      invariants: typeof invariants;
    }>(
      fresh.dbPath,
      `
        const { readFile } = await import("node:fs/promises");
        const { ingestLinkedInExport } = await import(
          "${REPO_ROOT}/src/lib/linkedin/ingest.ts"
        );
        const { db, schema, LOCAL_TENANT_ID } = await import(
          "${REPO_ROOT}/src/lib/db/index.ts"
        );
        const { eq, sql } = await import("drizzle-orm");

        const bytes = await readFile(${JSON.stringify(REAL_EXPORT_PATH)});
        const result = await ingestLinkedInExport(Buffer.from(bytes), "real.zip");

        // Pull durable invariants from the DB we just wrote to.
        const tenants = await db
          .select()
          .from(schema.tenants)
          .where(eq(schema.tenants.id, LOCAL_TENANT_ID));
        const ownerId = tenants[0]?.ownerPersonId;
        const ownerRows = ownerId
          ? await db
              .select()
              .from(schema.people)
              .where(eq(schema.people.id, ownerId))
          : [];
        const ownerExists = ownerRows.length === 1;
        const ownerLinkedinUrlBackfilled =
          ownerExists && ownerRows[0].linkedinUrl !== null;

        const ownerInTo = ownerId
          ? await db.all(sql\`
              SELECT COUNT(*) AS c FROM connections
              WHERE tenant_id = \${LOCAL_TENANT_ID}
                AND to_person_id = \${ownerId}
            \`)
          : [{ c: 0 }];

        const declared = await db.all(sql\`
          SELECT COUNT(*) AS c FROM positions
          WHERE tenant_id = \${LOCAL_TENANT_ID} AND origin = 'declared'
        \`);
        const synth = await db.all(sql\`
          SELECT COUNT(*) AS c FROM positions
          WHERE tenant_id = \${LOCAL_TENANT_ID} AND origin = 'synthesised'
        \`);

        // Placeholder companies should never make it past the filter.
        const placeholder = await db.all(sql\`
          SELECT COUNT(*) AS c FROM companies
          WHERE tenant_id = \${LOCAL_TENANT_ID}
            AND normalized_name IN ('---', 'n/a', '—', '-', '')
        \`);

        const sampleIds = await db
          .select({ id: schema.people.id })
          .from(schema.people)
          .limit(1);

        const invariants = {
          ownerExists,
          ownerLinkedinUrlBackfilled,
          ownerInToPersonId: Number(ownerInTo[0]?.c ?? 0),
          declaredPositions: Number(declared[0]?.c ?? 0),
          synthesisedPositions: Number(synth[0]?.c ?? 0),
          placeholderCompanies: Number(placeholder[0]?.c ?? 0),
          personIdShape: sampleIds[0]?.id ?? "",
        };

        console.log("${RESULT_MARKER}" + JSON.stringify({ result, invariants }));
      `,
    );
    result = data.result;
    invariants = data.invariants;
  }, 180_000);

  // --- result-shape assertions (ISC-401..407) ---

  test("ISC-401: duplicate flag is false on a fresh ingest", () => {
    expect(result.duplicate).toBe(false);
  });

  test("ISC-402: batchId is a non-empty string", () => {
    expect(typeof result.batchId).toBe("string");
    expect(result.batchId.length).toBeGreaterThan(0);
  });

  test("ISC-403: counts.people > 1500 (owner + real connections)", () => {
    expect(result.counts.people).toBeGreaterThan(1500);
    expect(result.counts.people).toBeLessThan(2500);
  });

  test("ISC-404: counts.companies > 100 (real export has 1k+ employers)", () => {
    expect(result.counts.companies).toBeGreaterThan(100);
  });

  test("ISC-405: counts.positions and counts.connections > 0", () => {
    expect(result.counts.positions).toBeGreaterThan(0);
    expect(result.counts.connections).toBeGreaterThan(1500);
  });

  test("ISC-406: counts.messages > 0 (real export has messages.csv)", () => {
    expect(result.counts.messages).toBeGreaterThan(0);
  });

  test("ISC-407: messageStats defined on fresh ingest with messages.csv", () => {
    expect(result.messageStats).toBeDefined();
    expect(result.messageStats!.inserted).toBeGreaterThan(0);
    expect(result.messageStats!.inserted).toBe(result.counts.messages);
  });

  // --- durable invariants in the DB (ISC-408..414) ---

  test("ISC-408: owner row exists in people after ingest", () => {
    expect(invariants.ownerExists).toBe(true);
  });

  test("ISC-409: owner.linkedinUrl is backfilled from messages.csv FROM detection", () => {
    expect(invariants.ownerLinkedinUrlBackfilled).toBe(true);
  });

  test("ISC-410: owner never appears as to_person_id in connections (ISC-38 in project)", () => {
    expect(invariants.ownerInToPersonId).toBe(0);
  });

  test("ISC-411: at least one declared position exists (from Positions.csv)", () => {
    expect(invariants.declaredPositions).toBeGreaterThan(0);
  });

  test("ISC-412: synthesised positions exist (from Connections.csv company text)", () => {
    expect(invariants.synthesisedPositions).toBeGreaterThan(0);
  });

  test("ISC-413: placeholder companies are filtered (no rows with '---', 'n/a', etc.)", () => {
    expect(invariants.placeholderCompanies).toBe(0);
  });

  test("ISC-414: person.id is a 40-char hex sha1 (deterministic ID shape)", () => {
    expect(invariants.personIdShape).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("ingestLinkedInExport — duplicate detection (ISC-16 shortcut)", () => {
  let first: IngestResult;
  let second: IngestResult;
  let cleanup: () => void;

  beforeAll(async () => {
    const fresh = await freshDbWithMigrations();
    cleanup = fresh.cleanup;
    const data = await runSubprocessScript<{
      first: IngestResult;
      second: IngestResult;
    }>(
      fresh.dbPath,
      `
        const { readFile } = await import("node:fs/promises");
        const { ingestLinkedInExport } = await import(
          "${REPO_ROOT}/src/lib/linkedin/ingest.ts"
        );
        const bytes = await readFile(${JSON.stringify(REAL_EXPORT_PATH)});
        const first = await ingestLinkedInExport(Buffer.from(bytes), "real.zip");
        const second = await ingestLinkedInExport(Buffer.from(bytes), "real.zip");
        console.log("${RESULT_MARKER}" + JSON.stringify({ first, second }));
      `,
    );
    first = data.first;
    second = data.second;
  }, 240_000);

  test("ISC-415: first ingest is not duplicate", () => {
    expect(first.duplicate).toBe(false);
  });

  test("ISC-416: second ingest of same bytes returns duplicate=true", () => {
    expect(second.duplicate).toBe(true);
  });

  test("ISC-417: duplicate returns the same batchId as the original", () => {
    expect(second.batchId).toBe(first.batchId);
  });

  test("ISC-418: counts are unchanged after duplicate (no new writes)", () => {
    expect(second.counts).toEqual(first.counts);
  });

  test("ISC-419: duplicate path omits messageStats (shortcut returns early)", () => {
    expect(second.messageStats).toBeUndefined();
  });
});

describe("writeOwner — rename re-ingest preserves owner id (v0.4.2)", () => {
  let result: {
    firstOwnerId: string;
    secondOwnerId: string;
    idsMatch: boolean;
    peopleRowCount: number;
    ownerFullName: string;
    ownerHeadline: string | null;
    connectionResolvesToOwner: boolean;
  };
  let cleanup: () => void;

  beforeAll(async () => {
    const fresh = await freshDbWithMigrations();
    cleanup = fresh.cleanup;
    result = await runSubprocessScript(
      fresh.dbPath,
      `
        const { db, schema, LOCAL_TENANT_ID } = await import(
          "${REPO_ROOT}/src/lib/db/index.ts"
        );
        const { writeOwner } = await import(
          "${REPO_ROOT}/src/lib/linkedin/ingest.ts"
        );
        const { eq } = await import("drizzle-orm");
        const tenantId = LOCAL_TENANT_ID;
        const now = new Date();

        // Tenant + export-batch rows (writeOwner expects the tenant to exist;
        // people.sourceBatchId FK requires the batch rows to exist too — the
        // real ingest path creates both earlier; here we seed them directly).
        await db
          .insert(schema.tenants)
          .values({ id: tenantId, createdAt: now })
          .onConflictDoNothing();
        await db.insert(schema.exportBatches).values([
          { id: "batch-1", tenantId, source: "linkedin", uploadedAt: now, filename: "first.zip", sha256: "x".repeat(64) },
          { id: "batch-2", tenantId, source: "linkedin", uploadedAt: now, filename: "second.zip", sha256: "y".repeat(64) },
        ]);

        // First ingest: owner is "Alice Engineer".
        await writeOwner(
          { profile: { fullName: "Alice Engineer", headline: "Builder" } },
          tenantId,
          "batch-1",
          now,
        );
        const tenant1 = await db
          .select()
          .from(schema.tenants)
          .where(eq(schema.tenants.id, tenantId))
          .limit(1);
        const firstOwnerId = tenant1[0].ownerPersonId;

        // A connection pointing AT the original owner id — proxy for every
        // existing FK reference (positions.person_id, manual_edges.person_a/b,
        // messages.from_person_id) that would orphan after a rename.
        await db.insert(schema.people).values({
          id: "peer-1",
          tenantId,
          fullName: "Bob Peer",
          headline: null,
          email: null,
          linkedinUrl: "https://linkedin.com/in/bob",
          sourceBatchId: "batch-1",
          firstSeen: now,
          lastSeen: now,
        });
        await db.insert(schema.connections).values({
          tenantId,
          fromPersonId: firstOwnerId,
          toPersonId: "peer-1",
          source: "linkedin",
          connectedAt: "2024-01-01",
        });

        // Second ingest: owner renamed to "Alice Smith" (the bug scenario).
        await writeOwner(
          { profile: { fullName: "Alice Smith", headline: "Senior Engineer" } },
          tenantId,
          "batch-2",
          new Date(),
        );

        const tenant2 = await db
          .select()
          .from(schema.tenants)
          .where(eq(schema.tenants.id, tenantId))
          .limit(1);
        const secondOwnerId = tenant2[0].ownerPersonId;

        const peopleRows = await db
          .select()
          .from(schema.people)
          .where(eq(schema.people.tenantId, tenantId));

        const ownerRow = await db
          .select()
          .from(schema.people)
          .where(eq(schema.people.id, secondOwnerId))
          .limit(1);

        const conn = await db
          .select()
          .from(schema.connections)
          .where(eq(schema.connections.fromPersonId, secondOwnerId));

        console.log(
          "${RESULT_MARKER}" +
            JSON.stringify({
              firstOwnerId,
              secondOwnerId,
              idsMatch: firstOwnerId === secondOwnerId,
              peopleRowCount: peopleRows.length,
              ownerFullName: ownerRow[0]?.fullName,
              ownerHeadline: ownerRow[0]?.headline,
              connectionResolvesToOwner: conn.length === 1,
            }),
        );
      `,
    );
  }, 60_000);

  test("rename re-ingest: tenants.ownerPersonId is unchanged", () => {
    expect(result.idsMatch).toBe(true);
  });

  test("rename re-ingest: no second owner row created", () => {
    // 2 = owner + peer-1; would be 3 under the pre-fix sha1-from-name path
    expect(result.peopleRowCount).toBe(2);
  });

  test("rename re-ingest: owner row's fullName is updated to new name", () => {
    expect(result.ownerFullName).toBe("Alice Smith");
  });

  test("rename re-ingest: owner row's headline is updated", () => {
    expect(result.ownerHeadline).toBe("Senior Engineer");
  });

  test("rename re-ingest: pre-existing connection FK still resolves to owner", () => {
    expect(result.connectionResolvesToOwner).toBe(true);
  });
});

describe("writePositions — endDate corrections land via UPSERT (v0.4.6, /code-review #2)", () => {
  let result: {
    afterFirstIngest: { count: number; endDate: string | null; current: boolean };
    afterCorrectedEndDate: { count: number; endDate: string | null; current: boolean };
    afterClearedEndDate: { count: number; endDate: string | null; current: boolean };
    afterNoChange: { count: number; endDate: string | null; current: boolean };
  };
  let cleanup: () => void;

  beforeAll(async () => {
    const fresh = await freshDbWithMigrations();
    cleanup = fresh.cleanup;
    result = await runSubprocessScript(
      fresh.dbPath,
      `
        const { db, schema, LOCAL_TENANT_ID } = await import("${REPO_ROOT}/src/lib/db/index.ts");
        const { writeOwner, writePositions } = await import("${REPO_ROOT}/src/lib/linkedin/ingest.ts");
        const { eq, and } = await import("drizzle-orm");
        const now = new Date();
        const tenantId = LOCAL_TENANT_ID;

        await db.insert(schema.tenants).values({ id: tenantId, createdAt: now }).onConflictDoNothing();
        await db.insert(schema.exportBatches).values({
          id: "batch-1", tenantId, source: "linkedin", uploadedAt: now,
          filename: "x.zip", sha256: "x".repeat(64),
        });
        await writeOwner(
          { profile: { fullName: "Owner", headline: null } },
          tenantId, "batch-1", now,
        );
        // Company id must match what writePositions will compute internally:
        // sha1(tenantId|company|normalizedName). Otherwise the position FK fails.
        const { createHash } = await import("node:crypto");
        const ACME_ID = createHash("sha1").update(\`\${tenantId}|company|acme\`).digest("hex");
        await db.insert(schema.companies).values({
          id: ACME_ID, tenantId, name: "Acme", normalizedName: "acme",
        });

        // Stub ParsedExport — writePositions only touches parsed.positions.
        const basePosition = {
          companyName: "Acme",
          title: "Engineer",
          description: null,
          location: null,
          startDate: "2018-01-01",
          endDate: "2024-01-01",
          current: false,
        };
        const parsedWith = (overrides) => ({
          profile: { fullName: "Owner", headline: null },
          connections: [],
          messages: [],
          ownerProfileUrl: null,
          messagesParseStats: { parsed: 0, expanded: 0, skipped_no_url: 0, skipped_no_date: 0 },
          positions: [{ ...basePosition, ...overrides }],
        });

        const readPositions = async () => {
          const rows = await db.select().from(schema.positions).where(eq(schema.positions.tenantId, tenantId));
          return {
            count: rows.length,
            endDate: rows[0]?.endDate ?? null,
            current: Boolean(rows[0]?.current),
          };
        };

        // 1. First ingest — original endDate "2024-01-01", current=false.
        await writePositions(parsedWith({}), tenantId);
        const afterFirstIngest = await readPositions();

        // 2. Re-ingest with the corrected endDate "2024-06-01" — the bug case.
        //    Pre-fix: onConflictDoNothing dropped the correction silently.
        //    Post-fix: UPSERT sets endDate to "2024-06-01".
        await writePositions(parsedWith({ endDate: "2024-06-01" }), tenantId);
        const afterCorrectedEndDate = await readPositions();

        // 3. Re-ingest with endDate CLEARED (now current). UPSERT updates both
        //    endDate=null AND current=true.
        await writePositions(parsedWith({ endDate: null, current: true }), tenantId);
        const afterClearedEndDate = await readPositions();

        // 4. Re-ingest with no change — must remain ONE row (no duplication).
        await writePositions(parsedWith({ endDate: null, current: true }), tenantId);
        const afterNoChange = await readPositions();

        console.log("${RESULT_MARKER}" + JSON.stringify({
          afterFirstIngest, afterCorrectedEndDate, afterClearedEndDate, afterNoChange,
        }));
      `,
    );
  }, 60_000);

  test("first ingest: 1 row, original endDate", () => {
    expect(result.afterFirstIngest.count).toBe(1);
    expect(result.afterFirstIngest.endDate).toBe("2024-01-01");
    expect(result.afterFirstIngest.current).toBe(false);
  });

  test("corrected endDate re-ingest: 1 row (not 2), endDate updated", () => {
    // Pre-fix: count would still be 1 but endDate stayed "2024-01-01" (silent drop)
    expect(result.afterCorrectedEndDate.count).toBe(1);
    expect(result.afterCorrectedEndDate.endDate).toBe("2024-06-01");
    expect(result.afterCorrectedEndDate.current).toBe(false);
  });

  test("cleared endDate re-ingest (now current): endDate null AND current=true", () => {
    expect(result.afterClearedEndDate.count).toBe(1);
    expect(result.afterClearedEndDate.endDate).toBeNull();
    expect(result.afterClearedEndDate.current).toBe(true);
  });

  test("idempotent re-ingest: same values stay one row, same values", () => {
    expect(result.afterNoChange.count).toBe(1);
    expect(result.afterNoChange.endDate).toBeNull();
    expect(result.afterNoChange.current).toBe(true);
  });
});

describe("v0.4.17 (review-#5): writeCompanies / writePeople / writeConnections UPSERT mutable fields on re-ingest", () => {
  let result: {
    companyAfterFirst:   { count: number; name: string | null };
    companyAfterRename:  { count: number; name: string | null };
    personAfterFirst:    { count: number; fullName: string; headline: string | null; email: string | null };
    personAfterCorrect:  { count: number; fullName: string; headline: string | null; email: string | null };
    connAfterFirst:      { count: number; connectedAt: string | null };
    connAfterCorrect:    { count: number; connectedAt: string | null };
  };
  let cleanup: () => void;

  beforeAll(async () => {
    const fresh = await freshDbWithMigrations();
    cleanup = fresh.cleanup;
    result = await runSubprocessScript(
      fresh.dbPath,
      `
        const { db, schema, LOCAL_TENANT_ID } = await import("${REPO_ROOT}/src/lib/db/index.ts");
        const { writeOwner, writeCompanies, writePeople, writeConnections } =
          await import("${REPO_ROOT}/src/lib/linkedin/ingest.ts");
        const { eq, and } = await import("drizzle-orm");
        const { createHash } = await import("node:crypto");
        const now = new Date();
        const tenantId = LOCAL_TENANT_ID;

        await db.insert(schema.tenants).values({ id: tenantId, createdAt: now }).onConflictDoNothing();
        await db.insert(schema.exportBatches).values({
          id: "batch-1", tenantId, source: "linkedin", uploadedAt: now,
          filename: "x.zip", sha256: "x".repeat(64),
        });
        await writeOwner(
          { profile: { fullName: "Owner", headline: null } },
          tenantId, "batch-1", now,
        );

        // -------- writeCompanies UPSERT --------
        // First ingest: company display name "PWC" (all caps).
        // Second ingest: corrected casing "PwC España". normaliseCompany
        // strips diacritics and lowercases, so "PWC" → "pwc" and
        // "PwC España" → "pwc espana" → DIFFERENT id (two rows).
        // For a UPSERT to fire we need the same normalized name. Use a
        // pure casing/whitespace difference instead:
        //   "PwC España" and "pwc  españa" both normalise to "pwc espana".
        const parsedCompanies = (raw) => ({
          profile: { fullName: "Owner", headline: null },
          connections: [],
          positions: [{
            companyName: raw, title: "X", description: null, location: null,
            startDate: "2020-01-01", endDate: null, current: true,
          }],
          messages: [],
          ownerProfileUrl: null,
          messagesParseStats: { parsed: 0, expanded: 0, skipped_no_url: 0, skipped_no_date: 0 },
        });
        await writeCompanies(parsedCompanies("pwc  españa"), tenantId);
        const companyAfterFirst = await (async () => {
          const rows = await db.select().from(schema.companies).where(eq(schema.companies.tenantId, tenantId));
          return { count: rows.length, name: rows[0]?.name ?? null };
        })();

        await writeCompanies(parsedCompanies("PwC España"), tenantId);
        const companyAfterRename = await (async () => {
          const rows = await db.select().from(schema.companies).where(eq(schema.companies.tenantId, tenantId));
          return { count: rows.length, name: rows[0]?.name ?? null };
        })();

        // -------- writePeople UPSERT --------
        // First ingest: connection Alice with headline "Engineer", no email.
        // Second ingest: corrected headline "Senior Engineer" + email added.
        const parsedPeople = (overrides) => ({
          profile: { fullName: "Owner", headline: null },
          connections: [{
            linkedinUrl: "https://www.linkedin.com/in/alice",
            fullName: "Alice",
            firstName: "Alice",
            lastName: "",
            position: "Engineer",
            company: null,
            email: null,
            connectedAt: "2020-01-01",
            ...overrides,
          }],
          positions: [],
          messages: [],
          ownerProfileUrl: null,
          messagesParseStats: { parsed: 0, expanded: 0, skipped_no_url: 0, skipped_no_date: 0 },
        });
        await writePeople(parsedPeople({}), tenantId, "batch-1", now);
        const personAfterFirst = await (async () => {
          const rows = await db.select().from(schema.people).where(eq(schema.people.tenantId, tenantId));
          const alice = rows.find((r) => r.fullName === "Alice");
          return {
            count: rows.length,
            fullName: alice?.fullName ?? "",
            headline: alice?.headline ?? null,
            email: alice?.email ?? null,
          };
        })();

        await writePeople(
          parsedPeople({ position: "Senior Engineer", email: "alice@example.com" }),
          tenantId, "batch-1", now,
        );
        const personAfterCorrect = await (async () => {
          const rows = await db.select().from(schema.people).where(eq(schema.people.tenantId, tenantId));
          const alice = rows.find((r) => r.fullName === "Alice");
          return {
            count: rows.length,
            fullName: alice?.fullName ?? "",
            headline: alice?.headline ?? null,
            email: alice?.email ?? null,
          };
        })();

        // -------- writeConnections UPSERT --------
        // First ingest: connectedAt = "2020-01-01"
        // Second ingest: LinkedIn re-issues connectedAt = "2020-01-15" (rare but real).
        await writeConnections(parsedPeople({}), tenantId, now);
        const connAfterFirst = await (async () => {
          const rows = await db.select().from(schema.connections).where(eq(schema.connections.tenantId, tenantId));
          return { count: rows.length, connectedAt: rows[0]?.connectedAt ?? null };
        })();

        await writeConnections(
          parsedPeople({ connectedAt: "2020-01-15" }),
          tenantId,
          now,
        );
        const connAfterCorrect = await (async () => {
          const rows = await db.select().from(schema.connections).where(eq(schema.connections.tenantId, tenantId));
          return { count: rows.length, connectedAt: rows[0]?.connectedAt ?? null };
        })();

        console.log("${RESULT_MARKER}" + JSON.stringify({
          companyAfterFirst, companyAfterRename,
          personAfterFirst, personAfterCorrect,
          connAfterFirst, connAfterCorrect,
        }));
      `,
    );
  }, 60_000);

  test("writeCompanies: first ingest stores the raw display name", () => {
    expect(result.companyAfterFirst.count).toBe(1);
    expect(result.companyAfterFirst.name).toBe("pwc  españa");
  });

  test("writeCompanies: re-ingest with same normalised name UPSERTs display-name (pre-fix silently dropped the correction)", () => {
    // Both "pwc  españa" and "PwC España" normalise to "pwc espana" → same
    // company id. Post-fix the display `name` is updated; pre-fix
    // onConflictDoNothing kept the original lower/whitespace version.
    expect(result.companyAfterRename.count).toBe(1);
    expect(result.companyAfterRename.name).toBe("PwC España");
  });

  test("writePeople: first ingest captures headline + email as given", () => {
    expect(result.personAfterFirst.fullName).toBe("Alice");
    expect(result.personAfterFirst.headline).toBe("Engineer");
    expect(result.personAfterFirst.email).toBeNull();
  });

  test("writePeople: re-ingest UPSERTs headline AND email correction (no second row)", () => {
    expect(result.personAfterCorrect.count).toBe(result.personAfterFirst.count);
    expect(result.personAfterCorrect.headline).toBe("Senior Engineer");
    expect(result.personAfterCorrect.email).toBe("alice@example.com");
  });

  test("writeConnections: first ingest stores the original connectedAt", () => {
    expect(result.connAfterFirst.count).toBe(1);
    expect(result.connAfterFirst.connectedAt).toBe("2020-01-01");
  });

  test("writeConnections: re-ingest UPSERTs the corrected connectedAt (no second row)", () => {
    expect(result.connAfterCorrect.count).toBe(1);
    expect(result.connAfterCorrect.connectedAt).toBe("2020-01-15");
  });
});
