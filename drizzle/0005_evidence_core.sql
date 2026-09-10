CREATE TABLE `evidences` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `owner` text NOT NULL,
  `title` text NOT NULL,
  `kind` text NOT NULL,
  `description` text NOT NULL,
  `current_version_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `evidences_project_owner` ON `evidences` (`project_id`,`owner`);
--> statement-breakpoint
CREATE TABLE `evidence_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `evidence_id` text NOT NULL,
  `project_id` text NOT NULL,
  `owner` text NOT NULL,
  `version_no` integer NOT NULL,
  `original_filename` text NOT NULL,
  `mime_type` text NOT NULL,
  `byte_size` integer NOT NULL,
  `sha256` text NOT NULL,
  `object_key` text NOT NULL,
  `storage_state` text NOT NULL,
  `upload_operation_id` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `evidence_versions_project_owner` ON `evidence_versions` (`project_id`,`owner`);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_versions_evidence_version` ON `evidence_versions` (`evidence_id`,`version_no`);
--> statement-breakpoint
CREATE TABLE `evidence_uploads` (
  `operation_id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `evidence_id` text NOT NULL,
  `owner` text NOT NULL,
  `state` text NOT NULL,
  `object_key` text NOT NULL,
  `sha256` text NOT NULL,
  `byte_size` integer NOT NULL,
  `error` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `evidence_uploads_project_owner` ON `evidence_uploads` (`project_id`,`owner`);
