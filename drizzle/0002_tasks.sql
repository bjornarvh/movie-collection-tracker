CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`worker` text NOT NULL,
	`params` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`title` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`last_seen_at` integer,
	`exit_code` integer,
	`log` text DEFAULT '' NOT NULL,
	`error` text,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`parent_id` integer
);
--> statement-breakpoint
CREATE INDEX `tasks_queue_idx` ON `tasks` (`worker`,`status`,`id`);--> statement-breakpoint
CREATE TABLE `workers` (
	`name` text PRIMARY KEY NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`inventory` text DEFAULT '[]' NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`allowed_hours` text,
	`last_seen_at` integer
);
