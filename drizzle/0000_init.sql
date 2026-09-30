CREATE TABLE `api_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `copies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`movie_id` integer NOT NULL,
	`format` text NOT NULL,
	`ownership` text NOT NULL,
	`edition` text,
	`notes` text,
	`origin` text NOT NULL,
	`review_status` text NOT NULL,
	`suggestion_reason` text,
	`confidence` real,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `copies_movie_idx` ON `copies` (`movie_id`);--> statement-breakpoint
CREATE INDEX `copies_review_idx` ON `copies` (`review_status`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`movie_id` integer NOT NULL,
	`copy_id` integer,
	`rel_path` text NOT NULL,
	`source` text NOT NULL,
	`plex_rating_key` text,
	`plex_media_id` text,
	`plex_updated_at` integer,
	`width` integer,
	`height` integer,
	`hdr` text,
	`dv_profile` integer,
	`codec` text,
	`container` text,
	`size_bytes` integer,
	`parts` integer DEFAULT 1 NOT NULL,
	`edition` text,
	`missing` integer DEFAULT false NOT NULL,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`copy_id`) REFERENCES `copies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_rel_path_unique` ON `files` (`rel_path`);--> statement-breakpoint
CREATE INDEX `files_movie_idx` ON `files` (`movie_id`);--> statement-breakpoint
CREATE INDEX `files_copy_idx` ON `files` (`copy_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `files_plex_media_idx` ON `files` (`plex_media_id`);--> statement-breakpoint
CREATE TABLE `movies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tmdb_id` integer NOT NULL,
	`imdb_id` text,
	`title` text NOT NULL,
	`original_title` text,
	`year` integer,
	`overview` text,
	`runtime` integer,
	`genres` text,
	`poster_path` text,
	`backdrop_path` text,
	`tmdb_synced_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `movies_tmdb_id_unique` ON `movies` (`tmdb_id`);--> statement-breakpoint
CREATE TABLE `scan_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	`stats` text,
	`log` text
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `wishlist_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`movie_id` integer NOT NULL,
	`kind` text NOT NULL,
	`target_format` text NOT NULL,
	`from_copy_id` integer,
	`priority` integer DEFAULT 2 NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`fulfilled_at` integer,
	`fulfilled_by_copy_id` integer,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_copy_id`) REFERENCES `copies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`fulfilled_by_copy_id`) REFERENCES `copies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `wishlist_movie_idx` ON `wishlist_items` (`movie_id`);