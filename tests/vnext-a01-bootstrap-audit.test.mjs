import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

async function load(file){
  const b=await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',write:false});
  return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
}

const bootstrap=await load('app/vnext/server/bootstrap.ts');
const audit=await load('app/vnext/server/audit.ts');

function memoryStore(){
  const state={actors:[],roles:[],memberships:[],receipts:[],audits:[]};
  return {
    state,
    async getBootstrapReceipt(generation){return state.receipts.find(x=>x.generation===generation)??null;},
    async getActorBySubject(subjectId){return state.actors.find(x=>x.subjectId===subjectId)??null;},
    async commitBootstrap(candidate){
      const existing=state.receipts.find(x=>x.generation===candidate.receipt.generation);
      if(existing)return existing;
      if(!state.actors.some(x=>x.id===candidate.actor.id))state.actors.push(candidate.actor);
      if(!state.roles.some(x=>x.id===candidate.role.id))state.roles.push(candidate.role);
      if(!state.memberships.some(x=>x.id===candidate.membership.id))state.memberships.push(candidate.membership);
      state.receipts.push(candidate.receipt);
      state.audits.push(candidate.audit);
      return candidate.receipt;
    },
    async appendAudit(event){state.audits.push(event);},
  };
}

const principal={subjectId:'subject-configured',emailHash:'email:test'};
const config={generation:'bootstrap-v1',projectId:'project-bootstrap',allowedSubjectIds:['subject-configured']};
const runtime={now:()=>new Date('2026-09-10T12:00:00.000Z'),randomId:(prefix)=>`${prefix}-fixed`};

test('A-01 bootstrap rejects missing or unauthorized config and never promotes the first visitor',async()=>{
  const store=memoryStore();
  await assert.rejects(()=>bootstrap.bootstrapInitialAdmin(store,{subjectId:'first-visitor'},undefined,runtime),e=>e&&e.code==='BOOTSTRAP_NOT_AUTHORIZED');
  await assert.rejects(()=>bootstrap.bootstrapInitialAdmin(store,{subjectId:'first-visitor'},config,runtime),e=>e&&e.code==='BOOTSTRAP_NOT_AUTHORIZED');
  assert.deepEqual({actors:store.state.actors.length,roles:store.state.roles.length,memberships:store.state.memberships.length,receipts:store.state.receipts.length,audits:store.state.audits.length},{actors:0,roles:0,memberships:0,receipts:0,audits:0});
});

test('A-01 configured bootstrap creates exactly one admin membership and is idempotent',async()=>{
  const store=memoryStore();
  const first=await bootstrap.bootstrapInitialAdmin(store,principal,config,runtime);
  const second=await bootstrap.bootstrapInitialAdmin(store,principal,config,runtime);
  assert.equal(first.idempotent,false);
  assert.equal(second.idempotent,true);
  assert.equal(second.receiptId,first.receiptId);
  assert.deepEqual({actors:store.state.actors.length,roles:store.state.roles.length,memberships:store.state.memberships.length,receipts:store.state.receipts.length,audits:store.state.audits.length},{actors:1,roles:1,memberships:1,receipts:1,audits:1});
  assert.equal(store.state.roles[0].name,'bootstrap-admin');
  assert.ok(store.state.roles[0].permissions.includes('membership.manage'));
  assert.equal(store.state.memberships[0].actorId,store.state.actors[0].id);
});

test('A-01 bootstrap generation cannot silently change authority and audit records are append-only creations',async()=>{
  const store=memoryStore();
  await bootstrap.bootstrapInitialAdmin(store,principal,config,runtime);
  const changed={...config,projectId:'different-project'};
  await assert.rejects(()=>bootstrap.bootstrapInitialAdmin(store,principal,changed,runtime),e=>e&&e.code==='STALE_POLICY');
  assert.equal(store.state.memberships.length,1);
  const event1=await audit.appendAudit(store,{actorId:store.state.actors[0].id,subjectId:principal.subjectId,projectId:config.projectId,action:'project.write',policyVersion:1,resourceRevision:2,result:'DENY',reasonCode:'FORBIDDEN',details:{source:'test'}},runtime);
  const event2=await audit.appendAudit(store,{actorId:store.state.actors[0].id,subjectId:principal.subjectId,projectId:config.projectId,action:'project.write',policyVersion:1,resourceRevision:2,result:'ALLOW',reasonCode:'',details:{source:'retest'}},{...runtime,randomId:(prefix)=>`${prefix}-second`});
  assert.notEqual(event1.id,event2.id);
  assert.equal(store.state.audits.length,3);
  assert.equal(store.state.audits[1].result,'DENY');
  assert.equal(store.state.audits[2].result,'ALLOW');
  assert.equal(typeof audit.updateAudit,'undefined');
});
