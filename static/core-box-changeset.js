(function (root, factory) {
  let Box = root && root.TSUGUCoreBox;
  let HashCore = root && root.TSUGUCoreChangeSet;
  if (typeof module === 'object' && module.exports) {
    try { if (!Box) Box = require('./core-box.js'); } catch {}
    try { if (!HashCore) HashCore = require('./core-changeset.js'); } catch {}
  }
  const api = factory(root, Box, HashCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.TSUGUCoreBoxChangeSet = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Box, HashCore) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const AGGREGATE_SCHEMA_VERSION = 1;
  const OP_TYPES = new Set(['SEED_SYSTEM_DEFINITIONS','CREATE_SCHEMA_DRAFT','PUBLISH_SCHEMA','CREATE_BOX_DRAFT','ADD_CHILD_CONSTRAINT','PUBLISH_BOX','CREATE_NEXT_BOX_VERSION','DEPRECATE_BOX','RETIRE_BOX','CREATE_BOX_INSTANCE','ADD_BINDING_V2','DEACTIVATE_BINDING_V2']);

  function domainError(code,message,detail){ const e=new Error(`${code}: ${message}`);e.code=code;if(detail!==undefined)e.detail=detail;return e; }
  function requireBox(){ if(!Box) throw domainError('BOX_CORE_REQUIRED','TSUGUCoreBox が必要です'); return Box; }
  function requireHash(){ if(!HashCore||typeof HashCore.sha256!=='function'||typeof HashCore.stableStringify!=='function') throw domainError('CHANGESET_CORE_REQUIRED','TSUGUCoreChangeSet が必要です'); return HashCore; }
  function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
  function deepFreeze(v){if(!v||typeof v!=='object'||Object.isFrozen(v))return v;Object.freeze(v);for(const x of Object.values(v))deepFreeze(x);return v;}
  function assertObject(v,code,label){if(!v||typeof v!=='object'||Array.isArray(v))throw domainError(code,`${label} が必要です`);return v;}
  function assertId(v,field){const s=String(v||'').trim();if(!s||s.length>200||/[\u0000-\u001f\u007f]/.test(s))throw domainError('INVALID_ID',`${field} が不正です`);return s;}
  function assertRevision(v,field='revision'){const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw domainError('INVALID_REVISION',`${field} は1以上の整数である必要があります`);return n;}
  function assertBlobSha(v,field='baseBlobSha'){const s=String(v||'').trim().toLowerCase();if(!/^[a-f0-9]{40}$/.test(s))throw domainError('INVALID_BLOB_SHA',`${field} は40桁Git blob SHAである必要があります`);return s;}
  function nowIso(v){const d=v==null?new Date():new Date(v);if(Number.isNaN(d.getTime()))throw domainError('INVALID_TIMESTAMP','時刻が不正です');return d.toISOString();}
  function stableStringify(v){return requireHash().stableStringify(v);}
  function sha256(v){return requireHash().sha256(v);}
  function normalizeOperation(input){
    const op=clone(assertObject(input,'BOX_OPERATION_REQUIRED','operation'));const type=String(op.type||'').toUpperCase();if(!OP_TYPES.has(type))throw domainError('UNSUPPORTED_BOX_OPERATION',type||'<empty>');
    const idRequired=new Set(['CREATE_SCHEMA_DRAFT','CREATE_BOX_DRAFT','ADD_CHILD_CONSTRAINT','CREATE_BOX_INSTANCE','ADD_BINDING_V2']);
    if(idRequired.has(type)) assertId(op.id,`${type}.id`);
    if(['PUBLISH_SCHEMA','PUBLISH_BOX'].includes(type)){if(op.at==null)throw domainError('INVALID_TIMESTAMP',`${type}.at が必要です`);nowIso(op.at);}
    if(['DEPRECATE_BOX','RETIRE_BOX'].includes(type)){assertId(op.lifecycleEventId,`${type}.lifecycleEventId`);if(op.at==null)throw domainError('INVALID_TIMESTAMP',`${type}.at が必要です`);nowIso(op.at);}
    delete op.type;return deepFreeze({type,...op});
  }
  function payloadProjection(c){return{type:'BoxChangeSet',schemaVersion:SCHEMA_VERSION,id:c.id,projectId:c.projectId,idempotencyKey:c.idempotencyKey,baseRevision:c.baseRevision,baseBlobSha:c.baseBlobSha,createdBy:c.createdBy,operations:c.operations};}
  function createChangeSet(input){const raw=assertObject(input,'BOX_CHANGESET_REQUIRED','BoxChangeSet');const out={type:'BoxChangeSet',schemaVersion:SCHEMA_VERSION,id:assertId(raw.id,'BoxChangeSet.id'),projectId:assertId(raw.projectId,'BoxChangeSet.projectId'),idempotencyKey:assertId(raw.idempotencyKey,'BoxChangeSet.idempotencyKey'),baseRevision:assertRevision(raw.baseRevision,'BoxChangeSet.baseRevision'),baseBlobSha:assertBlobSha(raw.baseBlobSha),createdBy:assertId(raw.createdBy,'BoxChangeSet.createdBy'),operations:(raw.operations||[]).map(normalizeOperation)};if(!out.operations.length)throw domainError('EMPTY_BOX_CHANGESET','BoxChangeSetにはoperationが必要です');out.payloadHash=sha256(payloadProjection(out));return deepFreeze(out);}
  function validateChangeSetShape(input){const cs=createChangeSet(input);if(input.payloadHash!=null&&input.payloadHash!==cs.payloadHash)throw domainError('BOX_CHANGESET_PAYLOAD_HASH_MISMATCH','payloadHashが一致しません');return cs;}

  function createAggregate(registryInput){const registry=requireBox().validateState(registryInput);return validateAggregate({type:'BoxAggregate',schemaVersion:AGGREGATE_SCHEMA_VERSION,projectId:registry.architecture.project.id,revision:registry.architecture.project.revision,registry,appliedChangeSets:[],auditEvents:[],outbox:[]});}
  function validateAggregate(input){const raw=clone(assertObject(input,'BOX_AGGREGATE_REQUIRED','BoxAggregate'));if(raw.type!=='BoxAggregate'||Number(raw.schemaVersion)!==AGGREGATE_SCHEMA_VERSION)throw domainError('UNSUPPORTED_BOX_AGGREGATE_SCHEMA','BoxAggregate契約が不正です');const registry=requireBox().validateState(raw.registry);const projectId=assertId(raw.projectId,'BoxAggregate.projectId'),revision=assertRevision(raw.revision,'BoxAggregate.revision');if(registry.architecture.project.id!==projectId)throw domainError('PROJECT_SCOPE_VIOLATION','BoxAggregate Projectが一致しません');if(registry.architecture.project.revision!==revision)throw domainError('BOX_AGGREGATE_REVISION_MISMATCH','revisionが一致しません');return deepFreeze({type:'BoxAggregate',schemaVersion:AGGREGATE_SCHEMA_VERSION,projectId,revision,registry,appliedChangeSets:Array.isArray(raw.appliedChangeSets)?raw.appliedChangeSets:[],auditEvents:Array.isArray(raw.auditEvents)?raw.auditEvents:[],outbox:Array.isArray(raw.outbox)?raw.outbox:[]});}
  function targetIds(ops){const keys=['id','schemaDefinitionId','boxDefinitionId','childSchemaDefinitionId','architectureNodeId','boxInstanceId','pathEntryId','bindingId'];const set=new Set();for(const op of ops)for(const k of keys)if(op[k]!=null)set.add(String(op[k]));return[...set].sort();}
  function validateChangeSet(aggregateInput,currentBlobSha,changeSetInput,options={}){const aggregate=validateAggregate(aggregateInput),blobSha=assertBlobSha(currentBlobSha,'currentBlobSha'),cs=validateChangeSetShape(changeSetInput);if(aggregate.projectId!==cs.projectId)throw domainError('PROJECT_SCOPE_VIOLATION','BoxChangeSet Projectが一致しません');if(aggregate.revision!==cs.baseRevision||blobSha!==cs.baseBlobSha)throw domainError('STALE_CHANGESET','BoxChangeSet base revision/blob SHAが現在状態と一致しません');let candidate=aggregate.registry;for(const op of cs.operations)candidate=requireBox().applyOperation(candidate,op,{now:options.now,actor:options.actor||cs.createdBy});candidate=requireBox().validateState(candidate,{enforceRequiredChildren:true});const record={type:'BoxValidationRecord',schemaVersion:SCHEMA_VERSION,id:options.validationId?assertId(options.validationId,'validationId'):`box-validation:${cs.id}`,changeSetId:cs.id,projectId:cs.projectId,baseRevision:cs.baseRevision,baseBlobSha:cs.baseBlobSha,payloadHash:cs.payloadHash,candidateHash:sha256(requireBox().serialize(candidate)),targetIds:targetIds(cs.operations),resultRevision:candidate.architecture.project.revision,status:'PASS',issues:[],validatedAt:nowIso(options.now)};return deepFreeze({validationRecord:record,candidate});}
  function validateRecord(record,cs,candidate){const r=assertObject(record,'BOX_VALIDATION_RECORD_REQUIRED','BoxValidationRecord');if(r.type!=='BoxValidationRecord'||r.status!=='PASS')throw domainError('VALIDATION_NOT_PASS','PASSのBoxValidationRecordが必要です');if(r.changeSetId!==cs.id||r.projectId!==cs.projectId||r.baseRevision!==cs.baseRevision||r.baseBlobSha!==cs.baseBlobSha||r.payloadHash!==cs.payloadHash)throw domainError('BOX_VALIDATION_RECORD_MISMATCH','ValidationRecord対象が一致しません');if(r.candidateHash!==sha256(requireBox().serialize(candidate))||r.resultRevision!==candidate.architecture.project.revision)throw domainError('BOX_VALIDATION_RECORD_MISMATCH','candidateが一致しません');return r;}
  function prepareApply(aggregateInput,currentBlobSha,changeSetInput,validationRecord,options={}){const aggregate=validateAggregate(aggregateInput),blobSha=assertBlobSha(currentBlobSha,'currentBlobSha'),cs=validateChangeSetShape(changeSetInput);const existing=aggregate.appliedChangeSets.find(x=>x.idempotencyKey===cs.idempotencyKey);if(existing){if(existing.payloadHash!==cs.payloadHash)throw domainError('IDEMPOTENCY_KEY_REUSED','同一idempotency keyが異なるpayloadで使用済みです');return deepFreeze({status:'IDEMPOTENT_REPLAY',expectedBlobSha:blobSha,aggregate,result:{changeSetId:existing.changeSetId,revision:existing.resultRevision,candidateHash:existing.candidateHash,idempotencyKey:existing.idempotencyKey}});}const rerun=validateChangeSet(aggregate,blobSha,cs,{now:options.now,actor:options.actor||cs.createdBy,validationId:validationRecord&&validationRecord.id});validateRecord(validationRecord,cs,rerun.candidate);const at=nowIso(options.now),actor=assertId(options.actor||cs.createdBy,'actor');const applied={type:'AppliedBoxChangeSet',changeSetId:cs.id,idempotencyKey:cs.idempotencyKey,payloadHash:cs.payloadHash,candidateHash:rerun.validationRecord.candidateHash,baseRevision:cs.baseRevision,resultRevision:rerun.candidate.architecture.project.revision,actor,appliedAt:at};const audit={type:'AuditEvent',action:'APPLY_BOX_CHANGESET',changeSetId:cs.id,actor,baseRevision:cs.baseRevision,resultRevision:applied.resultRevision,payloadHash:cs.payloadHash,candidateHash:applied.candidateHash,at};const outbox={type:'OutboxRecord',id:`outbox:${cs.id}`,eventType:'BOX_REGISTRY_CHANGED',changeSetId:cs.id,projectId:cs.projectId,resultRevision:applied.resultRevision,candidateHash:applied.candidateHash,status:'PENDING',createdAt:at};const next=validateAggregate({type:'BoxAggregate',schemaVersion:AGGREGATE_SCHEMA_VERSION,projectId:aggregate.projectId,revision:applied.resultRevision,registry:rerun.candidate,appliedChangeSets:[...aggregate.appliedChangeSets,applied],auditEvents:[...aggregate.auditEvents,audit],outbox:[...aggregate.outbox,outbox]});return deepFreeze({status:'READY',expectedBlobSha:blobSha,aggregate:next,serialized:stableStringify(next),result:{changeSetId:cs.id,revision:next.revision,candidateHash:applied.candidateHash,idempotencyKey:cs.idempotencyKey}});}

  function b64enc(text){if(typeof Buffer!=='undefined')return Buffer.from(text,'utf8').toString('base64');return btoa(unescape(encodeURIComponent(text)));}
  function b64dec(text){if(typeof Buffer!=='undefined')return Buffer.from(String(text).replace(/\n/g,''),'base64').toString('utf8');return decodeURIComponent(escape(atob(String(text).replace(/\n/g,''))));}
  async function githubJson(fetchImpl,url,options={}){const response=await fetchImpl(url,options),text=await response.text();let body=null;try{body=text?JSON.parse(text):null;}catch{body={message:text};}return{response,body};}
  async function applyWithContentApi(options){
    const fetchImpl=options&&options.fetch||(root&&root.fetch);if(typeof fetchImpl!=='function')throw domainError('FETCH_REQUIRED','fetch実装が必要です');
    const owner=assertId(options.owner,'owner'),repo=assertId(options.repo,'repo'),branch=assertId(options.branch,'branch');
    const path=String(options.path||'').replace(/^\/+/, '');if(!path)throw domainError('INVALID_PATH','保存pathが必要です');
    const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(options.headers||{})};if(options.token)headers.Authorization=`Bearer ${options.token}`;
    const api=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
    const readUrl=`${api}?ref=${encodeURIComponent(branch)}`;
    const read=await githubJson(fetchImpl,readUrl,{headers});if(!read.response.ok)throw domainError('GITHUB_READ_FAILED',`GitHub read ${read.response.status}`,read.body);
    const blobSha=assertBlobSha(read.body.sha,'GitHub content sha');let aggregate;try{aggregate=JSON.parse(b64dec(read.body.content));}catch{throw domainError('INVALID_BOX_AGGREGATE_JSON','Box aggregate JSONを解析できません');}
    const prepared=prepareApply(aggregate,blobSha,options.changeSet,options.validationRecord,{now:options.now,actor:options.actor});
    if(prepared.status==='IDEMPOTENT_REPLAY')return deepFreeze({...prepared.result,status:'IDEMPOTENT_REPLAY',blobSha,commitSha:null});
    const write=await githubJson(fetchImpl,api,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({message:options.message||`Apply ${prepared.result.changeSetId}`,content:b64enc(prepared.serialized),sha:prepared.expectedBlobSha,branch})});
    if(!write.response.ok){if(write.response.status===409||write.response.status===422)throw domainError('STALE_CHANGESET','GitHub CASに失敗しました。部分変更は確定されていません',write.body);throw domainError('GITHUB_WRITE_FAILED',`GitHub write ${write.response.status}`,write.body);}
    const commitSha=write.body&&write.body.commit&&write.body.commit.sha||null;
    const writtenBlobSha=write.body&&write.body.content&&write.body.content.sha||null;
    const readbackRef=commitSha||branch;
    const readbackUrl=`${api}?ref=${encodeURIComponent(readbackRef)}`;
    const readback=await githubJson(fetchImpl,readbackUrl,{headers});if(!readback.response.ok)throw domainError('GITHUB_READBACK_FAILED',`GitHub readback ${readback.response.status}`,readback.body);
    if(writtenBlobSha&&readback.body&&readback.body.sha!==writtenBlobSha)throw domainError('APPLY_READBACK_MISMATCH','Box Apply readback blob SHAが書込み結果と一致しません');
    const stored=validateAggregate(JSON.parse(b64dec(readback.body.content)));const cs=validateChangeSetShape(options.changeSet),applied=stored.appliedChangeSets.find(x=>x.changeSetId===cs.id&&x.payloadHash===cs.payloadHash);
    if(!applied||stored.revision!==prepared.result.revision)throw domainError('APPLY_READBACK_MISMATCH','Box Apply readbackが一致しません');
    return deepFreeze({...prepared.result,status:'APPLIED',blobSha:readback.body.sha,commitSha});
  }

  return deepFreeze({SCHEMA_VERSION,AGGREGATE_SCHEMA_VERSION,OP_TYPES:Object.freeze([...OP_TYPES]),stableStringify,sha256,createChangeSet,validateChangeSetShape,createAggregate,validateAggregate,validateChangeSet,prepareApply,applyWithContentApi});
});