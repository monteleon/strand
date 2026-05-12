CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`linkedin_url` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `companies_tenant_norm_idx` ON `companies` (`tenant_id`,`normalized_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `companies_norm_unique` ON `companies` (`tenant_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `connections` (
	`tenant_id` text NOT NULL,
	`from_person_id` text NOT NULL,
	`to_person_id` text NOT NULL,
	`source` text NOT NULL,
	`connected_at` text,
	PRIMARY KEY(`tenant_id`, `from_person_id`, `to_person_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `connections_tenant_to_idx` ON `connections` (`tenant_id`,`to_person_id`);--> statement-breakpoint
CREATE TABLE `derived_edges` (
	`tenant_id` text NOT NULL,
	`person_a` text NOT NULL,
	`person_b` text NOT NULL,
	`kind` text NOT NULL,
	`evidence_json` text NOT NULL,
	`confidence` real NOT NULL,
	`derived_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `person_a`, `person_b`, `kind`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_a`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_b`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `derived_edges_a_idx` ON `derived_edges` (`tenant_id`,`person_a`);--> statement-breakpoint
CREATE INDEX `derived_edges_b_idx` ON `derived_edges` (`tenant_id`,`person_b`);--> statement-breakpoint
CREATE TABLE `export_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`source` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	`filename` text NOT NULL,
	`sha256` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `export_batches_tenant_idx` ON `export_batches` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `export_batches_sha256_unique` ON `export_batches` (`tenant_id`,`sha256`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`from_person_id` text NOT NULL,
	`to_person_id` text NOT NULL,
	`sent_at` integer NOT NULL,
	`direction` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_tenant_sent_idx` ON `messages` (`tenant_id`,`sent_at`);--> statement-breakpoint
CREATE INDEX `messages_pair_idx` ON `messages` (`tenant_id`,`from_person_id`,`to_person_id`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`full_name` text NOT NULL,
	`headline` text,
	`email` text,
	`linkedin_url` text,
	`source_batch_id` text,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_batch_id`) REFERENCES `export_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `people_tenant_name_idx` ON `people` (`tenant_id`,`full_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `people_linkedin_url_unique` ON `people` (`tenant_id`,`linkedin_url`);--> statement-breakpoint
CREATE TABLE `positions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`person_id` text NOT NULL,
	`company_id` text NOT NULL,
	`title` text,
	`start_date` text,
	`end_date` text,
	`current` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `positions_tenant_person_idx` ON `positions` (`tenant_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `positions_tenant_company_idx` ON `positions` (`tenant_id`,`company_id`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
