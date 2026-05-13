ALTER TABLE `positions` ADD `origin` text DEFAULT 'declared' NOT NULL;--> statement-breakpoint
CREATE INDEX `positions_tenant_company_origin_idx` ON `positions` (`tenant_id`,`company_id`,`origin`);
