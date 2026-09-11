const test = require('node:test');
const assert = require('node:assert/strict');
const Architecture = require('../static/core-architecture.js');
const Box = require('../static/core-box.js');
const BoxChangeSet = require('../static/core-box-changeset.js');

const BASE_SHA='a'.repeat(40), NEXT_SHA='b'.repeat(40);
function stageA(){
  let a=Architecture.createProjectArchitecture({projectId:'project:b01',name:'B01',repositoryScopes:[{repositoryId:1,fullName:'acme/app'}]});
  a=Architecture.addArchitectureNode(a,{id:'node:root',name:'Root'});
  a=Architecture.addArchitectureNode(a,{id:'node:child',name:'Child',parentNodeId:'node:root'});
  a=Architecture.addPathEntry(a,{id:'path:file',repositoryId:1,kind:'FILE',name:'app.js'});
  a=Architecture.addBinding(a,{id:'binding:a',pathEntryId:'path:file',architectureNodeId:'node:root',relation:'IMPLEMENTS'});
  return a;
}
function bstate(){return Box.migrateFromStageA(stageA());}
function publishedSchema(s,id,fields){s=Box.createSchemaDraft(s,{id,version:1,name:id,fields});return Box.publishSchemaDefinition(s,id,1,{now:'2026-09-11T00:00:00Z'});}
function publishedBox(s,id,schemaId,extra={}){s=Box.createBoxDefinitionDraft(s,{id,version:1,name:id,schemaDefinitionId:schemaId,schemaDefinitionVersion:1,metadata:extra.metadata||{}});if(extra.constraint)s=Box.addChildConstraint(s,{id:`constraint:${id}`,boxDefinitionId:id,boxDefinitionVersion:1,...extra.constraint});return Box.publishBoxDefinition(s,id,1,{now:'2026-09-11T00:00:01Z'});}

test('A→B migration preserves existing Node Binding ID/revision/history',()=>{
  const a=stageA(),s=Box.migrateFromStageA(a),old=a.bindings[0],m=s.bindings[0];
  assert.equal(m.id,old.id); assert.equal(m.revision,old.revision); assert.equal(m.targetType,'NODE');
  assert.equal(m.architectureNodeId,old.architectureNodeId); assert.equal(m.activeFromRevision,old.activeFromRevision);
});

test('B system Seed is idempotent and collision-safe',()=>{
  let s=bstate(); const before=s.architecture.project.revision; s=Box.seedSystemDefinitions(s); const seededRevision=s.architecture.project.revision;
  assert.equal(seededRevision,before+1); assert.equal(s.seedVersion,Box.SYSTEM_SEED_VERSION); assert.equal(s.schemaDefinitions.length,2); assert.equal(s.boxDefinitions.length,2);
  const again=Box.seedSystemDefinitions(s); assert.equal(again.architecture.project.revision,seededRevision); assert.equal(Box.serialize(again),Box.serialize(s));
  const bad=JSON.parse(Box.serialize(s)); bad.boxDefinitions.find(x=>x.id==='system:box:leaf').name='tampered';
  assert.throws(()=>Box.seedSystemDefinitions(bad),e=>['PUBLISHED_CONTENT_HASH_MISMATCH','SYSTEM_SEED_COLLISION'].includes(e.code));
});

test('Published Schema content is fixed by content hash',()=>{
  let s=publishedSchema(bstate(),'schema:one',[{name:'mode',type:'ENUM',required:true,enumValues:['A','B']}]);
  const stored=s.schemaDefinitions[0], tampered=JSON.parse(Box.serialize(s)); tampered.schemaDefinitions[0].fields[0].enumValues=['A','B','C'];
  assert.match(stored.contentHash,/^sha256:[a-f0-9]{64}$/); assert.throws(()=>Box.validateState(tampered),e=>e.code==='PUBLISHED_CONTENT_HASH_MISMATCH');
});

test('Published Box uses explicit next version and keeps old version immutable',()=>{
  let s=publishedSchema(bstate(),'schema:one',[{name:'name',type:'STRING',required:true}]);
  s=publishedBox(s,'box:one','schema:one',{metadata:{generation:1}}); const v1=s.boxDefinitions.find(x=>x.id==='box:one'&&x.version===1),hash1=v1.contentHash;
  s=Box.createNextBoxDefinitionVersion(s,'box:one',1,{metadata:{generation:2}}); const draft=s.boxDefinitions.find(x=>x.id==='box:one'&&x.version===2); assert.equal(draft.publishedAt,null);
  s=Box.publishBoxDefinition(s,'box:one',2,{now:'2026-09-11T00:00:02Z'}); assert.equal(s.boxDefinitions.find(x=>x.id==='box:one'&&x.version===1).contentHash,hash1); assert.notEqual(s.boxDefinitions.find(x=>x.id==='box:one'&&x.version===2).contentHash,hash1);
});

test('BoxInstance config rejects Schema type mismatch and unknown fields',()=>{
  let s=publishedSchema(bstate(),'schema:typed',[{name:'count',type:'NUMBER',required:true},{name:'enabled',type:'BOOLEAN',required:true}]); s=publishedBox(s,'box:typed','schema:typed');
  assert.throws(()=>Box.createBoxInstance(s,{id:'instance:bad',boxDefinitionId:'box:typed',boxDefinitionVersion:1,architectureNodeId:'node:root',config:{count:'1',enabled:true}}),e=>e.code==='SCHEMA_TYPE_MISMATCH');
  assert.throws(()=>Box.createBoxInstance(s,{id:'instance:bad2',boxDefinitionId:'box:typed',boxDefinitionVersion:1,architectureNodeId:'node:root',config:{count:1,enabled:true,extra:1}}),e=>e.code==='SCHEMA_UNKNOWN_FIELD');
});

test('ChildConstraint requires allowed child Schema and all count bounds',()=>{
  let s=publishedSchema(bstate(),'schema:parent',[{name:'name',type:'STRING',required:true}]); s=publishedSchema(s,'schema:child',[{name:'name',type:'STRING',required:true}]); s=publishedSchema(s,'schema:other',[{name:'name',type:'STRING',required:true}]);
  s=publishedBox(s,'box:parent','schema:parent',{constraint:{childSchemaDefinitionId:'schema:child',childSchemaDefinitionVersion:1,minCount:1,maxCount:1}}); s=publishedBox(s,'box:child','schema:child'); s=publishedBox(s,'box:other','schema:other');
  s=Box.createBoxInstance(s,{id:'instance:parent',boxDefinitionId:'box:parent',boxDefinitionVersion:1,architectureNodeId:'node:root',config:{name:'P'}});
  assert.throws(()=>Box.validateState(s),e=>e.code==='CHILD_CONSTRAINT_VIOLATION');
  assert.throws(()=>Box.createBoxInstance(s,{id:'instance:other',boxDefinitionId:'box:other',boxDefinitionVersion:1,architectureNodeId:'node:child',parentBoxInstanceId:'instance:parent',config:{name:'X'}}),e=>e.code==='CHILD_TYPE_NOT_ALLOWED');
  s=Box.createBoxInstance(s,{id:'instance:child',boxDefinitionId:'box:child',boxDefinitionVersion:1,architectureNodeId:'node:child',parentBoxInstanceId:'instance:parent',config:{name:'C'}}); assert.doesNotThrow(()=>Box.validateState(s));
  s=Box.createBoxInstance(s,{id:'instance:child2',boxDefinitionId:'box:child',boxDefinitionVersion:1,architectureNodeId:'node:child',parentBoxInstanceId:'instance:parent',config:{name:'C2'}}); assert.throws(()=>Box.validateState(s),e=>e.code==='CHILD_CONSTRAINT_VIOLATION');
});

test('Deprecated/Retired definitions retain existing fixed references but reject new instances',()=>{
  let s=publishedSchema(bstate(),'schema:life',[{name:'name',type:'STRING',required:true}]); s=publishedBox(s,'box:life','schema:life'); s=Box.createBoxInstance(s,{id:'instance:old',boxDefinitionId:'box:life',boxDefinitionVersion:1,architectureNodeId:'node:root',config:{name:'old'}});
  s=Box.deprecateBoxDefinition(s,'box:life',1,{now:'2026-09-11T00:01:00Z',actor:'actor:admin',id:'life:dep'}); assert.equal(Box.lifecycleStatus(s,'BOX_DEFINITION','box:life',1),'DEPRECATED'); assert.doesNotThrow(()=>Box.validateState(s));
  assert.throws(()=>Box.createBoxInstance(s,{id:'instance:new',boxDefinitionId:'box:life',boxDefinitionVersion:1,architectureNodeId:'node:root',config:{name:'new'}}),e=>e.code==='BOX_DEFINITION_NOT_ACTIVE_FOR_NEW_INSTANCE');
  s=Box.retireBoxDefinition(s,'box:life',1,{now:'2026-09-11T00:02:00Z',actor:'actor:admin',id:'life:ret'}); assert.equal(Box.lifecycleStatus(s,'BOX_DEFINITION','box:life',1),'RETIRED'); assert.doesNotThrow(()=>Box.validateState(s));
});

test('Binding target is exclusively Node or BoxInstance and Box-owned Node is derived',()=>{
  let s=Box.seedSystemDefinitions(bstate()); s=Box.createBoxInstance(s,{id:'instance:component',boxDefinitionId:'system:box:component',boxDefinitionVersion:1,architectureNodeId:'node:root',config:{name:'C'}});
  assert.throws(()=>Box.addBinding(s,{id:'binding:bad',pathEntryId:'path:file',targetType:'BOX_INSTANCE',boxInstanceId:'instance:component',architectureNodeId:'node:root',relation:'IMPLEMENTS'}),e=>e.code==='BINDING_TARGET_EXCLUSIVITY');
  s=Box.addBinding(s,{id:'binding:box',pathEntryId:'path:file',targetType:'BOX_INSTANCE',boxInstanceId:'instance:component',relation:'IMPLEMENTS'}); assert.equal(Box.bindingDesignNodeId(s,'binding:box'),'node:root');
});

test('Direct persistent write boundary remains closed; B changes require ChangeSet',()=>{assert.equal(Box.DIRECT_WRITE_ENABLED,false);assert.throws(()=>Box.assertDirectWriteDisabled(),e=>e.code==='BOX_CHANGESET_REQUIRED');});

test('BoxChangeSet requires deterministic IDs and publish/lifecycle timestamps',()=>{
  const agg=BoxChangeSet.createAggregate(bstate());
  assert.throws(()=>BoxChangeSet.createChangeSet({id:'cs',projectId:agg.projectId,idempotencyKey:'i',baseRevision:agg.revision,baseBlobSha:BASE_SHA,createdBy:'u',operations:[{type:'CREATE_BOX_INSTANCE',boxDefinitionId:'x',boxDefinitionVersion:1,architectureNodeId:'node:root',config:{}}]}),e=>e.code==='INVALID_ID');
  assert.throws(()=>BoxChangeSet.createChangeSet({id:'cs',projectId:agg.projectId,idempotencyKey:'i',baseRevision:agg.revision,baseBlobSha:BASE_SHA,createdBy:'u',operations:[{type:'PUBLISH_BOX',boxDefinitionId:'x',boxDefinitionVersion:1}]}),e=>e.code==='INVALID_TIMESTAMP');
});

test('BoxChangeSet candidate is deterministic across validation/apply time and records audit/outbox',()=>{
  const agg=BoxChangeSet.createAggregate(bstate()); const cs=BoxChangeSet.createChangeSet({id:'cs:b01',projectId:agg.projectId,idempotencyKey:'idem:b01',baseRevision:agg.revision,baseBlobSha:BASE_SHA,createdBy:'actor:user',operations:[
    {type:'SEED_SYSTEM_DEFINITIONS'},
    {type:'CREATE_BOX_INSTANCE',id:'instance:seed',boxDefinitionId:'system:box:leaf',boxDefinitionVersion:1,architectureNodeId:'node:root',config:{name:'Seed'}},
    {type:'ADD_BINDING_V2',id:'binding:seed',pathEntryId:'path:file',targetType:'BOX_INSTANCE',boxInstanceId:'instance:seed',relation:'IMPLEMENTS'}
  ]});
  const v=BoxChangeSet.validateChangeSet(agg,BASE_SHA,cs,{now:'2026-09-11T00:00:00Z'}); const p=BoxChangeSet.prepareApply(agg,BASE_SHA,cs,v.validationRecord,{now:'2026-09-11T00:10:00Z'});
  assert.equal(p.status,'READY'); assert.equal(p.aggregate.registry.boxInstances[0].boxDefinitionVersion,1); assert.equal(p.aggregate.appliedChangeSets.length,1); assert.equal(p.aggregate.auditEvents.length,1); assert.equal(p.aggregate.outbox.length,1);
});

function fakeGitHub(initial,{conflict=false}={}){let content=BoxChangeSet.stableStringify(initial),sha=BASE_SHA,puts=0;async function fetch(url,init={}){if((init.method||'GET')==='GET')return new Response(JSON.stringify({sha,content:Buffer.from(content).toString('base64')}),{status:200});if(init.method==='PUT'){puts++;if(conflict)return new Response(JSON.stringify({message:'sha mismatch'}),{status:409});const body=JSON.parse(init.body);if(body.sha!==sha)return new Response(JSON.stringify({message:'sha mismatch'}),{status:409});content=Buffer.from(body.content,'base64').toString('utf8');sha=NEXT_SHA;return new Response(JSON.stringify({content:{sha},commit:{sha:'c'.repeat(40)}}),{status:200});}return new Response('{}',{status:405});}return{fetch,get puts(){return puts;},snapshot:()=>({content,sha})};}

test('BoxChangeSet Contents API Apply CAS writes one aggregate and idempotent replay does not duplicate history',async()=>{
  const agg=BoxChangeSet.createAggregate(bstate()),remote=fakeGitHub(agg); const cs=BoxChangeSet.createChangeSet({id:'cs:apply',projectId:agg.projectId,idempotencyKey:'idem:apply',baseRevision:agg.revision,baseBlobSha:BASE_SHA,createdBy:'actor:user',operations:[{type:'SEED_SYSTEM_DEFINITIONS'}]}); const v=BoxChangeSet.validateChangeSet(agg,BASE_SHA,cs,{now:'2026-09-11T00:00:00Z'});
  const result=await BoxChangeSet.applyWithContentApi({fetch:remote.fetch,owner:'acme',repo:'app',branch:'main',path:'data/box.json',changeSet:cs,validationRecord:v.validationRecord,actor:'actor:user',now:'2026-09-11T00:01:00Z'}); assert.equal(result.status,'APPLIED'); assert.equal(remote.puts,1);
  const replay=await BoxChangeSet.applyWithContentApi({fetch:remote.fetch,owner:'acme',repo:'app',branch:'main',path:'data/box.json',changeSet:cs,validationRecord:v.validationRecord,actor:'actor:user',now:'2026-09-11T00:02:00Z'}); assert.equal(replay.status,'IDEMPOTENT_REPLAY'); assert.equal(remote.puts,1);
});

test('BoxChangeSet CAS conflict normalizes to STALE_CHANGESET with no partial write',async()=>{
  const agg=BoxChangeSet.createAggregate(bstate()),remote=fakeGitHub(agg,{conflict:true}),before=remote.snapshot().content; const cs=BoxChangeSet.createChangeSet({id:'cs:stale',projectId:agg.projectId,idempotencyKey:'idem:stale',baseRevision:agg.revision,baseBlobSha:BASE_SHA,createdBy:'actor:user',operations:[{type:'SEED_SYSTEM_DEFINITIONS'}]}); const v=BoxChangeSet.validateChangeSet(agg,BASE_SHA,cs,{now:'2026-09-11T00:00:00Z'});
  await assert.rejects(()=>BoxChangeSet.applyWithContentApi({fetch:remote.fetch,owner:'acme',repo:'app',branch:'main',path:'data/box.json',changeSet:cs,validationRecord:v.validationRecord,now:'2026-09-11T00:01:00Z'}),e=>e.code==='STALE_CHANGESET'); assert.equal(remote.snapshot().content,before);
});