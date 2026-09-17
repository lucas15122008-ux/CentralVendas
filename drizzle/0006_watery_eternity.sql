CREATE TABLE `reconciliation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_key` text NOT NULL,
	`valid_from` text DEFAULT '' NOT NULL,
	`revision` integer NOT NULL,
	`request_id` text NOT NULL,
	`action` text NOT NULL,
	`payload` text,
	`source_stamp` text,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reconciliation_owner_request` ON `reconciliation_events` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reconciliation_target_revision` ON `reconciliation_events` (`owner_id`,`account_id`,`target_type`,`target_key`,`valid_from`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_reconciliation_owner_account` ON `reconciliation_events` (`owner_id`,`account_id`,`created_at`);