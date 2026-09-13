import test from 'node:test';
import assert from 'node:assert/strict';
import {addChangeItem,createChangeSet,makeSampleProject} from '../engineering-design-graph/core.mjs';
import {MemoryProjectRepository} from '../engineering-design-graph/repository.mjs';
import {EngineeringDesignApplicationService} from '../engineering-design-graph/application-service.mjs';
import {PostgresEngineeringDesignUnitOfWork} from '../engineering-design-graph/postgres-unit-of-work.mjs';

function stagedProject(){const p=makeSampleProject(),req=p.artifacts.find(a=>a.id==='req1'),cs=createChangeSet(p,'Transactional update','user-1');addChangeItem(cs,{kind:'update_artifact',artifactId:req.id,expectedRevision:req.revision,previousStatus:req.status,patch:{title:'Applied transactionally'}});return{p,cs}}

test('application service applies ChangeSet and records audit/outbox in transaction boundary',async()=>{
  const {p,cs}=stagedProject(),repo=new MemoryProjectRepository([p]),audit=[],events=[];
  const store={async recordAudit(x){const row={id:'audit-1',...x};audit.push(row);return row},async enqueue(x){const row={id:'event-1',...x};events.push(row);return row}};
  const service=new EngineeringDesignApplicationService({repository:repo,auditOutbox:store}),result=await service.applyChangeSet({changeSetId:cs.id,actorUserId:'user-1',traceId:'trace-1'});
  assert.equal(result.project.revision,p.revision+1);assert.equal(result.changeSet.status,'applied');assert.equal(audit.length,1);assert.equal(events.length,1);assert.equal(events[0].eventType,'changeset.applied');
  const saved=await repo.get('p1');assert.equal(saved.artifacts.find(a=>a.id==='req1').title,'Applied transactionally');assert.equal(saved.artifactVersions.length,p.artifactVersions.length+1);
});

test('repository transaction rolls back project when outbox enqueue fails',async()=>{
  const {p,cs}=stagedProject(),repo=new MemoryProjectRepository([p]),store={async recordAudit(){return{id:'audit-1'}},async enqueue(){throw new Error('outbox unavailable')}};
  const service=new EngineeringDesignApplicationService({repository:repo,auditOutbox:store});
  await assert.rejects(()=>service.applyChangeSet({changeSetId:cs.id,actorUserId:'user-1'}),/outbox unavailable/);
  const saved=await repo.get('p1');assert.equal(saved.revision,p.revision);assert.equal(saved.changeSets.find(x=>x.id===cs.id).status,'open');assert.notEqual(saved.artifacts.find(a=>a.id==='req1').title,'Applied transactionally');
});

test('Postgres unit of work checks out and releases one dedicated client',async()=>{
  let connects=0,releases=0;const fakeClient={query:async()=>({rows:[]}),release(){releases++}},pool={async connect(){connects++;return fakeClient}};
  const uow=new PostgresEngineeringDesignUnitOfWork(pool);await uow.withClient(async client=>{assert.equal(client,fakeClient)});assert.equal(connects,1);assert.equal(releases,1);
});
