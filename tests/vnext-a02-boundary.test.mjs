import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(path,'utf8');

test('A-02 domain stays independent from legacy schema, UI and Sites runtime',()=>{
  const domain=read('app/vnext/domain/deployment-target.ts');
  for(const forbidden of ['app/model','db/schema','cloudflare:workers','next/headers','oai-authenticated-user-']){
    assert.equal(domain.includes(forbidden),false,`A-02 domain must not depend on ${forbidden}`);
  }
  for(const symbol of ['RepositoryCommitRef','RepositoryBaseline','Environment','Deployment','VerificationTarget'])assert.match(domain,new RegExp(symbol));
});

test('A-02 server and DB code keep target persistence separate from legacy contracts',()=>{
  const service=read('app/vnext/server/deployment-target-service.ts');
  const schema=read('db/vnext/target-schema.ts');
  const store=read('db/vnext/target-store.ts');
  assert.equal(service.includes("from '@/app/model'"),false);
  assert.equal(service.includes("from '@/db/schema'"),false);
  assert.equal(schema.includes("from '../schema'"),false);
  assert.equal(store.includes("from '../schema'"),false);
  assert.match(service,/authorizeProjectAction/);
  assert.match(schema,/vnext_repository_commit_refs/);
  assert.match(schema,/vnext_deployments/);
});

test('A-02 0007 migration is additive and leaves legacy and A-01 tables untouched',()=>{
  const sql=read('drizzle/0007_vnext_repository_environment_deployment.sql');
  for(const table of ['vnext_repositories','vnext_repository_commit_refs','vnext_repository_baselines','vnext_environments','vnext_deployments']){
    assert.equal(sql.includes(`CREATE TABLE \`${table}\``),true,`missing ${table}`);
  }
  assert.doesNotMatch(sql,/(?:^|\n)\s*(?:DROP|ALTER|UPDATE|DELETE|REPLACE)\b/im);
  assert.doesNotMatch(sql,/\bINSERT\s+INTO\s+`?(?:projects|revisions|original_files|deletion_jobs|proposals|evidences|evidence_versions|evidence_uploads|vnext_actors|vnext_roles|vnext_project_memberships|vnext_policies|vnext_audit_logs|vnext_bootstrap_receipts)`?/i);
  assert.doesNotMatch(sql,/REFERENCES\s+`?projects`?\s*\(/i);
});
