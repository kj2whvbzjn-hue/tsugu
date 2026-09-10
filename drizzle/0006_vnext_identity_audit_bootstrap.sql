CREATE TABLE `vnext_actors` (
  `id` text PRIMARY KEY NOT NULL,
  `subject_id` text NOT NULL,
  `email_hash` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vnext_actors_subject` ON `vnext_actors` (`subject_id`);
--> statement-breakpoint
CREATE TABLE `vnext_roles` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `name` text NOT NULL,
  `permissions_json` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vnext_roles_project_name` ON `vnext_roles` (`project_id`,`name`);
--> statement-breakpoint
CREATE INDEX `vnext_roles_project` ON `vnext_roles` (`project_id`);
--> statement-breakpoint
CREATE TABLE `vnext_project_memberships` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `actor_id` text NOT NULL,
  `role_id` text NOT NULL,
  `revision` integer NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`actor_id`) REFERENCES `vnext_actors`(`id`),
  FOREIGN KEY (`role_id`) REFERENCES `vnext_roles`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vnext_memberships_project_actor` ON `vnext_project_memberships` (`project_id`,`actor_id`);
--> statement-breakpoint
CREATE INDEX `vnext_memberships_project_role` ON `vnext_project_memberships` (`project_id`,`role_id`);
--> statement-breakpoint
CREATE TABLE `vnext_policies` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `version` integer NOT NULL,
  `document_json` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vnext_policies_project` ON `vnext_policies` (`project_id`);
--> statement-breakpoint
CREATE TABLE `vnext_audit_logs` (
  `id` text PRIMARY KEY NOT NULL,
  `actor_id` text,
  `subject_id` text NOT NULL,
  `project_id` text DEFAULT '' NOT NULL,
  `action` text NOT NULL,
  `policy_version` integer,
  `resource_revision` integer,
  `result` text NOT NULL,
  `reason_code` text DEFAULT '' NOT NULL,
  `details_json` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vnext_audit_project_created` ON `vnext_audit_logs` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `vnext_audit_subject_created` ON `vnext_audit_logs` (`subject_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `vnext_bootstrap_receipts` (
  `id` text PRIMARY KEY NOT NULL,
  `generation` text NOT NULL,
  `subject_id` text NOT NULL,
  `actor_id` text NOT NULL,
  `project_id` text NOT NULL,
  `membership_id` text NOT NULL,
  `config_fingerprint` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`actor_id`) REFERENCES `vnext_actors`(`id`),
  FOREIGN KEY (`membership_id`) REFERENCES `vnext_project_memberships`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vnext_bootstrap_generation` ON `vnext_bootstrap_receipts` (`generation`);
--> statement-breakpoint
CREATE UNIQUE INDEX `vnext_bootstrap_membership` ON `vnext_bootstrap_receipts` (`membership_id`);
