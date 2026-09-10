import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(path,'utf8');

test('A-01 vNext domain boundary does not import legacy model, DB schema, UI or runtime adapters',()=>{
  const domain=read('app/vnext/domain/identity.ts');
  for(const forbidden of ['app/model','db/schema','cloudflare:workers','next/headers','oai-authenticated-user-']){
    assert.equal(domain.includes(forbidden),false,`vNext domain must not depend on ${forbidden}`);
  }
  assert.match(domain,/Actor/);
  assert.match(domain,/ProjectMembership/);
  assert.match(domain,/Policy/);
});

test('A-01 server and DB boundaries are physically separated from legacy persistence contracts',()=>{
  const auth=read('app/vnext/server/auth-context.ts');
  const authz=read('app/vnext/server/authorization.ts');
  const bootstrap=read('app/vnext/server/bootstrap.ts');
  const audit=read('app/vnext/server/audit.ts');
  const schema=read('db/vnext/schema.ts');
  const store=read('db/vnext/store.ts');
  for(const source of [auth,authz,bootstrap,audit])assert.equal(source.includes("from '@/app/model'"),false);
  assert.equal(schema.includes("from '../schema'"),false);
  assert.equal(store.includes("from '../schema'"),false);
  assert.match(auth,/oai-authenticated-user-id/);
  assert.match(schema,/vnext_actors/);
  assert.match(schema,/vnext_audit_logs/);
});

test('A-01 0006 migration is additive and does not rewrite legacy tables or data',()=>{
  const sql=read('drizzle/0006_vnext_identity_audit_bootstrap.sql');
  for(const table of ['vnext_actors','vnext_roles','vnext_project_memberships','vnext_policies','vnext_audit_logs','vnext_bootstrap_receipts']){
    assert.match(sql,new RegExp('CREATE TABLE `'+table+'`'));
  }
  assert.doesNotMatch(sql,/\b(?:DROP|ALTER|UPDATE|DELETE|REPLACE)\b/i);
  assert.doesNotMatch(sql,/\bINSERT\s+INTO\s+`?(?:projects|revisions|original_files|deletion_jobs|proposals|evidences|evidence_versions|evidence_uploads)`?/i);
  assert.doesNotMatch(sql,/REFERENCES\s+`?projects`?\s*\(/i);
});
