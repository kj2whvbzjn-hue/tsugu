CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner` text NOT NULL,
	`base_revision` integer NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`applied_revision` integer,
	`applied_at` text
);
--> statement-breakpoint
CREATE INDEX `proposals_project_owner_created` ON `proposals` (`project_id`,`owner`,`created_at`);