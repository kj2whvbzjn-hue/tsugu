import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiService} from '../engineering-design-graph/api-v1.mjs';
const call=(api,method,url,body,headers={})=>api.handle({method,url,body,headers});

test('project summary exposes validation and readiness',async()=>{const api=createApiService(),r=await call(api,'GET','/api/v1/projects/p1/summary');assert.equal(r.status,200);assert.ok(r.body.validation);assert.ok(r.body.readiness)});
test('artifact PATCH stages a changeset rather than mutating current state',async()=>{const api=createApiService(),before=await call(api,'GET','/api/v1/artifacts/req1');const staged=await call(api,'PATCH','/api/v1/artifacts/req1',{title:'Changed'});const after=await call(api,'GET','/api/v1/artifacts/req1');assert.equal(staged.status,202);assert.equal(after.body.title,before.body.title)});
test('changeset preview and apply update immutable version history',async()=>{const api=createApiService(),staged=await call(api,'PATCH','/api/v1/artifacts/req1',{title:'Changed'}),id=staged.body.changeSet.id;const preview=await call(api,'POST',`/api/v1/change-sets/${id}/impact-preview`);assert.equal(preview.status,200);const applied=await call(api,'POST',`/api/v1/change-sets/${id}/apply`);assert.equal(applied.status,200);const versions=await call(api,'GET','/api/v1/artifacts/req1/versions');assert.equal(versions.body.items.length,2)});
test('invalid relation is rejected before staging',async()=>{const api=createApiService(),r=await call(api,'POST','/api/v1/projects/p1/relations',{fromArtifactId:'req1',toArtifactId:'task1',type:'implements'});assert.equal(r.status,422);assert.equal(r.body.code,'RELATION_INVALID')});
test('implementation package endpoint is task rooted',async()=>{const api=createApiService(),r=await call(api,'POST','/api/v1/projects/p1/implementation-packages',{taskIds:['task1']});assert.equal(r.status,201);assert.deepEqual(r.body.manifest.rootTaskIds,['task1'])});
