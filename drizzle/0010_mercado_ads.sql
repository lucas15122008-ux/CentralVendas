CREATE TABLE `meli_ads_state` (
	`account_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`generation` text NOT NULL,
	`advertiser_id` text,
	`state` text NOT NULL,
	`error` text,
	`checked_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_meli_ads_state_owner` ON `meli_ads_state` (`owner_id`);--> statement-breakpoint
CREATE TABLE `meli_ads_days` (
	`account_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`date` text NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `date`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `meli_ad_spend` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`item_id` text NOT NULL,
	`date` text NOT NULL,
	`cost_cents` integer NOT NULL,
	`clicks` integer NOT NULL,
	`prints` integer NOT NULL,
	`attributed_cents` integer NOT NULL,
	`attributed_units` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_meli_ad_spend_owner_date` ON `meli_ad_spend` (`owner_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_meli_ad_spend_account_date` ON `meli_ad_spend` (`account_id`,`date`);
