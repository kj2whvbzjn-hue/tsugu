import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeProject} from '../engineering-design-graph/project-access.mjs';

test('project-scoped role authorizes architect and rejects missing membership',async()=>{
  const accessRepository={async roleFor(projectId,user){if(projectId==='p1'&&user==='u1')return'architect';return null}};
  await assert.doesNotReject(()=>authorizeProject({principal:{userId:'u1',roles:[]},projectId:'p1',permission:'readiness_override',accessRepository}));
  await assert.rejects(()=>authorizeProject({principal:{userId:'u2',roles:[]},projectId:'p1',permission:'read',accessRepository}),e=>e.code==='PROJECT_FORBIDDEN');
});

test('global admin bypasses project membership lookup',async()=>{
  let called=false;const accessRepository={async roleFor(){called=true;return null}};
  await authorizeProject({principal:{userId:'admin',roles:['admin']},projectId:'p1',permission:'admin',accessRepository});assert.equal(called,false);
});
