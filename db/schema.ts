import {sqliteTable,text,integer,index,uniqueIndex} from 'drizzle-orm/sqlite-core';
export const projects=sqliteTable('projects',{id:text('id').primaryKey(),owner:text('owner').notNull(),name:text('name').notNull(),body:text('body').notNull(),revision:integer('revision').notNull(),updatedAt:text('updated_at').notNull()},t=>[index('projects_owner').on(t.owner)]);
export const revisions=sqliteTable('revisions',{key:text('key').primaryKey(),projectId:text('project_id').notNull(),owner:text('owner').notNull(),revision:integer('revision').notNull(),body:text('body').notNull(),snapshotObjectKey:text('snapshot_object_key'),summary:text('summary').notNull(),createdAt:text('created_at').notNull()},t=>[index('revisions_project_owner').on(t.projectId,t.owner)]);

export const originalFiles=sqliteTable('original_files',{projectId:text('project_id').primaryKey(),owner:text('owner').notNull(),objectKey:text('object_key').notNull()});
export const deletionJobs=sqliteTable('deletion_jobs',{objectKey:text('object_key').primaryKey(),owner:text('owner').notNull()});

export const proposals=sqliteTable('proposals',{
 id:text('id').primaryKey(),projectId:text('project_id').notNull(),owner:text('owner').notNull(),
 baseRevision:integer('base_revision').notNull(),body:text('body').notNull(),
 status:text('status').notNull().default('pending'),createdAt:text('created_at').notNull(),
 appliedRevision:integer('applied_revision'),appliedAt:text('applied_at'),
},t=>[index('proposals_project_owner_created').on(t.projectId,t.owner,t.createdAt)]);


export const evidences=sqliteTable('evidences',{
 id:text('id').primaryKey(),projectId:text('project_id').notNull(),owner:text('owner').notNull(),
 title:text('title').notNull(),kind:text('kind').notNull(),description:text('description').notNull(),
 currentVersionId:text('current_version_id'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[index('evidences_project_owner').on(t.projectId,t.owner)]);

export const evidenceVersions=sqliteTable('evidence_versions',{
 id:text('id').primaryKey(),evidenceId:text('evidence_id').notNull(),projectId:text('project_id').notNull(),owner:text('owner').notNull(),
 versionNo:integer('version_no').notNull(),originalFilename:text('original_filename').notNull(),mimeType:text('mime_type').notNull(),
 byteSize:integer('byte_size').notNull(),sha256:text('sha256').notNull(),objectKey:text('object_key').notNull(),
 storageState:text('storage_state').notNull(),uploadOperationId:text('upload_operation_id').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('evidence_versions_project_owner').on(t.projectId,t.owner),uniqueIndex('evidence_versions_evidence_version').on(t.evidenceId,t.versionNo)]);

export const evidenceUploads=sqliteTable('evidence_uploads',{
 operationId:text('operation_id').primaryKey(),projectId:text('project_id').notNull(),evidenceId:text('evidence_id').notNull(),owner:text('owner').notNull(),
 state:text('state').notNull(),objectKey:text('object_key').notNull(),sha256:text('sha256').notNull(),byteSize:integer('byte_size').notNull(),
 error:text('error').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[index('evidence_uploads_project_owner').on(t.projectId,t.owner)]);
