CREATE TABLE `full_closure_allocations` (
	`closure_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`units` integer NOT NULL,
	`expense_cents` integer NOT NULL,
	FOREIGN KEY (`closure_id`) REFERENCES `full_closure_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_full_allocation_closure_sale` ON `full_closure_allocations` (`closure_id`,`sale_id`);--> statement-breakpoint
CREATE INDEX `idx_full_allocation_owner_account` ON `full_closure_allocations` (`owner_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `full_closure_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`month` text NOT NULL,
	`revision` integer NOT NULL,
	`request_id` text NOT NULL,
	`action` text NOT NULL,
	`total_expense_cents` integer,
	`eligible_units` integer NOT NULL,
	`source_stamp` text,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_full_closure_owner_request` ON `full_closure_events` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_full_closure_revision` ON `full_closure_events` (`owner_id`,`account_id`,`month`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_full_closure_owner_month` ON `full_closure_events` (`owner_id`,`account_id`,`month`);--> statement-breakpoint
ALTER TABLE `meli_connections` ADD `logistics_version` integer DEFAULT 1 NOT NULL;