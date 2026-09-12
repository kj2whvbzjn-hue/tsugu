import test from 'node:test';
import assert from 'node:assert/strict';
import {OutboxWorker,createInMemoryPublisher} from '../engineering-design-graph/outbox-worker.mjs';

test('outbox worker publishes pending events and marks them published',async()=>{
  const events=[{id:'e1',eventType:'changeset.applied',aggregateType:'project',aggregateId:'p1',payload:{revision:2},createdAt:'2026-09-13T00:00:00Z'}],marked=[];
  const store={async pending(){return events},async markPublished(id){marked.push(id)}};const publisher=createInMemoryPublisher();
  const result=await new OutboxWorker({store,publisher}).runOnce();assert.deepEqual(result,{fetched:1,published:1,failed:0,deadLettered:0,errors:[]});assert.deepEqual(marked,['e1']);assert.equal(publisher.messages[0].type,'changeset.applied');
});

test('outbox worker records retry state after publish failure',async()=>{
  let marked=false,failed=null;const store={async pending(){return[{id:'e2',event_type:'artifact.updated',aggregate_type:'artifact',aggregate_id:'a1',payload:{},attempt_count:1}]},async markPublished(){marked=true},async markFailed(id,error,options){failed={id,error:String(error.message),options};return{attempt_count:2,dead_lettered_at:null}}},publisher={async publish(){throw new Error('broker unavailable')}};
  const result=await new OutboxWorker({store,publisher,maxAttempts:4,baseDelaySeconds:10}).runOnce();assert.equal(result.failed,1);assert.equal(result.published,0);assert.equal(result.deadLettered,0);assert.equal(marked,false);assert.equal(failed.id,'e2');assert.equal(failed.options.maxAttempts,4);assert.match(result.errors[0].message,/broker unavailable/);assert.equal(result.errors[0].attemptCount,2);
});

test('outbox worker reports dead-letter transition at retry limit',async()=>{
  const store={async pending(){return[{id:'e3',event_type:'artifact.updated',aggregate_type:'artifact',aggregate_id:'a1',payload:{},attempt_count:7}]},async markPublished(){},async markFailed(){return{attempt_count:8,dead_lettered_at:'2026-09-13T00:00:00Z'}}},publisher={async publish(){throw new Error('still unavailable')}};
  const result=await new OutboxWorker({store,publisher,maxAttempts:8}).runOnce();assert.equal(result.failed,1);assert.equal(result.deadLettered,1);assert.equal(result.errors[0].deadLettered,true);assert.equal(result.errors[0].attemptCount,8);
});
