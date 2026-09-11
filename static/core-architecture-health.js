(function(root,factory){
  let HashCore=root&&root.TSUGUCoreChangeSet,AE=root&&root.TSUGUCoreAssuranceEvent,Governance=root&&root.TSUGUCoreGovernance;
  if(typeof module==='object'&&module.exports){
    try{if(!HashCore)HashCore=require('./core-changeset.js');}catch{}
    try{if(!AE)AE=require('./core-assurance-event.js');}catch{}
    try{if(!Governance)Governance=require('./core-governance.js');}catch{}
  }
  const api=factory(root,HashCore,AE,Governance);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document)root.TSUGUCoreArchitectureHealth=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root,HashCore,AE,Governance){
  'use strict';
  const SCHEMA_VERSION=1;
  const HEALTH_ORDER=Object.freeze(['FAILED','CONFLICT','STALE','UNVERIFIED','WAIVED','VALID']);
  const HEALTH_SET=new Set(HEALTH_ORDER);
  const PRIORITY=new Map(HEALTH_ORDER.map((x,i)=>[x,i]));
  function error(code,message,detail){const e=new Error(`${code}: ${message}`);e.code=code;if(detail!==undefined)e.detail=detail;return e;}
  function requireHash(){if(!HashCore||typeof HashCore.sha256!=='function'||typeof HashCore.stableStringify!=='function')throw error('CHANGESET_CORE_REQUIRED','TSUGUCoreChangeSet が必要です');return HashCore;}
  function requireAE(){if(!AE||typeof AE.validateState!=='function')throw error('ASSURANCE_EVENT_CORE_REQUIRED','TSUGUCoreAssuranceEvent が必要です');return AE;}
  function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
  function deepFreeze(v){if(!v||typeof v!=='object'||Object.isFrozen(v))return v;Object.freeze(v);for(const x of Object.values(v))deepFreeze(x);return v;}
  function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())o[k]=canonical(v[k]);return o;}return v;}
  function stable(v){return requireHash().stableStringify(canonical(v));}
  function sha256(v){return requireHash().sha256(canonical(v));}
  function id(v,f){const s=String(v||'').trim();if(!s)throw error('INVALID_ID',`${f} が必要です`);return s;}
  function generation(v){const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw error('INVALID_EVALUATION_GENERATION','generation は1以上の整数である必要があります');return n;}
  function iso(v){const d=v==null?new Date():new Date(v);if(Number.isNaN(d.getTime()))throw error('INVALID_TIMESTAMP','時刻が不正です');return d.toISOString();}
  function sameRef(a,b){return stable(a)===stable(b);}
  function scopeKey(s){return stable(s);}
  function highest(statuses){let best='VALID';for(const s0 of statuses){const s=String(s0||'').toUpperCase();if(!HEALTH_SET.has(s))continue;if(PRIORITY.get(s)<PRIORITY.get(best))best=s;}return best;}
  function reason(code,status,message,source){return{code,status,message:String(message||''),source:clone(source||null)};}
  function activeWaivers(governance,scope,at){
    if(!governance||!Governance||typeof Governance.validateState!=='function')return[];
    const g=Governance.validateState(governance),revoked=new Set((g.waiverRevocations||[]).map(x=>x.targetId)),out=[];
    for(const w of g.waivers||[]){
      if(revoked.has(w.id)||new Date(at)>=new Date(w.expiresAt))continue;
      if(!sameRef(w.scope,scope.subject))continue;
      let valid=false;
      try{if(typeof Governance.assertRuleWeakeningWaiver==='function'){Governance.assertRuleWeakeningWaiver(g,w.id,{targetRule:w.targetRule,supersededRule:w.supersededRule,scope:w.scope,policyVersion:w.policyVersion},{now:at});valid=true;}}catch{}
      if(valid)out.push(w);
    }
    return out;
  }
  function impactForSubject(impactGraph,subject){
    if(!impactGraph)return{known:false,impacted:false,fullTest:false,sources:[]};
    const type=String(subject&&subject.type||'').toUpperCase(),sid=String(subject&&subject.id||''),sources=[];
    let impacted=false,fullTest=false;
    if(type==='BOX_INSTANCE'){
      for(const i of impactGraph.impacts||[])if((i.boxInstanceIds||[]).includes(sid)){impacted=true;sources.push(`impact:${i.sourceKind||'UNKNOWN'}:${i.sourceId||''}`);}
      for(const s of impactGraph.fullTestScopes||[])if((s.boxInstanceIds||[]).includes(sid)){fullTest=true;sources.push(`full-test:repo:${s.repositoryId}`);}
    }
    if(type==='ARCHITECTURE_NODE'){
      for(const s of impactGraph.fullTestScopes||[])if((s.architectureNodeIds||[]).includes(sid)){fullTest=true;sources.push(`full-test:repo:${s.repositoryId}`);}
    }
    if(impactGraph.requiresFullTest&&!(type==='BOX_INSTANCE'||type==='ARCHITECTURE_NODE'))fullTest=true;
    return{known:true,impacted,fullTest,sources:[...new Set(sources)].sort()};
  }
  function classifyEvent(ae,eventDef,impactGraph,governance,at){
    const sk=scopeKey(eventDef.scope),current=(ae.assuranceEvaluations||[]).filter(x=>x.generation===ae.generation&&scopeKey(x.scope)===sk),old=(ae.assuranceEvaluations||[]).filter(x=>x.generation<ae.generation&&scopeKey(x.scope)===sk).sort((a,b)=>a.generation-b.generation||String(a.evaluatedAt).localeCompare(String(b.evaluatedAt)));
    const impact=impactForSubject(impactGraph,eventDef.scope.subject),reasons=[],statuses=[];
    const resultSet=new Set(current.map(x=>x.result));
    if(resultSet.size>1){statuses.push('CONFLICT');reasons.push(reason('CONTRADICTORY_CURRENT_ASSURANCE','CONFLICT','同一scope・同一世代に矛盾するAssuranceがあります',{eventDefinitionId:eventDef.id,generation:ae.generation,results:[...resultSet].sort()}));}
    if(resultSet.has('FAILED')){statuses.push('FAILED');reasons.push(reason('CURRENT_ASSURANCE_FAILED','FAILED','現在世代のAssuranceがFAILEDです',{eventDefinitionId:eventDef.id,generation:ae.generation,assuranceIds:current.filter(x=>x.result==='FAILED').map(x=>x.id).sort()}));}
    if(resultSet.has('UNKNOWN')){statuses.push('UNVERIFIED');reasons.push(reason('CURRENT_ASSURANCE_UNKNOWN','UNVERIFIED','現在世代のAssuranceがUNKNOWNです',{eventDefinitionId:eventDef.id,generation:ae.generation}));}
    if(ae.syncState==='UNKNOWN'){
      statuses.push('STALE');reasons.push(reason('SYNC_UNKNOWN','STALE','同期状態がUNKNOWNのため現在保証を確定できません',{generation:ae.generation}));
    }else if(ae.syncState==='RECALCULATING'){
      if(!impact.known){statuses.push('STALE');reasons.push(reason('IMPACT_GRAPH_REQUIRED','STALE','再計算中にImpact Graphがないため安全側に失効します',{generation:ae.generation}));}
      else if(impact.impacted||impact.fullTest){statuses.push('STALE');reasons.push(reason(impact.fullTest?'FULL_TEST_REQUIRED':'IMPACT_REVALIDATION_REQUIRED','STALE','このscopeは変更影響範囲なので再検証が必要です',{eventDefinitionId:eventDef.id,impactSources:impact.sources}));}
      else if(!current.length&&old.length){
        const last=old[old.length-1];
        if(last.result==='VALID'){statuses.push('VALID');reasons.push(reason('UNAFFECTED_CARRY_FORWARD','VALID','Impact Graphが非影響を証明したため直前世代のVALIDを局所的に継続利用できます',{eventDefinitionId:eventDef.id,fromGeneration:last.generation,toGeneration:ae.generation,assuranceId:last.id}));}
        else if(last.result==='FAILED'){statuses.push('FAILED');reasons.push(reason('UNAFFECTED_PRIOR_FAILURE','FAILED','非影響scopeの既存FAILEDは変更で解消されたとはみなしません',{eventDefinitionId:eventDef.id,assuranceId:last.id}));}
        else{statuses.push('UNVERIFIED');reasons.push(reason('UNAFFECTED_PRIOR_UNKNOWN','UNVERIFIED','非影響scopeでも直前結果がUNKNOWNです',{eventDefinitionId:eventDef.id,assuranceId:last.id}));}
      }
    }
    if(ae.syncState==='CURRENT'){
      if(!current.length){
        if(old.some(x=>x.result==='VALID')){statuses.push('STALE');reasons.push(reason('OLD_GENERATION_ONLY','STALE','VALIDは旧評価世代にしか存在しません',{eventDefinitionId:eventDef.id,generation:ae.generation}));}
        else{statuses.push('UNVERIFIED');reasons.push(reason('NO_CURRENT_ASSURANCE','UNVERIFIED','現在世代のAssuranceがありません',{eventDefinitionId:eventDef.id,generation:ae.generation}));}
      }else if(resultSet.size===1&&resultSet.has('VALID')){statuses.push('VALID');reasons.push(reason('CURRENT_ASSURANCE_VALID','VALID','現在世代のAssuranceがVALIDです',{eventDefinitionId:eventDef.id,generation:ae.generation,assuranceIds:current.map(x=>x.id).sort()}));}
    }
    if(ae.syncState==='RECALCULATING'&&current.length&&resultSet.size===1&&resultSet.has('VALID')&&!impact.impacted&&!impact.fullTest){statuses.push('VALID');reasons.push(reason('CURRENT_ASSURANCE_VALID','VALID','再計算中でも現在世代のこのscopeはVALIDです',{eventDefinitionId:eventDef.id,generation:ae.generation}));}
    const waivers=activeWaivers(governance,eventDef.scope,at);if(waivers.length){statuses.push('WAIVED');reasons.push(reason('ACTIVE_WAIVER','WAIVED','有効なWaiverがあります',{waiverIds:waivers.map(x=>x.id).sort()}));}
    if(!statuses.length){statuses.push('UNVERIFIED');reasons.push(reason('NO_HEALTH_EVIDENCE','UNVERIFIED','Healthを確定する情報が不足しています',{eventDefinitionId:eventDef.id}));}
    const status=highest(statuses);
    return{type:'ArchitectureHealthItem',id:`event:${eventDef.id}@${eventDef.version}`,eventDefinitionId:eventDef.id,eventVersion:eventDef.version,subject:clone(eventDef.scope.subject),scope:clone(eventDef.scope),status,reasons:reasons.sort((a,b)=>stable(a).localeCompare(stable(b))),provenance:{assuranceIds:[...new Set([...current,...old].map(x=>x.id))].sort(),impactSources:impact.sources,waiverIds:waivers.map(x=>x.id).sort()}};
  }
  function fullTestItems(impactGraph,projectId){
    if(!impactGraph)return[];return(impactGraph.fullTestScopes||[]).map((s,i)=>({type:'ArchitectureHealthItem',id:`full-test:${s.repositoryId}:${i}`,eventDefinitionId:null,eventVersion:null,subject:null,scope:null,status:'STALE',reasons:[reason('FULL_TEST_REQUIRED','STALE','判定不能変更のため関連範囲のFull testが必要です',{repositoryId:s.repositoryId,reasonCodes:(s.reasonCodes||[]).slice().sort(),sources:(s.sources||[]).slice().sort()})],provenance:{repositoryId:s.repositoryId,architectureNodeIds:(s.architectureNodeIds||[]).slice().sort(),boxInstanceIds:(s.boxInstanceIds||[]).slice().sort()}}));
  }
  function summarize(items){
    const counts=Object.fromEntries(HEALTH_ORDER.map(x=>[x,0]));for(const i of items)counts[i.status]=(counts[i.status]||0)+1;
    const reasons=[];for(const i of items)for(const r of i.reasons||[])reasons.push({...clone(r),itemId:i.id,itemStatus:i.status});
    reasons.sort((a,b)=>stable(a).localeCompare(stable(b)));
    return{overall:items.length?highest(items.map(x=>x.status)):'UNVERIFIED',counts,reasons};
  }
  function inputContext(input,ae,governance,impactGraph,at){return{projectId:ae.projectId,generation:ae.generation,assuranceRevision:ae.revision,assuranceSyncState:ae.syncState,governanceRevision:governance&&governance.revision||null,impactHash:impactGraph&&impactGraph.impactHash||null,asOf:at};}
  function buildArchitectureHealth(input,options={}){
    const r=input&&typeof input==='object'?input:{},ae=requireAE().validateState(r.assuranceEventRegistry),projectId=id(r.projectId||ae.projectId,'projectId');if(ae.projectId!==projectId)throw error('PROJECT_SCOPE_VIOLATION','Assurance/Eventが別Projectです');
    const gen=generation(r.generation||ae.generation);if(gen!==ae.generation)throw error('STALE_HEALTH_GENERATION',`requested=${gen}, current=${ae.generation}`);
    let governance=null;if(r.governanceRegistry!=null){if(!Governance||typeof Governance.validateState!=='function')throw error('GOVERNANCE_CORE_REQUIRED','TSUGUCoreGovernance が必要です');governance=Governance.validateState(r.governanceRegistry);if(governance.projectId!==projectId)throw error('PROJECT_SCOPE_VIOLATION','Governanceが別Projectです');}
    const impactGraph=r.impactGraph==null?null:clone(r.impactGraph);if(impactGraph&&impactGraph.projectId!==projectId)throw error('PROJECT_SCOPE_VIOLATION','Impact Graphが別Projectです');
    const at=iso(options.now||r.asOf),items=(ae.eventDefinitions||[]).map(e=>classifyEvent(ae,e,impactGraph,governance,at));items.push(...fullTestItems(impactGraph,projectId));items.sort((a,b)=>a.id.localeCompare(b.id));
    const summary=summarize(items),context=inputContext(r,ae,governance,impactGraph,at),inputHash=sha256(context),core={type:'ArchitectureHealthSnapshot',schemaVersion:SCHEMA_VERSION,projectId,generation:ae.generation,context,inputHash,items,summary};
    return deepFreeze({...core,healthHash:sha256(core)});
  }
  function taskSubject(task){if(!task||typeof task!=='object')throw error('TASK_REQUIRED','Taskが必要です');return task.subject||null;}
  function conditionEventIds(task){return new Set([...(task.startConditions||[]),...(task.completionConditions||[])].filter(x=>String(x.type||'').toUpperCase()==='EVENT').map(x=>String(x.ref&&x.ref.id||'')).filter(Boolean));}
  function itemRelevantToTask(item,task){const subject=taskSubject(task);if(item.eventDefinitionId&&conditionEventIds(task).has(item.eventDefinitionId))return true;if(item.subject&&subject&&sameRef(item.subject,subject))return true;if(subject&&String(subject.type||'').toUpperCase()==='BOX_INSTANCE'&&(item.provenance&&item.provenance.boxInstanceIds||[]).includes(subject.id))return true;if(subject&&String(subject.type||'').toUpperCase()==='ARCHITECTURE_NODE'&&(item.provenance&&item.provenance.architectureNodeIds||[]).includes(subject.id))return true;return false;}
  function evaluateTaskHealth(snapshotInput,task,options={}){
    const s=clone(snapshotInput);if(!s||s.type!=='ArchitectureHealthSnapshot'||Number(s.schemaVersion)!==SCHEMA_VERSION)throw error('INVALID_HEALTH_SNAPSHOT','C-02 Health snapshotが不正です');if(sha256({type:s.type,schemaVersion:s.schemaVersion,projectId:s.projectId,generation:s.generation,context:s.context,inputHash:s.inputHash,items:s.items,summary:s.summary})!==s.healthHash)throw error('HEALTH_HASH_MISMATCH','Health snapshot hashが一致しません');
    if(options.projectId&&String(options.projectId)!==s.projectId)throw error('PROJECT_SCOPE_VIOLATION','TaskとHealthが別Projectです');if(options.generation!=null&&Number(options.generation)!==s.generation)throw error('STALE_HEALTH_GENERATION','Task評価世代とHealthが一致しません');
    const relevant=(s.items||[]).filter(i=>itemRelevantToTask(i,task)),status=relevant.length?highest(relevant.map(x=>x.status)):'UNVERIFIED';
    const reasons=relevant.flatMap(x=>(x.reasons||[]).map(r=>({...clone(r),itemId:x.id}))).sort((a,b)=>stable(a).localeCompare(stable(b)));
    return deepFreeze({taskId:String(task.id||''),projectId:s.projectId,generation:s.generation,status,ready:status==='VALID'||status==='WAIVED',relevantItemIds:relevant.map(x=>x.id).sort(),reasons});
  }
  function cacheKey(context){return sha256({projectId:context.projectId,generation:context.generation,assuranceRevision:context.assuranceRevision,assuranceSyncState:context.assuranceSyncState,governanceRevision:context.governanceRevision,impactHash:context.impactHash,asOf:context.asOf});}
  function createHealthCache(){return{type:'ArchitectureHealthCache',schemaVersion:SCHEMA_VERSION,entries:{}};}
  function writeHealthCache(cacheInput,snapshotInput){const cache=clone(cacheInput||createHealthCache()),s=clone(snapshotInput);if(cache.type!=='ArchitectureHealthCache'||Number(cache.schemaVersion)!==SCHEMA_VERSION)throw error('INVALID_HEALTH_CACHE','Health cacheが不正です');if(!s||s.type!=='ArchitectureHealthSnapshot')throw error('INVALID_HEALTH_SNAPSHOT','Health snapshotが必要です');const key=cacheKey(s.context);cache.entries[key]={projectId:s.projectId,generation:s.generation,inputHash:s.inputHash,healthHash:s.healthHash,snapshot:s};return deepFreeze(cache);}
  function readHealthCache(cacheInput,context){const cache=cacheInput||createHealthCache();if(cache.type!=='ArchitectureHealthCache'||Number(cache.schemaVersion)!==SCHEMA_VERSION)throw error('INVALID_HEALTH_CACHE','Health cacheが不正です');const key=cacheKey(context),row=cache.entries&&cache.entries[key];if(!row)return null;if(row.projectId!==context.projectId||Number(row.generation)!==Number(context.generation))return null;const s=row.snapshot;if(!s||s.inputHash!==row.inputHash||s.healthHash!==row.healthHash)return null;return deepFreeze(clone(s));}
  function invalidateHealthCache(cacheInput,input={}){const cache=clone(cacheInput||createHealthCache()),projectId=input.projectId==null?null:String(input.projectId),generationFloor=input.generation==null?null:Number(input.generation);for(const [k,row] of Object.entries(cache.entries||{})){if(projectId&&row.projectId!==projectId)continue;if(generationFloor==null||Number(row.generation)<generationFloor)delete cache.entries[k];}return deepFreeze(cache);}
  function rebuildArchitectureHealth(cacheInput,input,options={}){const snapshot=buildArchitectureHealth(input,options),cached=readHealthCache(cacheInput,snapshot.context);if(cached)return deepFreeze({source:'CACHE',snapshot:cached,cache:deepFreeze(clone(cacheInput))});const cache=writeHealthCache(cacheInput,snapshot);return deepFreeze({source:'REBUILT',snapshot,cache});}
  return deepFreeze({SCHEMA_VERSION,HEALTH_ORDER,buildArchitectureHealth,evaluateTaskHealth,createHealthCache,writeHealthCache,readHealthCache,invalidateHealthCache,rebuildArchitectureHealth,cacheKey,stableStringify:stable,sha256});
});
