const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const G=require('../static/core-check-evidence.js');
const S=require('../static/core-evidence-storage.js');
const CS=require('../static/core-check-evidence-changeset.js');
const admin={id:'github:1',subject:'github:user:1',kind:'HUMAN',role:'PROJECT_ADMIN'};
const editor={id:'github:2',subject:'github:user:2',kind:'HUMAN',role:'EDITOR'};
const H=s=>'sha256:'+crypto.createHash('sha256').update(s).digest('hex');
const ref=(type,id,version=1,hash=H(`${type}:${id}:${version}`))=>({type,id,version,hash});
const req=()=>ref('REQUIREMENT_SNAPSHOT','req:1');
const subject=()=>ref('BOX_INSTANCE','box:1');
const target=(id='commit:abc')=>ref('COMMIT',id);
function seed(){return G.createRegistry({projectId:'project:b04'});}
function receipt(path,hash,size,{commit='a'.repeat(40),blob='b'.repeat(40),verified=true}={}){return{repositoryFullName:'o/r',branch:'main',path,contentSha256:hash,size,gitBlobSha:blob,commitSha:commit,storedAt:'2026-09-11T00:01:00Z',readbackCommitSha:verified?commit:null,verifiedAt:verified?'2026-09-11T00:02:00Z':null};}
function reserved({bytes='evidence',version=1,evidenceId='evidence:1',targetRef=target()}={}){let s=G.registerEvidence(seed(),{id:evidenceId,subject:subject(),requirementSnapshot:req(),target:targetRef},{actor:editor,now:'2026-09-11T00:00:00Z'});const hash=H(bytes),size=Buffer.byteLength(bytes),path=S.makeImmutableObjectPath({projectId:'project:b04',evidenceId,version,expectedSha256:hash});s=G.reserveEvidenceVersion(s,{evidenceId,version,objectPath:path,expectedSha256:hash,expectedSize:size},{actor:editor,now:'2026-09-11T00:00:30Z'});return{s,hash,size,path,versionId:`evidence-version:${evidenceId}:${version}`};}
function finalize(f){let s=G.recordEvidenceVerified(f.s,f.versionId,{storageReceipt:receipt(f.path,f.hash,f.size)},{actor:editor,now:'2026-09-11T00:02:00Z'});return G.finalizeEvidenceVersion(s,f.versionId,{}, {actor:editor,now:'2026-09-11T00:03:00Z'});}

test('PASS Check can reference only FINALIZED EvidenceVersion with exact RequirementSnapshot/target/subject',()=>{
  const f=reserved();
  assert.throws(()=>G.createCheck(f.s,{id:'check:early',subject:subject(),requirementSnapshot:req(),target:target(),command:'npm test',runner:{kind:'GITHUB_ACTIONS'},evidenceVersionIds:[f.versionId],result:'PASS',startedAt:'2026-09-11T00:00:00Z',completedAt:'2026-09-11T00:01:00Z'},{actor:editor}),e=>e.code==='UNFINALIZED_EVIDENCE_NOT_ALLOWED');
  const s=finalize(f);
  const next=G.createCheck(s,{id:'check:pass',subject:subject(),requirementSnapshot:req(),target:target(),command:'npm test',runner:{kind:'GITHUB_ACTIONS',runId:'1'},evidenceVersionIds:[f.versionId],result:'PASS',startedAt:'2026-09-11T00:03:00Z',completedAt:'2026-09-11T00:04:00Z'},{actor:editor});
  assert.equal(next.checks[0].result,'PASS');assert.equal(next.evidenceVersions[0].status,'FINALIZED');assert.equal(next.evidence[0].currentVersion,1);
  assert.throws(()=>G.createCheck(s,{id:'check:wrong-target',subject:subject(),requirementSnapshot:req(),target:target('commit:other'),command:'npm test',runner:{kind:'LOCAL'},evidenceVersionIds:[f.versionId],result:'PASS',startedAt:'2026-09-11T00:03:00Z',completedAt:'2026-09-11T00:04:00Z'},{actor:editor}),e=>e.code==='CHECK_EVIDENCE_SCOPE_MISMATCH');
});

test('Evidence lifecycle distinguishes RESERVED/STORED/VERIFIED/FINALIZED/FAILED',()=>{
  const f=reserved(); let s=f.s; assert.equal(G.evidenceVersionStatus(s,f.versionId),'RESERVED');
  s=G.recordEvidenceStored(s,f.versionId,{storageReceipt:receipt(f.path,f.hash,f.size,{verified:false})},{actor:editor,now:'2026-09-11T00:01:00Z'}); assert.equal(G.evidenceVersionStatus(s,f.versionId),'STORED');
  s=G.recordEvidenceVerified(s,f.versionId,{storageReceipt:receipt(f.path,f.hash,f.size)},{actor:editor,now:'2026-09-11T00:02:00Z'}); assert.equal(G.evidenceVersionStatus(s,f.versionId),'VERIFIED');
  s=G.finalizeEvidenceVersion(s,f.versionId,{}, {actor:editor,now:'2026-09-11T00:03:00Z'}); assert.equal(G.evidenceVersionStatus(s,f.versionId),'FINALIZED');
  const g=reserved({evidenceId:'evidence:fail'});const failed=G.failEvidenceVersion(g.s,g.versionId,{failureCode:'OBJECT_MISSING',reason:'404'},{actor:editor,now:'2026-09-11T00:04:00Z'});assert.equal(G.evidenceVersionStatus(failed,g.versionId),'FAILED');
});

test('late finalization of an older EvidenceVersion never rolls currentVersion backward',()=>{
  let s=G.registerEvidence(seed(),{id:'evidence:v',subject:subject(),requirementSnapshot:req(),target:target()},{actor:editor,now:'2026-09-11T00:00:00Z'});
  const make=(v,text)=>{const hash=H(text),size=Buffer.byteLength(text),path=S.makeImmutableObjectPath({projectId:'project:b04',evidenceId:'evidence:v',version:v,expectedSha256:hash});s=G.reserveEvidenceVersion(s,{evidenceId:'evidence:v',version:v,objectPath:path,expectedSha256:hash,expectedSize:size},{actor:editor,now:`2026-09-11T00:0${v}:00Z`});return{hash,size,path,id:`evidence-version:evidence:v:${v}`};};
  const v1=make(1,'one'),v2=make(2,'two');
  s=G.recordEvidenceVerified(s,v2.id,{storageReceipt:receipt(v2.path,v2.hash,v2.size,{commit:'2'.repeat(40),blob:'3'.repeat(40)})},{actor:editor,now:'2026-09-11T00:03:00Z'});s=G.finalizeEvidenceVersion(s,v2.id,{}, {actor:editor,now:'2026-09-11T00:04:00Z'});assert.equal(s.evidence[0].currentVersion,2);
  s=G.recordEvidenceVerified(s,v1.id,{storageReceipt:receipt(v1.path,v1.hash,v1.size,{commit:'4'.repeat(40),blob:'5'.repeat(40)})},{actor:editor,now:'2026-09-11T00:05:00Z'});s=G.finalizeEvidenceVersion(s,v1.id,{}, {actor:editor,now:'2026-09-11T00:06:00Z'});assert.equal(s.evidence[0].currentVersion,2);
});

test('FAIL remains immutable and a later scoped PASS resolves it without deleting history',()=>{
  const f1=reserved({bytes:'fail evidence'});let s=finalize(f1);s=G.createCheck(s,{id:'check:fail',subject:subject(),requirementSnapshot:req(),target:target(),command:'test',runner:{kind:'LOCAL'},evidenceVersionIds:[f1.versionId],result:'FAIL',startedAt:'2026-09-11T00:03:00Z',completedAt:'2026-09-11T00:04:00Z'},{actor:editor});assert.equal(G.unresolvedRequiredFails(s,{subject:subject(),requirementSnapshot:req()}).length,1);
  const bytes='pass evidence',hash=H(bytes),size=Buffer.byteLength(bytes),path=S.makeImmutableObjectPath({projectId:'project:b04',evidenceId:'evidence:1',version:2,expectedSha256:hash});s=G.reserveEvidenceVersion(s,{evidenceId:'evidence:1',version:2,objectPath:path,expectedSha256:hash,expectedSize:size},{actor:editor,now:'2026-09-11T00:05:00Z'});const vid='evidence-version:evidence:1:2';s=G.recordEvidenceVerified(s,vid,{storageReceipt:receipt(path,hash,size,{commit:'6'.repeat(40),blob:'7'.repeat(40)})},{actor:editor,now:'2026-09-11T00:06:00Z'});s=G.finalizeEvidenceVersion(s,vid,{}, {actor:editor,now:'2026-09-11T00:07:00Z'});s=G.createCheck(s,{id:'check:pass',subject:subject(),requirementSnapshot:req(),target:target(),command:'test',runner:{kind:'LOCAL'},evidenceVersionIds:[vid],result:'PASS',resolvesCheckIds:['check:fail'],startedAt:'2026-09-11T00:07:00Z',completedAt:'2026-09-11T00:08:00Z'},{actor:editor});assert.equal(s.checks.length,2);assert.equal(s.checks.find(x=>x.id==='check:fail').result,'FAIL');assert.equal(G.unresolvedRequiredFails(s,{subject:subject(),requirementSnapshot:req()}).length,0);
});

function mockGitHub(){
  const files=new Map(); let seq=1; const head={main:'1'.repeat(40)};
  function response(status,body){return{status,ok:status>=200&&status<300,async text(){return body==null?'':JSON.stringify(body);}};}
  const fetch=async(url,opt={})=>{const u=new URL(url),method=opt.method||'GET';if(u.pathname.includes('/git/ref/heads/')){const branch=decodeURIComponent(u.pathname.split('/git/ref/heads/')[1]);return response(200,{object:{sha:head[branch]||head.main}});}const marker='/contents/',i=u.pathname.indexOf(marker);if(i<0)return response(404,{message:'no'});const path=decodeURIComponent(u.pathname.slice(i+marker.length)),ref=u.searchParams.get('ref')||'main',key=path; if(method==='GET'){const f=files.get(key);if(!f)return response(404,{message:'Not Found'});return response(200,{sha:f.blob,content:f.content,encoding:'base64'});}if(method==='PUT'){if(files.has(key))return response(422,{message:'exists'});const b=JSON.parse(opt.body),bytes=Buffer.from(b.content,'base64'),blob=crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex'),commit=((seq++).toString(16).padStart(40,'0'));files.set(key,{content:b.content,blob,commit});head[b.branch||'main']=commit;return response(201,{content:{sha:blob},commit:{sha:commit}});}return response(405,{message:'bad'});};
  return{fetch,files,head};
}

test('immutable Git storage verifies SHA-256, size and Git blob readback; exact retry is idempotent and conflicting overwrite is rejected',async()=>{
  const m=mockGitHub(),bytes=Buffer.from('binary\0evidence'),hash=await S.sha256Bytes(bytes),path=S.makeImmutableObjectPath({projectId:'project:b04',evidenceId:'evidence:storage',version:1,expectedSha256:hash});
  const first=await S.storeImmutableEvidence({fetch:m.fetch,owner:'o',repo:'r',branch:'main',path,bytes,expectedSha256:hash,expectedSize:bytes.length,now:'2026-09-11T00:00:00Z'});assert.equal(first.status,'STORED_AND_VERIFIED');assert.equal(first.contentSha256,hash);assert.equal(first.size,bytes.length);assert.match(first.gitBlobSha,/^[a-f0-9]{40}$/);assert.equal(first.readbackCommitSha,first.commitSha);
  const again=await S.storeImmutableEvidence({fetch:m.fetch,owner:'o',repo:'r',branch:'main',path,bytes,expectedSha256:hash,expectedSize:bytes.length,now:'2026-09-11T00:01:00Z'});assert.equal(again.status,'IDEMPOTENT_EXISTING');
  await assert.rejects(()=>S.storeImmutableEvidence({fetch:m.fetch,owner:'o',repo:'r',branch:'main',path,bytes:Buffer.from('other'),now:'2026-09-11T00:02:00Z'}),e=>e.code==='IMMUTABLE_EVIDENCE_PATH_OCCUPIED');
});

test('reconciliation recovers upload-success/metadata-failure and reports missing/hash mismatch without inventing PASS',async()=>{
  const m=mockGitHub(),bytes=Buffer.from('recover'),hash=await S.sha256Bytes(bytes),path=S.makeImmutableObjectPath({projectId:'project:b04',evidenceId:'evidence:recover',version:1,expectedSha256:hash});const stored=await S.storeImmutableEvidence({fetch:m.fetch,owner:'o',repo:'r',branch:'main',path,bytes,expectedSha256:hash,expectedSize:bytes.length,now:'2026-09-11T00:00:00Z'});
  const rec=await S.reconcileImmutableEvidence({fetch:m.fetch,owner:'o',repo:'r',branch:'main',path,expectedSha256:hash,expectedSize:bytes.length,storedAt:stored.storedAt,now:'2026-09-11T00:03:00Z'});assert.equal(rec.status,'VERIFIED');
  const miss=await S.reconcileImmutableEvidence({fetch:m.fetch,owner:'o',repo:'r',branch:'main',path:'evidence/missing.bin',expectedSha256:hash,expectedSize:bytes.length,now:'2026-09-11T00:03:00Z'});assert.equal(miss.status,'MISSING');
  const mismatch=await S.reconcileImmutableEvidence({fetch:m.fetch,owner:'o',repo:'r',branch:'main',path,expectedSha256:H('wrong'),expectedSize:bytes.length,now:'2026-09-11T00:03:00Z'});assert.equal(mismatch.status,'HASH_OR_SIZE_MISMATCH');
});

test('CheckEvidenceChangeSet binds actor separately and rejects stale/actor-spoofed writes',()=>{
  const a=CS.createAggregate(seed()),blob='a'.repeat(40),bytes='cs evidence',hash=H(bytes),path=S.makeImmutableObjectPath({projectId:'project:b04',evidenceId:'evidence:cs',version:1,expectedSha256:hash});const cs=CS.createChangeSet({id:'cs:b04',projectId:'project:b04',idempotencyKey:'idem:b04',baseRevision:a.revision,baseBlobSha:blob,operations:[{type:'REGISTER_EVIDENCE',id:'evidence:cs',subject:subject(),requirementSnapshot:req(),target:target(),at:'2026-09-11T00:00:00Z'},{type:'RESERVE_EVIDENCE_VERSION',evidenceId:'evidence:cs',version:1,objectPath:path,expectedSha256:hash,expectedSize:Buffer.byteLength(bytes),at:'2026-09-11T00:00:01Z'}]});const v=CS.validateChangeSet(a,blob,cs,{actor:editor,now:'2026-09-11T00:00:02Z'});assert.equal(v.candidate.evidenceVersions[0].status,'RESERVED');assert.throws(()=>CS.prepareApply(a,blob,cs,v.validationRecord,{actor:admin,now:'2026-09-11T00:00:03Z'}),e=>e.code==='CHECK_EVIDENCE_VALIDATION_RECORD_MISMATCH');assert.throws(()=>CS.validateChangeSet(a,'b'.repeat(40),cs,{actor:editor}),e=>e.code==='STALE_CHANGESET');
});
