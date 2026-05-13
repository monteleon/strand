CREATE TABLE `saved_queries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_queries_name_unique` ON `saved_queries` (`tenant_id`,`name`);--> statement-breakpoint
CREATE INDEX `saved_queries_tenant_idx` ON `saved_queries` (`tenant_id`);
