CREATE TABLE `meli_account_leases` (
	`account_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`generation` text NOT NULL,
	`lease` text NOT NULL,
	`lease_until` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `meli_automation_health` (
	`id` text PRIMARY KEY NOT NULL,
	`heartbeat_at` integer NOT NULL,
	`event_at` integer
);
--> statement-breakpoint
CREATE TABLE `meli_automation_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_meli_nonces_expiry` ON `meli_automation_nonces` (`expires_at`);--> statement-breakpoint
CREATE TABLE `meli_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`generation` text NOT NULL,
	`resource` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`due_at` integer NOT NULL,
	`lease` text,
	`lease_until` integer,
	`error` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_meli_jobs_due` ON `meli_jobs` (`due_at`);--> statement-breakpoint
CREATE INDEX `idx_meli_jobs_account` ON `meli_jobs` (`account_id`);