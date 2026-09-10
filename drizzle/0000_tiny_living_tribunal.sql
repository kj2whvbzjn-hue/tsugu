CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_owner` ON `projects` (`owner`);--> statement-breakpoint
CREATE TABLE `revisions` (
	`key` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner` text NOT NULL,
	`revision` integer NOT NULL,
	`body` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `revisions_project_owner` ON `revisions` (`project_id`,`owner`);