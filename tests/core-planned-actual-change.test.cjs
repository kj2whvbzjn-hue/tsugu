const test=require('node:test');
const assert=require('node:assert/strict');
const Domain=require('../static/core-planned-actual-change.js');
const Git=require('../static/core-git-diff.js');
const CS=require('../static/core-planned-actual-change-changeset.js');

const SHA={A:'a'.repeat(40),B:'b'.repeat(40),C:'c'.repeat(40),D:'d'.repeat(40),E:'e'.repeat(40),F:'f'.repeat(40)};
const actor={id:'github:1',subject:'octo',kind:'HUMAN',role:'PROJECT_ADMIN'};
function architecture(){return {type:'ProjectArchitecture',project:{id:'project:b05'},repositoryScopes:[{repositoryId:1,fullName:'octo/repo'}],pathEntries:[
  {id:'path:src',repositoryId:1,kind:'DIRECTORY',name:'src',parentPathEntryId:null},
  {id:'path:app',repositoryId:1,kind:'FILE',name:'app.js',parentPathEntryId:'path:src'},
  {id:'path:old',repositoryId:1,kind:'FILE',name:'old.js',parentPathEntryId:'path:src'},
  {id:'path:readme',repositoryId:1,kind:'FILE',name:'README.md',parentPathEntryId:null},
]};}
function response(status,body){return Promise.resolve({ok:status>=200&&status<300,status,text:async()=>body==null?'':JSON.stringify(body)});}
function githubFetch({head=SHA.B,parents=[SHA.A],files=[{filename:'src/app.js',status:'modified',sha:SHA.C}],fail=false,base=SHA.A}={}){
  return async url=>{
    if(fail) return response(503,{message:'unavailable'});
    if(url.includes(`/commits/${head}`)) return response(200,{sha:head,parents:parents.map(sha=>({sha}))});
    if(url.includes(`/compare/${base}...${head}`)) return response(200,{base_commit:{sha:base},commits:[{sha:head}],files});
    return response(404,{message:'not found'});
  };
}
async function capture(opts={}){return Git.captureComparison({fetch:githubFetch(opts),owner:'octo',repo:'repo',projectId:'project:b05',repositoryId:1,baseCommitSha:opts.base||SHA.A,headCommitSha:opts.head||SHA.B,comparisonParentSha:opts.comparisonParentSha,architecture:architecture(),now:'2026-09-11T15:00:00Z'});}
function plannedState(targets=[{pathEntryId:'path:app',changeType:'MODIFIED'}]){let s=Domain.createRegistry({projectId:'project:b05'});s=Domain.createPlannedChange(s,{id:'planned:1',repositoryId:1,baseCommitSha:SHA.A,targets,summary:'plan'},{actor,architecture:architecture(),now:'2026-09-11T14:00:00Z'});return s;}

test('PlannedChange fixes stable PathEntry IDs, not path strings',()=>{
  const s=plannedState();
  assert.deepEqual(s.plannedChanges[0].targets,[{pathEntryId:'path:app',changeType:'MODIFIED'}]);
  const moved=architecture(); moved.pathEntries.find(x=>x.id==='path:app').name='main.js';
  const view=Domain.architectureView(moved,'project:b05',1);
  assert.equal(view.byPath.get('src/main.js'),'path:app');
  assert.equal(s.plannedChanges[0].targets[0].pathEntryId,'path:app');
});

test('Git capture maps exact paths and explicit rename to stable IDs',async()=>{
  const c=await capture({files:[
    {filename:'src/app.js',status:'modified',sha:SHA.C},
    {filename:'src/new.js',previous_filename:'src/old.js',status:'renamed',sha:SHA.D}
  ]});
  assert.equal(c.files[0].pathEntryId,'path:app'); assert.equal(c.files[0].mappingStatus,'MAPPED');
  assert.equal(c.files[1].pathEntryId,'path:old'); assert.equal(c.files[1].mappingStatus,'MAPPED_RENAME');
  assert.match(c.gitDiffHash,/^sha256:[a-f0-9]{64}$/); assert.match(c.captureHash,/^sha256:[a-f0-9]{64}$/);
});

test('Unknown rename never guesses a stable ID',async()=>{
  const c=await capture({files:[{filename:'src/new.js',status:'renamed',sha:SHA.D}]});
  assert.equal(c.files[0].pathEntryId,null);
  assert.equal(c.files[0].mappingStatus,'CONFIRMATION_REQUIRED');
  let s=plannedState([{pathEntryId:'path:old',changeType:'RENAMED'}]);
  s=Domain.registerActualChange(s,{id:'actual:rename',plannedChangeId:'planned:1',capture:c},{actor,now:'2026-09-11T15:01:00Z'});
  assert.equal(s.actualChanges[0].captureStatus,'CONFIRMATION_REQUIRED');
});

test('Merge head requires an explicit comparison parent and records it',async()=>{
  const opts={head:SHA.C,parents:[SHA.A,SHA.B],files:[{filename:'README.md',status:'modified',sha:SHA.D}]};
  await assert.rejects(()=>capture(opts),e=>e.code==='MERGE_COMPARISON_PARENT_REQUIRED');
  const c=await capture({...opts,comparisonParentSha:SHA.B});
  assert.equal(c.comparisonParentSha,SHA.B); assert.deepEqual(c.headParentShas,[SHA.A,SHA.B]);
  await assert.rejects(()=>capture({...opts,comparisonParentSha:SHA.E}),e=>e.code==='INVALID_MERGE_COMPARISON_PARENT');
});

test('Plan/actual reconciliation exposes missing, unexpected and unmapped changes',async()=>{
  let s=plannedState([{pathEntryId:'path:app',changeType:'MODIFIED'},{pathEntryId:'path:old',changeType:'REMOVED'}]);
  const c=await capture({files:[{filename:'src/app.js',status:'modified',sha:SHA.C},{filename:'untracked.txt',status:'added',sha:SHA.D}]});
  s=Domain.registerActualChange(s,{id:'actual:1',plannedChangeId:'planned:1',capture:c},{actor,now:'2026-09-11T15:02:00Z'});
  const rec=Domain.derivePlanActualReconciliation(s,'planned:1','actual:1',{status:'MATCH',gitDiffHash:c.gitDiffHash},{actor,now:'2026-09-11T15:03:00Z'});
  assert.equal(rec.status,'PARTIAL'); assert.deepEqual(rec.matchedPathEntryIds,['path:app']); assert.deepEqual(rec.missingPlannedPathEntryIds,['path:old']); assert.deepEqual(rec.unresolvedPaths,['untracked.txt']);
});

test('Git reconciliation re-fetches immutable facts and fails closed on unknown/mismatch',async()=>{
  let s=plannedState(); const c=await capture(); s=Domain.registerActualChange(s,{id:'actual:1',plannedChangeId:'planned:1',capture:c},{actor,now:'2026-09-11T15:02:00Z'}); const a=s.actualChanges[0];
  const ok=await Git.reconcileActualChange({fetch:githubFetch(),actualChange:a,architecture:architecture(),now:'2026-09-11T15:04:00Z'}); assert.equal(ok.status,'MATCH');
  const changed=await Git.reconcileActualChange({fetch:githubFetch({files:[{filename:'README.md',status:'modified',sha:SHA.C}]}),actualChange:a,architecture:architecture(),now:'2026-09-11T15:05:00Z'}); assert.equal(changed.status,'MISMATCH');
  const unknown=await Git.reconcileActualChange({fetch:githubFetch({fail:true}),actualChange:a,architecture:architecture(),now:'2026-09-11T15:06:00Z'}); assert.equal(unknown.status,'UNKNOWN');
});

test('B-05 ChangeSet fixes actor, revision/blob CAS and rejects capture tampering',async()=>{
  const registry=Domain.createRegistry({projectId:'project:b05'}),agg=CS.createAggregate(registry),blob='1'.repeat(40);
  const cs=CS.createChangeSet({id:'cs:b05:1',projectId:'project:b05',idempotencyKey:'idem:b05:1',baseRevision:1,baseBlobSha:blob,operations:[{type:'CREATE_PLANNED_CHANGE',id:'planned:1',repositoryId:1,baseCommitSha:SHA.A,targets:[{pathEntryId:'path:app',changeType:'MODIFIED'}],summary:'plan',at:'2026-09-11T15:10:00Z'}]});
  const v=CS.validateChangeSet(agg,blob,cs,{actor,architecture:architecture(),now:'2026-09-11T15:10:01Z'}); assert.equal(v.validationRecord.status,'PASS');
  assert.throws(()=>CS.validateChangeSet(agg,'2'.repeat(40),cs,{actor,architecture:architecture()}),e=>e.code==='STALE_CHANGESET');
  assert.throws(()=>CS.createChangeSet({id:'bad',projectId:'project:b05',idempotencyKey:'bad',baseRevision:1,baseBlobSha:blob,operations:[{type:'CREATE_PLANNED_CHANGE',actorId:'spoof',at:'2026-09-11T15:00:00Z'}]}),e=>e.code==='ACTOR_AUTHORITY_FROM_INPUT_REJECTED');
  const c=await capture(); const tampered={...c,files:[...c.files,{changeType:'ADDED',path:'fake.txt',previousPath:null,blobSha:SHA.E,pathEntryId:null,mappingStatus:'UNMAPPED'}]};
  let s=plannedState(); assert.throws(()=>Domain.registerActualChange(s,{id:'actual:tamper',plannedChangeId:'planned:1',capture:tampered},{actor}),e=>e.code==='GIT_COMPARISON_CAPTURE_HASH_MISMATCH');
  const actualCs=CS.createChangeSet({id:'cs:b05:actual',projectId:'project:b05',idempotencyKey:'idem:b05:actual',baseRevision:1,baseBlobSha:blob,operations:[{type:'REGISTER_ACTUAL_CHANGE',id:'actual:1',capture:c,at:'2026-09-11T15:10:00Z'}]});
  await CS.verifyGitOperations(githubFetch(),actualCs,{architecture:architecture()},registry);
  await assert.rejects(()=>CS.verifyGitOperations(githubFetch({files:[{filename:'README.md',status:'modified',sha:SHA.C}]}),actualCs,{architecture:architecture()},registry),e=>e.code==='GIT_REVALIDATION_MISMATCH');
  const prepared=CS.prepareApply(agg,blob,cs,v.validationRecord,{actor,architecture:architecture(),now:'2026-09-11T15:10:02Z'}); assert.equal(prepared.status,'READY'); assert.equal(prepared.aggregate.revision,2);
});
