CREATE TABLE `encode_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`position` integer NOT NULL,
	`rel_path` text NOT NULL,
	`parts` integer DEFAULT 1 NOT NULL,
	`tmdb_id` integer,
	`status` text DEFAULT 'queued' NOT NULL,
	`stage` text,
	`percent` real,
	`speed` real,
	`fps` real,
	`out_time_s` real,
	`duration_s` real,
	`description` text,
	`error` text,
	`size_bytes` integer,
	`gb_per_hour` real,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `encode_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `encode_jobs_run_idx` ON `encode_jobs` (`run_id`,`position`);--> statement-breakpoint
CREATE TABLE `encode_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host` text NOT NULL,
	`input_root` text,
	`output_root` text,
	`encoder` text,
	`options` text,
	`status` text NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL
);
