(function(root,factory){
  let Sync=root&&root.TSUGUCoreSync;
  if(typeof module==='object'&&module.exports){try{if(!Sync)Sync=require('./core-sync.js');}catch{}}
  const api=factory(root,Sync);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document)root.TSUGUCoreSyncRecovery=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root,Sync){
  'use strict';
  const SCHEMA_VERSION=1;
  const BRANCH_CONSISTENCY=new Set(['CURRENT','UNKNOWN']);
  function error(code,message,detail){const e=new Error(`${code}: ${message}`);e.code=code;if(detail!==undefined)e.detail=detail;return e;}
  function requireSync(){if(!Sync||typeof Sync.validateSyncAggregate!=='function'||typeof Sync.receiveCommit!=='function')throw error('CORE_SYNC_REQUIRED','TSUGUCoreSync が必要です');return Sync;}
  function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
  function freeze(v){if(!v||typeof v!=='object'||Object.isFrozen(v))return v;Object.freeze(v);for(const x of Object.values(v))freeze(x);return v;}
  function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())o[k]=canonical(v[k]);return o;}return v;}
  function stable(v){return JSON.stringify(canonical(v));}
  function hash(v){if(typeof require==='function'){try{return 'sha256:'+require('node:crypto').createHash('sha256').update(typeof v==='string'?v:stable(v)).digest('hex');}catch{}}throw error('SHA256_REQUIRED','Node crypto が必要です');}
  function id(v,f){const s=String(v||'').trim();if(!s||s.length>250||/[\u0000-\u001f\u007f]/.test(s))throw error('INVALID_ID',`${f} が不正です`);return s;}
  function pos(v,f){const n=Number(v);if(!Number.isSafeInteger(n)||n<=0)throw error('INVALID_INTEGER',`${f} は正の整数である必要があります`);return n;}
  function sha(v,f='sha'){const s=String(v||'').trim().toLowerCase();if(!/^[a-f0-9]{40}$/.test(s))throw error('INVALID_GIT_SHA',`${f} は40桁full SHAである必要があります`);return s;}
  function iso(v,f='time'){const d=new Date(v==null?Date.now():v);if(Number.isNaN(d.valueOf()))throw error('INVALID_TIMESTAMP',`${f} が不正です`);return d.toISOString();}
  function repoName(v){const s=id(v,'repositoryFullName');if(!/^[^/\s]+\/[^/\s]+$/.test(s))throw error('INVALID_REPOSITORY','repositoryFullName は owner/name 形式である必要があります');return s;}
  function branchKey(repositoryId,branch){return `${Number(repositoryId)}:${branch}`;}
  function validateState(input){
    if(!input||typeof input!=='object'||Array.isArray(input)||input.type!=='GitHubSyncRecoveryState'||Number(input.schemaVersion)!==SCHEMA_VERSION)throw error('INVALID_RECOVERY_STATE','GitHubSyncRecoveryState が不正です');
    const projectId=id(input.projectId,'projectId'),revision=pos(input.revision,'revision');
    const deliveries=(input.deliveries||[]).map(x=>({type:'GitHubDeliveryRecord',id:id(x.id,'delivery.id'),projectId,repositoryId:pos(x.repositoryId,'delivery.repositoryId'),eventName:id(x.eventName,'delivery.eventName'),observedCommitSha:x.observedCommitSha==null?null:sha(x.observedCommitSha,'delivery.observedCommitSha'),payloadHash:id(x.payloadHash,'delivery.payloadHash'),receivedAt:iso(x.receivedAt,'delivery.receivedAt')}));
    const deliveryIds=new Set();for(const d of deliveries){if(deliveryIds.has(d.id))throw error('DUPLICATE_DELIVERY',d.id);deliveryIds.add(d.id);}
    const branches=(input.branches||[]).map(x=>{const consistency=String(x.consistency||'').toUpperCase();if(!BRANCH_CONSISTENCY.has(consistency))throw error('INVALID_BRANCH_CONSISTENCY',consistency);return{type:'MutableBranchObservation',projectId,repositoryId:pos(x.repositoryId,'branch.repositoryId'),repositoryFullName:repoName(x.repositoryFullName),branch:id(x.branch,'branch.branch'),canonicalHeadSha:sha(x.canonicalHeadSha,'branch.canonicalHeadSha'),recoveryBaseSha:x.recoveryBaseSha==null?null:sha(x.recoveryBaseSha,'branch.recoveryBaseSha'),consistency,observedAt:iso(x.observedAt,'branch.observedAt'),source:id(x.source||'GITHUB_READ','branch.source'),generation:pos(x.generation||1,'branch.generation')};});
    const branchKeys=new Set();for(const b of branches){const k=branchKey(b.repositoryId,b.branch);if(branchKeys.has(k))throw error('DUPLICATE_BRANCH_OBSERVATION',k);branchKeys.add(k);}
    const incidents=(input.incidents||[]).map(x=>({type:'SyncRecoveryIncident',id:id(x.id,'incident.id'),projectId,code:id(x.code,'incident.code'),repositoryId:x.repositoryId==null?null:pos(x.repositoryId,'incident.repositoryId'),branch:x.branch==null?null:id(x.branch,'incident.branch'),status:id(x.status||'OPEN','incident.status'),detail:clone(x.detail||null),at:iso(x.at,'incident.at')}));
    const incidentIds=new Set();for(const x of incidents){if(incidentIds.has(x.id))throw error('DUPLICATE_RECOVERY_INCIDENT',x.id);incidentIds.add(x.id);}
    return freeze({type:'GitHubSyncRecoveryState',schemaVersion:SCHEMA_VERSION,projectId,revision,deliveries,branches,incidents});
  }
  function createRecoveryState(input={}){return validateState({type:'GitHubSyncRecoveryState',schemaVersion:SCHEMA_VERSION,projectId:id(input.projectId,'projectId'),revision:1,deliveries:[],branches:[],incidents:[]});}
  function mutate(state,fn){const before=validateState(state),d=clone(before);fn(d);d.revision=before.revision+1;return validateState(d);}
  function recordDelivery(state,input,options={}){
    const s=validateState(state),deliveryId=id(input.deliveryId,'deliveryId'),payloadHash=id(input.payloadHash||hash(input.payload||{}),'payloadHash'),existing=s.deliveries.find(x=>x.id===deliveryId);
    if(existing){if(existing.payloadHash!==payloadHash)throw error('DELIVERY_ID_CONTENT_MISMATCH','同じdelivery IDに異なる内容を登録できません');return freeze({status:'DEDUPED',state:s,delivery:existing});}
    const next=mutate(s,d=>d.deliveries.push({type:'GitHubDeliveryRecord',id:deliveryId,projectId:d.projectId,repositoryId:pos(input.repositoryId,'repositoryId'),eventName:id(input.eventName||'push','eventName'),observedCommitSha:input.observedCommitSha==null?null:sha(input.observedCommitSha,'observedCommitSha'),payloadHash,receivedAt:iso(options.now||input.receivedAt)}));
    return freeze({status:'RECEIVED',state:next,delivery:next.deliveries.find(x=>x.id===deliveryId)});
  }
  function splitRepository(fullName){const s=repoName(fullName),[owner,repo]=s.split('/');return{fullName:s,owner,repo};}
  function headers(options){const h={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(options.headers||{})};if(options.token)h.Authorization=`Bearer ${options.token}`;return h;}
  async function json(fetchImpl,url,init={}){const r=await fetchImpl(url,init),t=await r.text();let body=null;try{body=t?JSON.parse(t):null;}catch{body={message:t};}return{response:r,body};}
  function upsertBranch(state,info){
    const key=branchKey(info.repositoryId,info.branch);return mutate(state,d=>{const i=d.branches.findIndex(x=>branchKey(x.repositoryId,x.branch)===key);const prev=i<0?null:d.branches[i];const row={type:'MutableBranchObservation',projectId:d.projectId,repositoryId:info.repositoryId,repositoryFullName:info.repositoryFullName,branch:info.branch,canonicalHeadSha:info.canonicalHeadSha,recoveryBaseSha:info.recoveryBaseSha==null?null:info.recoveryBaseSha,consistency:info.consistency,observedAt:info.observedAt,source:'GITHUB_READ',generation:prev?prev.generation+(prev.canonicalHeadSha===info.canonicalHeadSha?0:1):1};if(i<0)d.branches.push(row);else d.branches[i]=row;});
  }
  function addIncident(state,input){const incidentId=input.id||`sync-incident:${input.code}:${input.repositoryId||'all'}:${input.branch||'all'}:${String(input.at).replace(/[^0-9]/g,'')}`;if(state.incidents.some(x=>x.id===incidentId))return state;return mutate(state,d=>d.incidents.push({type:'SyncRecoveryIncident',id:incidentId,projectId:d.projectId,code:input.code,repositoryId:input.repositoryId||null,branch:input.branch||null,status:'OPEN',detail:clone(input.detail||null),at:input.at}));}
  function ingestShas(syncAggregate,repository,branch,shas,now){let aggregate=requireSync().validateSyncAggregate(syncAggregate),received=[],deduped=[];for(const commitSha of shas){const r=requireSync().receiveCommit(aggregate,{id:repository.id,full_name:repository.fullName},commitSha,branch,{now});aggregate=r.aggregate;(r.status==='RECEIVED'?received:deduped).push(commitSha);}return{aggregate,received,deduped};}
  async function reconcileBranch(stateInput,syncInput,options={}){
    const fetchImpl=options.fetch||(root&&root.fetch);if(typeof fetchImpl!=='function')throw error('FETCH_REQUIRED','fetch実装が必要です');
    const state=validateState(stateInput),sync=requireSync().validateSyncAggregate(syncInput);if(sync.projectId!==state.projectId)throw error('PROJECT_SCOPE_VIOLATION','Sync aggregateとRecovery stateのProjectが一致しません');
    const repositoryId=pos(options.repositoryId,'repositoryId'),repository=splitRepository(options.repositoryFullName),branch=id(options.branch||'main','branch'),at=iso(options.now),h=headers(options),base=`https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
    const current=await json(fetchImpl,`${base}/branches/${encodeURIComponent(branch)}`,{headers:h});
    if(!current.response.ok){const next=addIncident(state,{code:'GITHUB_API_UNKNOWN',repositoryId,branch,at,detail:{status:current.response.status,body:current.body}});return freeze({status:'UNKNOWN',state:next,syncAggregate:sync,currentHeadSha:null,receivedCommitShas:[],dedupedCommitShas:[],requiresRetry:true});}
    const currentHead=sha(current.body&&current.body.commit&&current.body.commit.sha,'branch.headSha'),existing=state.branches.find(x=>x.repositoryId===repositoryId&&x.branch===branch);
    let commitShas=[],consistency='CURRENT',detail=null;
    if(!existing)commitShas=[currentHead];
    else if(existing.canonicalHeadSha===currentHead&&existing.consistency==='CURRENT')commitShas=[currentHead];
    else{
      const compareBase=existing.consistency==='UNKNOWN'&&existing.recoveryBaseSha?existing.recoveryBaseSha:existing.canonicalHeadSha;
      const compare=await json(fetchImpl,`${base}/compare/${compareBase}...${currentHead}`,{headers:h});
      if(!compare.response.ok){consistency='UNKNOWN';commitShas=[currentHead];detail={code:'COMPARE_FAILED',status:compare.response.status,previousHeadSha:existing.consistency==='UNKNOWN'&&existing.recoveryBaseSha?existing.recoveryBaseSha:existing.canonicalHeadSha,currentHeadSha:currentHead};}
      else{
        const compareStatus=String(compare.body&&compare.body.status||'').toLowerCase();
        if(compareStatus==='ahead'||compareStatus==='identical'){
          commitShas=(compare.body.commits||[]).map(x=>x&&x.sha).filter(Boolean).map(x=>sha(x,'compare.commit.sha'));if(!commitShas.includes(currentHead))commitShas.push(currentHead);
        }else{consistency='UNKNOWN';commitShas=[currentHead];detail={code:'NON_FAST_FORWARD_BRANCH',compareStatus,previousHeadSha:existing.consistency==='UNKNOWN'&&existing.recoveryBaseSha?existing.recoveryBaseSha:existing.canonicalHeadSha,currentHeadSha:currentHead};}
      }
    }
    const ingested=ingestShas(sync,{id:repositoryId,fullName:repository.fullName},branch,commitShas,at);let next=upsertBranch(state,{repositoryId,repositoryFullName:repository.fullName,branch,canonicalHeadSha:currentHead,recoveryBaseSha:consistency==='CURRENT'?null:(detail&&detail.previousHeadSha||existing&&existing.recoveryBaseSha||existing&&existing.canonicalHeadSha||null),consistency,observedAt:at});
    if(consistency!=='CURRENT')next=addIncident(next,{code:detail.code,repositoryId,branch,at,detail});
    return freeze({status:consistency==='CURRENT'?'CURRENT':'UNKNOWN',state:next,syncAggregate:ingested.aggregate,currentHeadSha:currentHead,receivedCommitShas:ingested.received,dedupedCommitShas:ingested.deduped,requiresRetry:consistency!=='CURRENT'});
  }
  function recoverExpiredLeases(syncInput,options={}){
    let aggregate=requireSync().validateSyncAggregate(syncInput),recovered=[],claimed=[],limit=pos(options.limit||100,'limit'),workerId=id(options.workerId,'workerId'),now=iso(options.now),leaseSeconds=pos(options.leaseSeconds||60,'leaseSeconds');
    const expiredBefore=new Set(aggregate.jobs.filter(j=>j.status==='LEASED'&&new Date(j.leaseExpiresAt)<=new Date(now)).map(j=>j.id));
    for(let i=0;i<limit;i++){
      const result=requireSync().claimNextJob(aggregate,{workerId,now,leaseSeconds});aggregate=result.aggregate;if(result.status==='EMPTY'||result.status==='DEAD')break;if(result.status==='LEASED'){claimed.push(result.job.id);if(expiredBefore.has(result.job.id))recovered.push(result.job.id);}
    }
    return freeze({aggregate,recoveredJobIds:recovered.sort(),claimedJobIds:claimed.sort(),expiredCount:expiredBefore.size});
  }
  function businessFingerprint(value){return hash(value);}
  function assertBusinessStateUnchanged(beforeFingerprint,afterValue){const after=businessFingerprint(afterValue);if(after!==beforeFingerprint)throw error('BUSINESS_STATE_MUTATED_BY_SYNC_RECOVERY','同期自動補正はApproval/Decision/Waiver/Task等の業務判断を変更できません',{before:beforeFingerprint,after});return true;}
  function validateLoadProfile(profile){
    if(!profile||typeof profile!=='object')throw error('LOAD_PROFILE_REQUIRED','負荷profileが必要です');
    return freeze({id:id(profile.id,'profile.id'),approved:profile.approved===true,source:String(profile.source||''),integrationRecords:pos(profile.integrationRecords,'profile.integrationRecords'),missedCommits:pos(profile.missedCommits,'profile.missedCommits'),recalculationItems:pos(profile.recalculationItems,'profile.recalculationItems'),maxSyncMs:profile.maxSyncMs==null?null:Number(profile.maxSyncMs),maxRecalculationMs:profile.maxRecalculationMs==null?null:Number(profile.maxRecalculationMs),approvalRef:profile.approvalRef==null?null:clone(profile.approvalRef)});
  }
  function runLoadProbe(options={}){
    const profile=validateLoadProfile(options.profile),clock=options.clock||(()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now()),syncWork=typeof options.syncWork==='function'?options.syncWork:()=>{},recalculate=typeof options.recalculate==='function'?options.recalculate:()=>{};
    const t0=clock();syncWork(profile);const t1=clock();recalculate(profile);const t2=clock();
    const result={type:'C03LoadProbeResult',profile,measuredAt:iso(options.now),syncMs:Number((t1-t0).toFixed(3)),recalculationMs:Number((t2-t1).toFixed(3))};return freeze({...result,resultHash:hash(result)});
  }
  function assessLoadProbe(resultInput,options={}){
    const r=clone(resultInput),p=validateLoadProfile(r.profile);if(!p.approved)return freeze({status:'AWAITING_PROFILE_APPROVAL',accepted:false,exceedances:[],resultHash:r.resultHash});
    if(!(Number.isFinite(p.maxSyncMs)&&p.maxSyncMs>=0&&Number.isFinite(p.maxRecalculationMs)&&p.maxRecalculationMs>=0))throw error('APPROVED_PROFILE_REQUIRES_THRESHOLDS','承認済み負荷profileには許容値が必要です');
    const exceed=[];if(Number(r.syncMs)>p.maxSyncMs)exceed.push({metric:'syncMs',actual:Number(r.syncMs),limit:p.maxSyncMs});if(Number(r.recalculationMs)>p.maxRecalculationMs)exceed.push({metric:'recalculationMs',actual:Number(r.recalculationMs),limit:p.maxRecalculationMs});
    if(exceed.length&&!String(options.cause||'').trim())return freeze({status:'EXCEEDED_CAUSE_REQUIRED',accepted:false,exceedances:exceed,resultHash:r.resultHash});
    return freeze({status:exceed.length?'EXCEEDED_RECORDED':'PASS',accepted:true,exceedances:exceed,cause:exceed.length?String(options.cause):null,resultHash:r.resultHash});
  }
  return freeze({SCHEMA_VERSION,createRecoveryState,validateRecoveryState:validateState,recordDelivery,reconcileBranch,recoverExpiredLeases,businessFingerprint,assertBusinessStateUnchanged,validateLoadProfile,runLoadProbe,assessLoadProbe,stableStringify:stable,sha256:hash});
});
