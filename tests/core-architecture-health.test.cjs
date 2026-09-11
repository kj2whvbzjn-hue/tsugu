const test=require('node:test');
const assert=require('node:assert/strict');
const H=require('../static/core-changeset.js');
const G=require('../static/core-governance.js');
const C=require('../static/core-check-evidence.js');
const A=require('../static/core-assurance-event.js');
const AH=require('../static/core-architecture-health.js');
const actor={id:'editor:1',subject:'editor:1',kind:'HUMAN',role:'PROJECT_ADMIN'};
const now='2026-09-12T00:00:00Z';
function ref(type,id,version=1){return{type,id,version,hash:H.sha256(`${type}:${id}:${version}`)};}
function scope(box='box:1'){return{subject:ref('BOX_INSTANCE',box),requirementSnapshot:ref('REQUIREMENT_SNAPSHOT',`snapshot:${box}`),target:ref('COMMIT','a'.repeat(40))};}
function checkRegistry(result='PASS',s=scope(),id='check:1'){
  let r=C.createRegistry({projectId:'p'});
  let evidenceIds=[];
  if(['PASS','FAIL'].includes(result)){
    const eid=`evidence:${id}`,vid=`evv:${id}`;
    r=C.registerEvidence(r,{id:eid,subject:s.subject,requirementSnapshot:s.requirementSnapshot,target:s.target},{actor,now});
    const bytes=Buffer.from(`c02-${id}\n`),expectedSha256=H.sha256(bytes.toString());
    r=C.reserveEvidenceVersion(r,{id:vid,evidenceId:eid,version:1,objectPath:`evidence/p/${id}/v1.bin`,expectedSha256,expectedSize:bytes.length},{actor,now});
    const receipt={repositoryFullName:'kj2whvbzjn-hue/tsugu',branch:'e2e',path:`evidence/p/${id}/v1.bin`,contentSha256:expectedSha256,size:bytes.length,gitBlobSha:'1'.repeat(40),commitSha:'2'.repeat(40),storedAt:now,readbackCommitSha:'2'.repeat(40),verifiedAt:now};
    r=C.recordEvidenceVerified(r,vid,{storageReceipt:receipt},{actor,now});r=C.finalizeEvidenceVersion(r,vid,{}, {actor,now});evidenceIds=[vid];
  }
  r=C.createCheck(r,{id,subject:s.subject,requirementSnapshot:s.requirementSnapshot,target:s.target,command:'node --test',runner:{kind:'GITHUB_ACTIONS',name:'c02',version:'1',os:'linux',runId:'1'},evidenceVersionIds:evidenceIds,result,resolvesCheckIds:[],startedAt:now,completedAt:now},{actor,now});
  return r;
}
function assurance(result='PASS',box='box:1'){
  let a=A.createRegistry({projectId:'p'}),s=scope(box);a=A.defineEvent(a,{id:`event:${box}`,version:1,name:`event ${box}`,scope:s});
  a=A.recordAssuranceFromCheck(a,{id:`assurance:${box}:g1:${result}`,generation:1,scope:s,checkId:`check:${box}:${result}`,at:now},{checkEvidenceRegistry:checkRegistry(result,s,`check:${box}:${result}`),now});
  return a;
}
function impact(box='box:2'){const core={type:'ImpactGraph',schemaVersion:1,projectId:'p',architectureRevision:1,actualChangeId:'actual:1',relationImpacts:{},impacts:[{sourceKind:'ACTUAL_CHANGE',sourceId:'f1',boxInstanceIds:[box],requirementIds:['req:2']}],edges:[],fullTestScopes:[],requiresFullTest:false,impactedRequirementIds:['req:2'],status:'TARGETED'};return{...core,impactHash:H.sha256(core)};}
function eventTask(a,box='box:1'){const ed=a.eventDefinitions.find(x=>x.id===`event:${box}`);return{id:`task:${box}`,projectId:'p',subject:scope(box).subject,startConditions:[{type:'EVENT',ref:{type:'EVENT_DEFINITION',id:ed.id,version:ed.version,hash:ed.contentHash}}],completionConditions:[]};}

test('current exact-generation VALID produces VALID health with counts, reasons, provenance',()=>{const a=assurance('PASS');const h=AH.buildArchitectureHealth({projectId:'p',assuranceEventRegistry:a,impactGraph:impact()},{now});assert.equal(h.summary.overall,'VALID');assert.equal(h.summary.counts.VALID,1);assert.ok(h.summary.reasons.some(x=>x.code==='CURRENT_ASSURANCE_VALID'));assert.ok(h.items[0].provenance.assuranceIds.length);});

test('Health priority is FAILED > CONFLICT > STALE > UNVERIFIED > WAIVED > VALID',()=>{let a=assurance('PASS');a=A.recordAssuranceFromCheck(a,{id:'assurance:unknown',generation:1,scope:scope(),checkId:'check:unknown',at:now},{checkEvidenceRegistry:checkRegistry('UNKNOWN',scope(),'check:unknown'),now});let h=AH.buildArchitectureHealth({projectId:'p',assuranceEventRegistry:a,impactGraph:impact()},{now});assert.equal(h.summary.overall,'CONFLICT');a=A.recordAssuranceFromCheck(a,{id:'assurance:fail',generation:1,scope:scope(),checkId:'check:fail',at:now},{checkEvidenceRegistry:checkRegistry('FAIL',scope(),'check:fail'),now});h=AH.buildArchitectureHealth({projectId:'p',assuranceEventRegistry:a,impactGraph:impact()},{now});assert.equal(h.summary.overall,'FAILED');assert.ok(h.summary.reasons.some(x=>x.code==='CONTRADICTORY_CURRENT_ASSURANCE'));});

test('recalculation carries forward unaffected prior VALID and unrelated Task remains locally ready',()=>{let a=assurance('PASS','box:1');const task=eventTask(a,'box:1');a=A.beginEvaluationGeneration(a,{reason:'box:2 changed',at:now},{now});const h=AH.buildArchitectureHealth({projectId:'p',assuranceEventRegistry:a,impactGraph:impact('box:2')},{now});assert.equal(h.items.find(x=>x.eventDefinitionId==='event:box:1').status,'VALID');const gate=AH.evaluateTaskHealth(h,task,{projectId:'p',generation:2});assert.equal(gate.ready,true);assert.ok(gate.reasons.some(x=>x.code==='UNAFFECTED_CARRY_FORWARD'));});

test('related Task becomes STALE during recalculation and Full test fallback remains conservative',()=>{let a=assurance('PASS','box:1');const task=eventTask(a,'box:1');a=A.beginEvaluationGeneration(a,{reason:'box:1 changed',at:now},{now});let h=AH.buildArchitectureHealth({projectId:'p',assuranceEventRegistry:a,impactGraph:impact('box:1')},{now});assert.equal(AH.evaluateTaskHealth(h,task,{projectId:'p',generation:2}).ready,false);assert.equal(h.summary.overall,'STALE');const ig=impact('box:2');ig.impacts=[];ig.fullTestScopes=[{repositoryId:1,architectureNodeIds:[],boxInstanceIds:['box:1'],reasonCodes:['UNMAPPED_PATH'],sources:['f1']}];ig.requiresFullTest=true;ig.impactHash=H.sha256({...ig,impactHash:undefined});h=AH.buildArchitectureHealth({projectId:'p',assuranceEventRegistry:a,impactGraph:ig},{now});assert.equal(h.summary.overall,'STALE');assert.ok(h.summary.reasons.some(x=>x.code==='FULL_TEST_REQUIRED'));});

test('missing Impact Graph while RECALCULATING fails closed instead of assuming no impact',()=>{let a=assurance('PASS');a=A.beginEvaluationGeneration(a,{reason:'changed',at:now},{now});const h=AH.buildArchitectureHealth({projectId:'p',assuranceEventRegistry:a},{now});assert.equal(h.summary.overall,'STALE');assert.ok(h.summary.reasons.some(x=>x.code==='IMPACT_GRAPH_REQUIRED'));});

test('active exact human waiver appears as WAIVED without erasing provenance',()=>{let a=assurance('PASS'),g=G.createRegistry({projectId:'p'});const request={id:'waiver:1',projectId:'p',targetRule:ref('RULE_DEFINITION','rule:new',2),supersededRule:ref('RULE_DEFINITION','rule:new',1),scope:scope().subject,policyVersion:'policy:waiver:v1',expiresAt:'2026-09-13T00:00:00.000Z',reason:'temporary'};const requestHash=G.sha256(request);g=G.createApproval(g,{id:'approval:waiver',approvalType:'WAIVER',target:{type:'WAIVER',id:'waiver:1',version:1,hash:requestHash},policyVersion:'policy:waiver:v1',humanRequired:true,expiresAt:'2026-09-13T00:00:00Z'},{actor,now});g=G.createWaiver(g,{...request,approvalId:'approval:waiver'},{actor,now});const h=AH.buildArchitectureHealth({projectId:'p',assuranceEventRegistry:a,governanceRegistry:g,impactGraph:impact()},{now});assert.equal(h.summary.overall,'WAIVED');assert.equal(h.summary.counts.WAIVED,1);assert.ok(h.items[0].provenance.waiverIds.includes('waiver:1'));});

test('cache uses exact evaluation generation/input fingerprint and never adopts an old calculation',()=>{let a=assurance('PASS');const h1=AH.buildArchitectureHealth({projectId:'p',assuranceEventRegistry:a,impactGraph:impact()},{now});let cache=AH.writeHealthCache(AH.createHealthCache(),h1);assert.equal(AH.readHealthCache(cache,h1.context).healthHash,h1.healthHash);a=A.beginEvaluationGeneration(a,{reason:'changed',at:now},{now});const h2=AH.buildArchitectureHealth({projectId:'p',assuranceEventRegistry:a,impactGraph:impact()},{now});assert.equal(AH.readHealthCache(cache,h2.context),null);assert.throws(()=>AH.evaluateTaskHealth(h1,eventTask(assurance('PASS')),{projectId:'p',generation:2}),e=>e.code==='STALE_HEALTH_GENERATION');cache=AH.invalidateHealthCache(cache,{projectId:'p',generation:2});assert.equal(Object.keys(cache.entries).length,0);});

test('deleting cache and rebuilding from authoritative inputs yields the same healthHash',()=>{const a=assurance('PASS'),input={projectId:'p',assuranceEventRegistry:a,impactGraph:impact()};const first=AH.rebuildArchitectureHealth(AH.createHealthCache(),input,{now});assert.equal(first.source,'REBUILT');const second=AH.rebuildArchitectureHealth(first.cache,input,{now});assert.equal(second.source,'CACHE');const rebuilt=AH.rebuildArchitectureHealth(AH.createHealthCache(),input,{now});assert.equal(rebuilt.snapshot.healthHash,first.snapshot.healthHash);assert.deepEqual(rebuilt.snapshot.summary,first.snapshot.summary);});

test('UNKNOWN sync and cross-Project inputs fail safe',()=>{let a=assurance('PASS');a=A.setSyncState(a,'UNKNOWN');const h=AH.buildArchitectureHealth({projectId:'p',assuranceEventRegistry:a,impactGraph:impact()},{now});assert.equal(h.summary.overall,'STALE');assert.ok(h.summary.reasons.some(x=>x.code==='SYNC_UNKNOWN'));assert.throws(()=>AH.buildArchitectureHealth({projectId:'other',assuranceEventRegistry:a,impactGraph:impact()},{now}),e=>e.code==='PROJECT_SCOPE_VIOLATION');});
