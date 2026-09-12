import test from 'node:test';
import assert from 'node:assert/strict';
import {OutboxWorker,createInMemoryPublisher} from '../engineering-design-graph/outbox-worker.mjs';

test('outbox worker publishes pending events and marks them published',async()=>{
  const events=[{id:'e1',eventType:'changeset.applied',aggregateType:'project',aggregateId:'p1',payload:{revision:2},createdAt:'2026-09-13T00:00:00Z'}],marked=[];
  const store={async pending(){return events},async markPublished(id){marked.push(id)}};const publisher=createInMemoryPublisher();
  const result=await new OutboxWorker({store,publisher}).runOnce();assert.deepEqual(result,{fetched:1,published:1,failed:0,errors:[]});assert.deepEqual(marked,['e1']);assert.equal(publisher.messages[0].type,'changeset.applied');
});

test('outbox worker leaves failed event pending for retry',async()=>{
  let marked=false;const store={async pending(){return[{id:'e2',event_type:'artifact.updated',aggregate_type:'artifact',aggregate_id:'a1',payload:{}}]},async markPublished(){marked=true}},publisher={async publish(){throw new Error('broker unavailable')}};
  const result=await new OutboxWorker({store,publisher}).runOnce();assert.equal(result.failed,1);assert.equal(result.published,0);assert.equal(marked,false);assert.match(result.errors[0].message,/broker unavailable/);
});
