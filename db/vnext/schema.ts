import {index,integer,sqliteTable,text,uniqueIndex} from 'drizzle-orm/sqlite-core';

export const vnextActors=sqliteTable('vnext_actors',{
  id:text('id').primaryKey(),
  subjectId:text('subject_id').notNull(),
  emailHash:text('email_hash').notNull().default(''),
  createdAt:text('created_at').notNull(),
},table=>[uniqueIndex('vnext_actors_subject').on(table.subjectId)]);

export const vnextRoles=sqliteTable('vnext_roles',{
  id:text('id').primaryKey(),
  projectId:text('project_id').notNull(),
  name:text('name').notNull(),
  permissionsJson:text('permissions_json').notNull(),
  createdAt:text('created_at').notNull(),
},table=>[uniqueIndex('vnext_roles_project_name').on(table.projectId,table.name),index('vnext_roles_project').on(table.projectId)]);

export const vnextProjectMemberships=sqliteTable('vnext_project_memberships',{
  id:text('id').primaryKey(),
  projectId:text('project_id').notNull(),
  actorId:text('actor_id').notNull().references(()=>vnextActors.id),
  roleId:text('role_id').notNull().references(()=>vnextRoles.id),
  revision:integer('revision').notNull(),
  createdAt:text('created_at').notNull(),
},table=>[uniqueIndex('vnext_memberships_project_actor').on(table.projectId,table.actorId),index('vnext_memberships_project_role').on(table.projectId,table.roleId)]);

export const vnextPolicies=sqliteTable('vnext_policies',{
  id:text('id').primaryKey(),
  projectId:text('project_id').notNull(),
  version:integer('version').notNull(),
  documentJson:text('document_json').notNull(),
  createdAt:text('created_at').notNull(),
  updatedAt:text('updated_at').notNull(),
},table=>[uniqueIndex('vnext_policies_project').on(table.projectId)]);

export const vnextAuditLogs=sqliteTable('vnext_audit_logs',{
  id:text('id').primaryKey(),
  actorId:text('actor_id'),
  subjectId:text('subject_id').notNull(),
  projectId:text('project_id').notNull().default(''),
  action:text('action').notNull(),
  policyVersion:integer('policy_version'),
  resourceRevision:integer('resource_revision'),
  result:text('result').notNull(),
  reasonCode:text('reason_code').notNull().default(''),
  detailsJson:text('details_json').notNull(),
  createdAt:text('created_at').notNull(),
},table=>[index('vnext_audit_project_created').on(table.projectId,table.createdAt),index('vnext_audit_subject_created').on(table.subjectId,table.createdAt)]);

export const vnextBootstrapReceipts=sqliteTable('vnext_bootstrap_receipts',{
  id:text('id').primaryKey(),
  generation:text('generation').notNull(),
  subjectId:text('subject_id').notNull(),
  actorId:text('actor_id').notNull().references(()=>vnextActors.id),
  projectId:text('project_id').notNull(),
  membershipId:text('membership_id').notNull().references(()=>vnextProjectMemberships.id),
  configFingerprint:text('config_fingerprint').notNull(),
  createdAt:text('created_at').notNull(),
},table=>[uniqueIndex('vnext_bootstrap_generation').on(table.generation),uniqueIndex('vnext_bootstrap_membership').on(table.membershipId)]);
