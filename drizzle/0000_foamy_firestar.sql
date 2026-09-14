CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_accounts_owner` ON `accounts` (`owner_id`);--> statement-breakpoint
CREATE TABLE `cost_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`import_id` text NOT NULL,
	`sku` text NOT NULL,
	`description` text NOT NULL,
	`unit_cost` real NOT NULL,
	`tax_value` real,
	`tax_type` text NOT NULL,
	`tax_treatment` text NOT NULL,
	`valid_from` text NOT NULL,
	`imported_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_costs_owner_account_sku_date` ON `cost_versions` (`owner_id`,`account_id`,`sku`,`valid_from`);--> statement-breakpoint
CREATE INDEX `idx_costs_import` ON `cost_versions` (`import_id`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`filename` text NOT NULL,
	`file_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`config` text NOT NULL,
	`valid_from` text NOT NULL,
	`row_count` integer NOT NULL,
	`created_at` text NOT NULL,
	`withdrawn_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_imports_owner_date` ON `imports` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_imports_owner_fingerprint` ON `imports` (`owner_id`,`fingerprint`);