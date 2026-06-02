PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_derived_edges` (
	`tenant_id` text NOT NULL,
	`person_a` text NOT NULL,
	`person_b` text NOT NULL,
	`kind` text NOT NULL,
	`company_id` text NOT NULL,
	`evidence_json` text NOT NULL,
	`confidence` real NOT NULL,
	`derived_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `person_a`, `person_b`, `kind`, `company_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_a`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_b`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Backfill company_id from evidence_json — pre-migration rows stored the
-- companyId inside the evidence JSON blob; this surfaces it as a column.
-- Rows where the extract is NULL are dropped: they violate the new NOT NULL
-- and would be regenerated on the next deriveSharedEmployerEdges pass anyway
-- (the deriver does clear-then-rebuild per tenant).
INSERT INTO `__new_derived_edges`("tenant_id", "person_a", "person_b", "kind", "company_id", "evidence_json", "confidence", "derived_at") SELECT "tenant_id", "person_a", "person_b", "kind", json_extract("evidence_json", '$.companyId') AS "company_id", "evidence_json", "confidence", "derived_at" FROM `derived_edges` WHERE json_extract("evidence_json", '$.companyId') IS NOT NULL;--> statement-breakpoint
DROP TABLE `derived_edges`;--> statement-breakpoint
ALTER TABLE `__new_derived_edges` RENAME TO `derived_edges`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `derived_edges_a_idx` ON `derived_edges` (`tenant_id`,`person_a`);--> statement-breakpoint
CREATE INDEX `derived_edges_b_idx` ON `derived_edges` (`tenant_id`,`person_b`);--> statement-breakpoint
CREATE INDEX `derived_edges_company_idx` ON `derived_edges` (`tenant_id`,`company_id`);