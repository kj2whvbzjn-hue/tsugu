import {index,integer,sqliteTable,text,uniqueIndex} from 'drizzle-orm/sqlite-core';

export const vnextRepositories=sqliteTable('vnext_repositories',{
  id:text('id').primaryKey(),
  projectId:text('project_id').notNull(),
  provider:text('provider').notNull(),
  externalRef:text('external_ref').notNull(),
  revision:integer('revision').notNull(),
  createdAt:text('created_at').notNull(),
},table=>[
  uniqueIndex('vnext_repositories_identity').on(table.projectId,table.provider,table.externalRef),
  index('vnext_repositories_project').on(table.projectId),
]);

export const vnextRepositoryCommitRefs=sqliteTable('vnext_repository_commit_refs',{
  id:text('id').primaryKey(),
  projectId:text('project_id').notNull(),
  repositoryId:text('repository_id').notNull().references(()=>vnextRepositories.id),
  repositoryRevision:integer('repository_revision').notNull(),
  commitSha:text('commit_sha').notNull(),
  treeSha:text('tree_sha').notNull(),
  createdAt:text('created_at').notNull(),
},table=>[
  uniqueIndex('vnext_commit_repository_sha').on(table.repositoryId,table.commitSha),
  index('vnext_commit_project').on(table.projectId),
]);

export const vnextRepositoryBaselines=sqliteTable('vnext_repository_baselines',{
  id:text('id').primaryKey(),
  projectId:text('project_id').notNull(),
  repositoryId:text('repository_id').notNull().references(()=>vnextRepositories.id),
  repositoryRevision:integer('repository_revision').notNull(),
  commitRefId:text('commit_ref_id').notNull().references(()=>vnextRepositoryCommitRefs.id),
  commitSha:text('commit_sha').notNull(),
  treeSha:text('tree_sha').notNull(),
  manifestDigest:text('manifest_digest').notNull(),
  createdAt:text('created_at').notNull(),
},table=>[
  index('vnext_baselines_project_repository').on(table.projectId,table.repositoryId),
  index('vnext_baselines_commit').on(table.commitRefId),
]);

export const vnextEnvironments=sqliteTable('vnext_environments',{
  id:text('id').primaryKey(),
  projectId:text('project_id').notNull(),
  key:text('environment_key').notNull(),
  providerRef:text('provider_ref').notNull().default(''),
  revision:integer('revision').notNull(),
  createdAt:text('created_at').notNull(),
},table=>[
  uniqueIndex('vnext_environments_project_key').on(table.projectId,table.key),
  index('vnext_environments_project').on(table.projectId),
]);

export const vnextDeployments=sqliteTable('vnext_deployments',{
  id:text('id').primaryKey(),
  projectId:text('project_id').notNull(),
  environmentId:text('environment_id').notNull().references(()=>vnextEnvironments.id),
  environmentRevision:integer('environment_revision').notNull(),
  repositoryId:text('repository_id').notNull().references(()=>vnextRepositories.id),
  repositoryRevision:integer('repository_revision').notNull(),
  commitRefId:text('commit_ref_id').notNull().references(()=>vnextRepositoryCommitRefs.id),
  commitSha:text('commit_sha').notNull(),
  treeSha:text('tree_sha').notNull(),
  artifactDigest:text('artifact_digest').notNull(),
  configVersion:text('config_version').notNull(),
  schemaVersion:text('schema_version').notNull(),
  providerDeploymentRef:text('provider_deployment_ref').notNull(),
  createdAt:text('created_at').notNull(),
},table=>[
  uniqueIndex('vnext_deployments_provider_identity').on(table.environmentId,table.providerDeploymentRef),
  index('vnext_deployments_project_created').on(table.projectId,table.createdAt),
  index('vnext_deployments_commit').on(table.commitRefId),
]);
