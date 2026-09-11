const test=require('node:test');
const assert=require('node:assert/strict');
const G=require('../static/core-governance.js');
const CS=require('../static/core-governance-changeset.js');
const human={id:'github:1',subject:'github:user:1',kind:'HUMAN',role:'PROJECT_ADMIN'};
const bot={id:'github-actions[bot]',subject:'github-actions',kind:'BOT',role:'PROJECT_ADMIN'};
const editor={id:'github:2',subject:'github:user:2',kind:'HUMAN',role:'EDITOR'};
const H=s=>'sha256:'+require('node:crypto').createHash('sha256').update(s).digest('hex');
function ref(type,id,version=1,hash=H(`${type}:${id}:${version}`)){return{type,id,version,hash};}
function seed(){return G.createRegistry({projectId:'project:b03'});}

test('Task start and completion conditions are separate and plan updates invalidate old approval targets',()=>{
  let s=G.createTask(seed(),{id:'task:1',name:'Build',subject:ref('BOX_INSTANCE','box:1'),purpose:'ship',startConditions:[{type:'EVENT',ref:ref('EVENT','event:start')}],completionConditions:[{type:'CHECK',ref:ref('REQUIREMENT_SNAPSHOT','snap:1')}],requiredStartApprovals:[{approvalType:'PLAN',policyVersion:'p1',humanRequired:true}],requiredCompletionApprovals:[{approvalType:'FINAL',policyVersion:'p1',humanRequired:true}]},{actor:editor,now:'2026-09-11T00:00:00Z'});
  const old=G.taskApprovalTarget(s,'task:1');
  s=G.createApproval(s,{id:'approval:plan',approvalType:'PLAN',target:old,policyVersion:'p1',humanRequired:true,expiresAt:'2026-09-13T00:00:00Z',reason:'approved'},{actor:human,now:'2026-09-11T00:01:00Z'});
  assert.equal(G.approvalStatus(s,'approval:plan',{now:'2026-09-11T00:02:00Z'}),'VALID');
  s=G.updateTaskPlan(s,'task:1',{purpose:'ship safely'},{actor:editor,now:'2026-09-11T00:03:00Z'});
  const current=G.taskApprovalTarget(s,'task:1');
  assert.notEqual(current.hash,old.hash);assert.equal(current.version,2);
  assert.throws(()=>G.assertApprovalFor(s,'approval:plan',{approvalType:'PLAN',policyVersion:'p1',humanRequired:true,target:current},{now:'2026-09-11T00:04:00Z'}),e=>e.code==='APPROVAL_TARGET_MISMATCH');
});

test('human-required approval cannot be satisfied by bot/AI and actor fields in payload are rejected',()=>{
  let s=seed();
  assert.throws(()=>G.createApproval(s,{id:'approval:bad',approvalType:'FINAL',target:ref('TASK','task:x'),policyVersion:'p1',humanRequired:true,reason:'x'},{actor:bot,now:'2026-09-11T00:00:00Z'}),e=>e.code==='HUMAN_APPROVAL_REQUIRED');
  assert.throws(()=>G.createApproval(s,{id:'approval:spoof',approvalType:'FINAL',target:ref('TASK','task:x'),policyVersion:'p1',humanRequired:false,approvedBy:'someone'},{actor:human,now:'2026-09-11T00:00:00Z'}),e=>e.code==='ACTOR_AUTHORITY_FROM_INPUT_REJECTED');
});

test('approval revocation is append-only and expiry is evaluated at use time',()=>{
  let s=G.createApproval(seed(),{id:'approval:1',approvalType:'OTHER',target:ref('TASK','task:1'),policyVersion:'p1',humanRequired:false,expiresAt:'2026-09-12T00:00:00Z'},{actor:human,now:'2026-09-11T00:00:00Z'});
  assert.equal(G.approvalStatus(s,'approval:1',{now:'2026-09-11T12:00:00Z'}),'VALID');
  assert.equal(G.approvalStatus(s,'approval:1',{now:'2026-09-12T00:00:00Z'}),'EXPIRED');
  const before=s.approvals[0].contentHash;
  s=G.revokeApproval(s,'approval:1',{reason:'cancelled'},{actor:human,now:'2026-09-11T13:00:00Z'});
  assert.equal(s.approvals[0].contentHash,before);assert.equal(s.approvalRevocations.length,1);assert.equal(G.approvalStatus(s,'approval:1',{now:'2026-09-11T13:01:00Z'}),'REVOKED');
});

test('rule weakening waiver requires exact human approval, scope, versions, hashes and remains revocable',()=>{
  let s=seed();
  const request={id:'waiver:1',projectId:'project:b03',targetRule:ref('RULE_DEFINITION','rule:new',2),supersededRule:ref('RULE_DEFINITION','rule:new',1),scope:ref('BOX_INSTANCE','box:1'),policyVersion:'policy:waiver:v1',expiresAt:'2026-09-13T00:00:00.000Z',reason:'temporary compatibility'};
  const requestHash=G.sha256(request);
  s=G.createApproval(s,{id:'approval:waiver',approvalType:'WAIVER',target:{type:'WAIVER',id:'waiver:1',version:1,hash:requestHash},policyVersion:'policy:waiver:v1',humanRequired:true,expiresAt:'2026-09-13T00:00:00Z',reason:'human exception'},{actor:human,now:'2026-09-11T00:00:00Z'});
  s=G.createWaiver(s,{...request,approvalId:'approval:waiver'},{actor:editor,now:'2026-09-11T00:01:00Z'});
  const w=G.assertRuleWeakeningWaiver(s,'waiver:1',request,{now:'2026-09-11T00:02:00Z'});assert.equal(w.approvalId,'approval:waiver');
  assert.throws(()=>G.assertRuleWeakeningWaiver(s,'waiver:1',{...request,scope:ref('BOX_INSTANCE','box:2')},{now:'2026-09-11T00:02:00Z'}),e=>e.code==='WAIVER_TARGET_MISMATCH');
  s=G.revokeWaiver(s,'waiver:1',{reason:'no longer needed'},{actor:human,now:'2026-09-11T00:03:00Z'});
  assert.throws(()=>G.assertRuleWeakeningWaiver(s,'waiver:1',request,{now:'2026-09-11T00:04:00Z'}),e=>e.code==='WAIVER_REVOKED');
});

test('Decision is hash-fixed; Issue resolution retains original issue and appends event',()=>{
  let s=G.createDecision(seed(),{id:'decision:1',version:1,title:'Keep existing hosting',rationale:'G0 contract',refs:[ref('DEPLOYMENT','dep:1')]},{actor:human,now:'2026-09-11T00:00:00Z'});
  const decisionHash=s.decisions[0].contentHash;
  s=G.createIssue(s,{id:'issue:1',title:'Fix failure',description:'regression',sourceCheckIds:['check:fail:1']},{actor:editor,now:'2026-09-11T00:01:00Z'});
  s=G.resolveIssue(s,'issue:1',{reason:'fixed'},{actor:editor,now:'2026-09-11T00:02:00Z'});
  assert.equal(s.decisions[0].contentHash,decisionHash);assert.equal(s.issues[0].status,'RESOLVED');assert.deepEqual(s.issues[0].sourceCheckIds,['check:fail:1']);assert.equal(s.issueEvents.filter(x=>x.issueId==='issue:1').length,2);
});

test('Hold reasons are additive, resolving one keeps HOLD, Resume is request-only before B-06, Cancel is terminal',()=>{
  let s=G.createTask(seed(),{id:'task:run',name:'Run',subject:ref('BOX_INSTANCE','box:1'),purpose:'run'},{actor:editor,now:'2026-09-11T00:00:00Z'});
  const raw=JSON.parse(G.serialize(s));raw.tasks[0].state='IN_PROGRESS';s=G.validateState(raw);
  s=G.holdTask(s,'task:run',{reasonId:'manual',reason:'manual hold'},{actor:editor,now:'2026-09-11T00:01:00Z'});
  s=G.interruptTask(s,'task:run',{reasonId:'interrupt:1',reason:'lost dependency'},{actor:editor,now:'2026-09-11T00:02:00Z'});
  assert.equal(G.activeHoldReasons(s,'task:run').length,2);
  s=G.resolveTaskHoldReason(s,'task:run','manual',{reason:'cleared'},{actor:editor,now:'2026-09-11T00:03:00Z'});assert.equal(s.tasks[0].state,'HOLD');assert.equal(G.activeHoldReasons(s,'task:run').length,1);
  s=G.requestResumeTask(s,'task:run',{reason:'try resume'},{actor:editor,now:'2026-09-11T00:04:00Z'});assert.equal(s.tasks[0].state,'HOLD');assert.throws(()=>G.resumeTask(s,'task:run'),e=>e.code==='TASK_EVALUATION_NOT_AVAILABLE_UNTIL_B06');
  s=G.cancelTask(s,'task:run',{reason:'stop'},{actor:editor,now:'2026-09-11T00:05:00Z'});assert.equal(s.tasks[0].state,'CANCELLED');
});

test('GovernanceChangeSet fixes actor separately from payload and rejects stale/idempotency misuse',()=>{
  const initial=CS.createAggregate(seed()),blob='a'.repeat(40);
  const cs=CS.createChangeSet({id:'cs:1',projectId:'project:b03',idempotencyKey:'idem:1',baseRevision:initial.revision,baseBlobSha:blob,operations:[{type:'CREATE_TASK',id:'task:1',name:'Task',subject:ref('BOX_INSTANCE','box:1'),purpose:'p',at:'2026-09-11T00:00:00Z'}]});
  const v=CS.validateChangeSet(initial,blob,cs,{actor:editor,now:'2026-09-11T00:00:01Z'});const p=CS.prepareApply(initial,blob,cs,v.validationRecord,{actor:editor,now:'2026-09-11T00:00:02Z'});assert.equal(p.status,'READY');assert.equal(p.aggregate.registry.tasks[0].createdAt,'2026-09-11T00:00:00.000Z');
  assert.throws(()=>CS.prepareApply(initial,blob,cs,v.validationRecord,{actor:human,now:'2026-09-11T00:00:02Z'}),e=>e.code==='GOVERNANCE_VALIDATION_RECORD_MISMATCH');
  assert.throws(()=>CS.validateChangeSet(initial,'b'.repeat(40),cs,{actor:editor,now:'2026-09-11T00:00:03Z'}),e=>e.code==='STALE_CHANGESET');
});
