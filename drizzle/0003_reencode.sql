ALTER TABLE `files` ADD `duration_s` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `result` text;--> statement-breakpoint
ALTER TABLE `workers` ADD `libraries` text DEFAULT '{}' NOT NULL;