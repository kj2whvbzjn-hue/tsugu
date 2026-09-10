import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const migration=readFileSync('drizzle/0007_vnext_repository_environment_deployment.sql','utf8');

test('A-02 migration enforces repository+commit uniqueness without conflating repositories',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(migration);
  db.prepare('INSERT INTO vnext_repositories (id,project_id,provider,external_ref,revision,created_at) VALUES (?,?,?,?,?,?)').run('repo-1','project-1','github','one',1,'now');
  db.prepare('INSERT INTO vnext_repositories (id,project_id,provider,external_ref,revision,created_at) VALUES (?,?,?,?,?,?)').run('repo-2','project-1','github','two',1,'now');
  const insert=db.prepare('INSERT INTO vnext_repository_commit_refs (id,project_id,repository_id,repository_revision,commit_sha,tree_sha,created_at) VALUES (?,?,?,?,?,?,?)');
  insert.run('commit-1','project-1','repo-1',1,'a'.repeat(40),'b'.repeat(40),'now');
  assert.throws(()=>insert.run('commit-dup','project-1','repo-1',1,'a'.repeat(40),'b'.repeat(40),'now'));
  assert.doesNotThrow(()=>insert.run('commit-2','project-1','repo-2',1,'a'.repeat(40),'b'.repeat(40),'now'));
});

test('A-02 persistence permits separate deployments of the same commit but provider deployment identity is immutable',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(migration);
  db.prepare('INSERT INTO vnext_repositories (id,project_id,provider,external_ref,revision,created_at) VALUES (?,?,?,?,?,?)').run('repo-1','project-1','github','one',1,'now');
  db.prepare('INSERT INTO vnext_environments (id,project_id,environment_key,provider_ref,revision,created_at) VALUES (?,?,?,?,?,?)').run('env-1','project-1','production','',1,'now');
  db.prepare('INSERT INTO vnext_repository_commit_refs (id,project_id,repository_id,repository_revision,commit_sha,tree_sha,created_at) VALUES (?,?,?,?,?,?,?)').run('commit-1','project-1','repo-1',1,'a'.repeat(40),'b'.repeat(40),'now');
  const insert=db.prepare('INSERT INTO vnext_deployments (id,project_id,environment_id,environment_revision,repository_id,repository_revision,commit_ref_id,commit_sha,tree_sha,artifact_digest,config_version,schema_version,provider_deployment_ref,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const args=['project-1','env-1',1,'repo-1',1,'commit-1','a'.repeat(40),'b'.repeat(40),`sha256:${'c'.repeat(64)}`,'cfg-1','0007'];
  insert.run('deployment-1',...args,'provider-dep-1','now');
  assert.doesNotThrow(()=>insert.run('deployment-2',...args,'provider-dep-2','now'));
  assert.throws(()=>insert.run('deployment-3',...args,'provider-dep-1','now'));
});

test('A-02 target store exposes create/read paths only for immutable target records',()=>{
  const source=readFileSync('db/vnext/target-store.ts','utf8');
  for(const table of ['vnext_repositories','vnext_repository_commit_refs','vnext_repository_baselines','vnext_environments','vnext_deployments']){
    assert.equal(new RegExp(`UPDATE\\s+${table}`,'i').test(source),false,`${table} must not have UPDATE path`);
    assert.equal(new RegExp(`DELETE\\s+FROM\\s+${table}`,'i').test(source),false,`${table} must not have DELETE path`);
  }
  assert.doesNotMatch(source,/\b(?:update|delete)(?:Repository|CommitRef|Baseline|Environment|Deployment)\b/);
});
