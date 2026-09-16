ALTER TABLE `meli_connections` ADD `sync_cursor` text;--> statement-breakpoint
ALTER TABLE `meli_sync_runs` ADD `mode` text DEFAULT 'history' NOT NULL;
--> statement-breakpoint
UPDATE meli_connections SET sync_cursor=(SELECT r.to_date FROM meli_sync_runs r WHERE r.account_id=meli_connections.account_id AND r.owner_id=meli_connections.owner_id AND r.generation=meli_connections.generation AND r.status='complete') WHERE sync_cursor IS NULL;
