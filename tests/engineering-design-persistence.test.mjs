import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSampleProject} from '../engineering-design-graph/core.mjs';
import {MemoryProjectRepository} from '../engineering-design-graph/repository.mjs';
import {createPersistentApiService} from '../engineering-design-graph/persistent-api.mjs';

test('persistent API saves staged mutations and reloads them',async()=>{
  const repo=new MemoryProjectRepository([makeSampleProject()]);
  const api=await createPersistentApiService({repository:repo});
  const staged=await api.handle({method:'PATCH',url:'/api/v1/artifacts/req1',body:{title:'Persisted staged title'},headers:{}});
  assert.equal(staged.status,202);
  const saved=await repo.get('p1');assert.equal(saved.changeSets.length,1);
  api.projects.clear();await api.reload();assert.equal(api.projects.get('p1').changeSets.length,1);
});

test('repository failure rolls API state back',async()=>{
  const base=new MemoryProjectRepository([makeSampleProject()]);
  let fail=true;
  const repo={list:()=>base.list(),get:id=>base.get(id),async save(p){if(fail){fail=false;throw new Error('db unavailable')}return base.save(p)}};
  const api=await createPersistentApiService({repository:repo});
  await assert.rejects(()=>api.handle({method:'PATCH',url:'/api/v1/artifacts/req1',body:{title:'Must rollback'},headers:{}}),/db unavailable/);
  assert.equal(api.projects.get('p1').changeSets.length,0);
  assert.notEqual(api.projects.get('p1').artifacts.find(a=>a.id==='req1').title,'Must rollback');
});
