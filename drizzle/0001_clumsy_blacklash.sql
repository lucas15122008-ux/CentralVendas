CREATE TABLE `meli_apps` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`secret` text NOT NULL,
	`pkce` integer NOT NULL,
	`revision` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meli_connections` (
	`account_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`seller_id` text,
	`nickname` text,
	`status` text NOT NULL,
	`generation` text NOT NULL,
	`tokens` text,
	`expires_at` integer,
	`refresh_started` integer,
	`updated_at` integer NOT NULL,
	`synced_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_meli_owner_seller` ON `meli_connections` (`owner_id`,`seller_id`);--> statement-breakpoint
CREATE INDEX `idx_meli_connections_owner` ON `meli_connections` (`owner_id`);--> statement-breakpoint
CREATE TABLE `meli_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`browser_hash` text NOT NULL,
	`verifier` text NOT NULL,
	`generation` text NOT NULL,
	`app_revision` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `meli_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`order_id` text NOT NULL,
	`date` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_meli_account_order` ON `meli_orders` (`account_id`,`order_id`);--> statement-breakpoint
CREATE INDEX `idx_meli_orders_owner_date` ON `meli_orders` (`owner_id`,`date`);--> statement-breakpoint
CREATE TABLE `meli_sync_runs` (
	`account_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`generation` text NOT NULL,
	`id` text NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	`offset` integer NOT NULL,
	`total` integer,
	`status` text NOT NULL,
	`lease` text,
	`lease_until` integer,
	`error` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
