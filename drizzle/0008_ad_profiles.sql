CREATE TABLE `ad_profile_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`item_id` text NOT NULL,
	`variation_id` text DEFAULT '' NOT NULL,
	`valid_from` text NOT NULL,
	`revision` integer NOT NULL,
	`request_id` text NOT NULL,
	`action` text NOT NULL,
	`payload` text,
	`origin` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ad_profiles_owner_request` ON `ad_profile_events` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ad_profiles_target_revision` ON `ad_profile_events` (`owner_id`,`account_id`,`item_id`,`variation_id`,`valid_from`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_ad_profiles_owner_account` ON `ad_profile_events` (`owner_id`,`account_id`,`item_id`,`variation_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `ad_profile_rollouts` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`source_stamp` text NOT NULL,
	`report` text NOT NULL,
	`activated_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meli_catalog_runs` (
	`account_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`generation` text NOT NULL,
	`id` text NOT NULL,
	`offset` integer NOT NULL,
	`total` integer,
	`status` text NOT NULL,
	`lease` text,
	`lease_until` integer,
	`error` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_meli_catalog_runs_owner` ON `meli_catalog_runs` (`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `meli_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`item_id` text NOT NULL,
	`variation_id` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`seller_sku` text,
	`seen_generation` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_meli_listings_target` ON `meli_listings` (`owner_id`,`account_id`,`item_id`,`variation_id`);--> statement-breakpoint
CREATE INDEX `idx_meli_listings_owner_account` ON `meli_listings` (`owner_id`,`account_id`,`status`);--> statement-breakpoint
CREATE TABLE `sale_correction_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`field` text NOT NULL,
	`revision` integer NOT NULL,
	`request_id` text NOT NULL,
	`action` text NOT NULL,
	`mode` text NOT NULL,
	`value` integer,
	`source_value` integer,
	`source_stamp` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_corrections_owner_request` ON `sale_correction_events` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_corrections_target_revision` ON `sale_correction_events` (`owner_id`,`account_id`,`sale_id`,`field`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_sale_corrections_owner_account` ON `sale_correction_events` (`owner_id`,`account_id`,`sale_id`);--> statement-breakpoint
ALTER TABLE `meli_connections` ADD `financials_version` integer DEFAULT 1 NOT NULL;