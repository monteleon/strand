import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

// Every entity table carries tenant_id so the multi-tenant fork (post-v0.1.0)
// is a one-pass migration, not a rewrite. In single-tenant mode, every row
// is tenant_id = 'local'.
// owner_person_id anchors 1st-degree edges: every connection row points
// out from the owner. Set during ingest from Profile.csv; null pre-ingest.
export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  ownerPersonId: text("owner_person_id"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const exportBatches = sqliteTable(
  "export_batches",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    source: text("source", { enum: ["linkedin"] }).notNull(),
    uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull(),
    filename: text("filename").notNull(),
    sha256: text("sha256").notNull(),
  },
  (t) => ({
    tenantIdx: index("export_batches_tenant_idx").on(t.tenantId),
    sha256Unique: unique("export_batches_sha256_unique").on(t.tenantId, t.sha256),
  }),
);

export const people = sqliteTable(
  "people",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    fullName: text("full_name").notNull(),
    headline: text("headline"),
    email: text("email"),
    linkedinUrl: text("linkedin_url"),
    sourceBatchId: text("source_batch_id").references(() => exportBatches.id),
    firstSeen: integer("first_seen", { mode: "timestamp" }).notNull(),
    lastSeen: integer("last_seen", { mode: "timestamp" }).notNull(),
  },
  (t) => ({
    tenantNameIdx: index("people_tenant_name_idx").on(t.tenantId, t.fullName),
    linkedinUrlUnique: unique("people_linkedin_url_unique").on(t.tenantId, t.linkedinUrl),
  }),
);

export const companies = sqliteTable(
  "companies",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    linkedinUrl: text("linkedin_url"),
  },
  (t) => ({
    tenantNormIdx: index("companies_tenant_norm_idx").on(t.tenantId, t.normalizedName),
    normUnique: unique("companies_norm_unique").on(t.tenantId, t.normalizedName),
  }),
);

export const positions = sqliteTable(
  "positions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    personId: text("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    title: text("title"),
    // Stored as YYYY-MM-01 (LinkedIn export precision is month, not day).
    startDate: text("start_date"),
    endDate: text("end_date"),
    current: integer("current", { mode: "boolean" }).notNull().default(false),
  },
  (t) => ({
    tenantPersonIdx: index("positions_tenant_person_idx").on(t.tenantId, t.personId),
    tenantCompanyIdx: index("positions_tenant_company_idx").on(t.tenantId, t.companyId),
  }),
);

// Composite-key 1st-degree edges. LinkedIn export gives only the export-owner's
// 1st-degree connections; this table never contains "X is connected to Y" for
// X != the export owner. That's a property of the source, not the schema.
export const connections = sqliteTable(
  "connections",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    fromPersonId: text("from_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    toPersonId: text("to_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["linkedin"] }).notNull(),
    connectedAt: text("connected_at"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.fromPersonId, t.toPersonId] }),
    toIdx: index("connections_tenant_to_idx").on(t.tenantId, t.toPersonId),
  }),
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    fromPersonId: text("from_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    toPersonId: text("to_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    sentAt: integer("sent_at", { mode: "timestamp" }).notNull(),
    direction: text("direction", { enum: ["sent", "received"] }).notNull(),
  },
  (t) => ({
    tenantSentIdx: index("messages_tenant_sent_idx").on(t.tenantId, t.sentAt),
    pairIdx: index("messages_pair_idx").on(t.tenantId, t.fromPersonId, t.toPersonId),
  }),
);

// Derived edges power "who knows who" within your network. LinkedIn does not
// expose the 2nd-degree graph; everything in this table is inferred from
// shared employment + overlapping dates. Idempotent on (person_a, person_b, kind).
export const derivedEdges = sqliteTable(
  "derived_edges",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    personA: text("person_a")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    personB: text("person_b")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["shared_employer_overlap", "shared_employer_no_overlap", "connection_date_cluster"],
    }).notNull(),
    evidenceJson: text("evidence_json").notNull(),
    confidence: real("confidence").notNull(),
    derivedAt: integer("derived_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.personA, t.personB, t.kind] }),
    aIdx: index("derived_edges_a_idx").on(t.tenantId, t.personA),
    bIdx: index("derived_edges_b_idx").on(t.tenantId, t.personB),
  }),
);
