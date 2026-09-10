CREATE TABLE `vnext_repositories` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `provider` text NOT NULL,
  `external_ref` text NOT NULL,
  `revision` integer NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vnext_repositories_identity` ON `vnext_repositories` (`project_id`,`provider`,`external_ref`);
--> statement-breakpoint
CREATE INDEX `vnext_repositories_project` ON `vnext_repositories` (`project_id`);
--> statement-breakpoint
CREATE TABLE `vnext_repository_commit_refs` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `repository_id` text NOT NULL,
  `repository_revision` integer NOT NULL,
  `commit_sha` text NOT NULL,
  `tree_sha` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`repository_id`) REFERENCES `vnext_repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vnext_commit_repository_sha` ON `vnext_repository_commit_refs` (`repository_id`,`commit_sha`);
--> statement-breakpoint
CREATE INDEX `vnext_commit_project` ON `vnext_repository_commit_refs` (`project_id`);
--> statement-breakpoint
CREATE TABLE `vnext_repository_baselines` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `repository_id` text NOT NULL,
  `repository_revision` integer NOT NULL,
  `commit_ref_id` text NOT NULL,
  `commit_sha` text NOT NULL,
  `tree_sha` text NOT NULL,
  `manifest_digest` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`repository_id`) REFERENCES `vnext_repositories`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`commit_ref_id`) REFERENCES `vnext_repository_commit_refs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `vnext_baselines_project_repository` ON `vnext_repository_baselines` (`project_id`,`repository_id`);
--> statement-breakpoint
CREATE INDEX `vnext_baselines_commit` ON `vnext_repository_baselines` (`commit_ref_id`);
--> statement-breakpoint
CREATE TABLE `vnext_environments` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `environment_key` text NOT NULL,
  `provider_ref` text DEFAULT '' NOT NULL,
  `revision` integer NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vnext_environments_project_key` ON `vnext_environments` (`project_id`,`environment_key`);
--> statement-breakpoint
CREATE INDEX `vnext_environments_project` ON `vnext_environments` (`project_id`);
--> statement-breakpoint
CREATE TABLE `vnext_deployments` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `environment_id` text NOT NULL,
  `environment_revision` integer NOT NULL,
  `repository_id` text NOT NULL,
  `repository_revision` integer NOT NULL,
  `commit_ref_id` text NOT NULL,
  `commit_sha` text NOT NULL,
  `tree_sha` text NOT NULL,
  `artifact_digest` text NOT NULL,
  `config_version` text NOT NULL,
  `schema_version` text NOT NULL,
  `provider_deployment_ref` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`environment_id`) REFERENCES `vnext_environments`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`repository_id`) REFERENCES `vnext_repositories`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`commit_ref_id`) REFERENCES `vnext_repository_commit_refs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vnext_deployments_provider_identity` ON `vnext_deployments` (`environment_id`,`provider_deployment_ref`);
--> statement-breakpoint
CREATE INDEX `vnext_deployments_project_created` ON `vnext_deployments` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `vnext_deployments_commit` ON `vnext_deployments` (`commit_ref_id`);
