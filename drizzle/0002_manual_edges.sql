CREATE TABLE `manual_edges` (
	`tenant_id` text NOT NULL,
	`person_a` text NOT NULL,
	`person_b` text NOT NULL,
	`note` text,
	`asserted_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `person_a`, `person_b`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_a`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_b`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `manual_edges_a_idx` ON `manual_edges` (`tenant_id`,`person_a`);--> statement-breakpoint
CREATE INDEX `manual_edges_b_idx` ON `manual_edges` (`tenant_id`,`person_b`);