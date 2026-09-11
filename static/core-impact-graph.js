(function(root,factory){
  let RuleTest=root&&root.TSUGUCoreRuleTest;
  let HashCore=root&&root.TSUGUCoreChangeSet;
  if(typeof module==='object'&&module.exports){
    try{if(!RuleTest)RuleTest=require('./core-rule-test.js');}catch{}
    try{if(!HashCore)HashCore=require('./core-changeset.js');}catch{}
  }
  const api=factory(root,RuleTest,HashCore);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document)root.TSUGUCoreImpactGraph=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root,RuleTest,HashCore){
  'use strict';
  const SCHEMA_VERSION=1;
  const RELATIONS=Object.freeze(['IMPLEMENTS','TESTS','CONFIGURES','MIGRATES']);
  const RELATION_SET=new Set(RELATIONS);
  const MAPPING_STATES=new Set(['MAPPED','MAPPED_RENAME','UNMAPPED','CONFIRMATION_REQUIRED']);
  const CHANGE_TYPES=new Set(['ADDED','MODIFIED','REMOVED','RENAMED','COPIED','CHANGED','UNKNOWN']);
  const FACT_TYPES=new Set(['RULE_DEFINITION','RULE_BINDING','ARCHITECTURE_BINDING','TEST_DEFINITION','UNCLASSIFIED']);
  const POLICIES=Object.freeze({
    IMPLEMENTS:Object.freeze({impactClass:'IMPLEMENTATION',requiredAction:'REVALIDATE_REQUIREMENTS',assuranceScope:'MATCHED_REQUIREMENTS'}),
    TESTS:Object.freeze({impactClass:'TEST_CODE',requiredAction:'RETEST_MATCHED_REQUIREMENTS',assuranceScope:'MATCHED_REQUIREMENTS_ONLY'}),
    CONFIGURES:Object.freeze({impactClass:'CONFIGURATION',requiredAction:'REVALIDATE_REQUIREMENTS',assuranceScope:'MATCHED_REQUIREMENTS'}),
    MIGRATES:Object.freeze({impactClass:'MIGRATION',requiredAction:'REVALIDATE_REQUIREMENTS',assuranceScope:'MATCHED_REQUIREMENTS'})
  });
  function err(code,message,detail){const e=new Error(`${code}: ${message}`);e.code=code;if(detail!==undefined)e.detail=detail;return e;}
  function obj(v,code,label){if(!v||typeof v!=='object'||Array.isArray(v))throw err(code,`${label} が必要です`);return v;}
  function id(v,field){const s=String(v||'').trim();if(!s||s.length>240||/[\u0000-\u001f\u007f]/.test(s))throw err('INVALID_ID',`${field} が不正です`);return s;}
  function posInt(v,field){const n=Number(v);if(!Number.isSafeInteger(n)||n<=0)throw err('INVALID_POSITIVE_INTEGER',`${field} が不正です`);return n;}
  function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
  function deepFreeze(v){if(!v||typeof v!=='object'||Object.isFrozen(v))return v;Object.freeze(v);for(const c of Object.values(v))deepFreeze(c);return v;}
  function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())o[k]=canonical(v[k]);return o;}return v;}
  function requireRuleTest(){if(!RuleTest||typeof RuleTest.validateState!=='function')throw err('RULE_TEST_CORE_REQUIRED','TSUGUCoreRuleTest が必要です');return RuleTest;}
  function requireHash(){if(!HashCore||typeof HashCore.sha256!=='function'||typeof HashCore.stableStringify!=='function')throw err('CHANGESET_CORE_REQUIRED','TSUGUCoreChangeSet が必要です');return HashCore;}
  function stable(v){return requireHash().stableStringify(canonical(v));}
  function sha256(v){return requireHash().sha256(canonical(v));}
  function uniqSorted(values){return [...new Set(values)].sort();}
  function refKey(type,idValue){return `${type}:${idValue}`;}
  function edgeKey(e){return stable(e);}
  function impactKey(x){return stable(x);}
  function activeAt(binding,revision){return Number(binding.activeFromRevision)<=revision&&(binding.inactiveFromRevision==null||revision<Number(binding.inactiveFromRevision));}

  function normalizeFile(raw,index){
    const r=obj(raw,'ACTUAL_FILE_REQUIRED',`files[${index}]`),changeType=String(r.changeType||'').toUpperCase(),mappingStatus=String(r.mappingStatus||'').toUpperCase();
    if(!CHANGE_TYPES.has(changeType))throw err('INVALID_ACTUAL_CHANGE_TYPE',changeType||'<empty>');
    if(!MAPPING_STATES.has(mappingStatus))throw err('INVALID_PATH_MAPPING_STATUS',mappingStatus||'<empty>');
    const path=String(r.path||'').normalize('NFC');if(!path)throw err('INVALID_REPOSITORY_PATH',`files[${index}].path が不正です`);
    const pathEntryId=r.pathEntryId==null?null:id(r.pathEntryId,`files[${index}].pathEntryId`);
    if(mappingStatus.startsWith('MAPPED')&&!pathEntryId)throw err('MAPPED_PATH_REQUIRES_STABLE_ID',path);
    if(!mappingStatus.startsWith('MAPPED')&&pathEntryId)throw err('UNRESOLVED_PATH_MUST_NOT_HAVE_STABLE_ID',path);
    return {changeType,path,previousPath:r.previousPath==null?null:String(r.previousPath).normalize('NFC'),pathEntryId,mappingStatus};
  }
  function normalizeActual(actual,projectId,repoIds){
    if(actual==null)return null;const r=obj(actual,'ACTUAL_CHANGE_REQUIRED','ActualChange');
    if(id(r.projectId,'ActualChange.projectId')!==projectId)throw err('PROJECT_SCOPE_VIOLATION','ActualChangeが別Projectです');
    const repositoryId=posInt(r.repositoryId,'ActualChange.repositoryId');if(!repoIds.has(repositoryId))throw err('REPOSITORY_SCOPE_VIOLATION',String(repositoryId));
    return {id:r.id==null?'actual:impact':id(r.id,'ActualChange.id'),repositoryId,files:(r.files||[]).map(normalizeFile)};
  }
  function normalizeBindingRow(raw,label,projectId){
    const r=obj(raw,'ARCHITECTURE_BINDING_REQUIRED',label);if(r.projectId!=null&&id(r.projectId,`${label}.projectId`)!==projectId)throw err('PROJECT_SCOPE_VIOLATION',`${label}が別Projectです`);
    const relation=String(r.relation||'').toUpperCase();if(!RELATION_SET.has(relation))throw err('INVALID_BINDING_RELATION',relation||'<empty>');
    const targetType=String(r.targetType||'NODE').toUpperCase();if(!['NODE','BOX_INSTANCE'].includes(targetType))throw err('INVALID_BINDING_TARGET',targetType);
    const architectureNodeId=targetType==='NODE'?id(r.architectureNodeId,`${label}.architectureNodeId`):null;
    const boxInstanceId=targetType==='BOX_INSTANCE'?id(r.boxInstanceId,`${label}.boxInstanceId`):null;
    return {id:r.id==null?`${label}:anonymous`:id(r.id,`${label}.id`),pathEntryId:r.pathEntryId==null?null:id(r.pathEntryId,`${label}.pathEntryId`),relation,targetType,architectureNodeId,boxInstanceId};
  }
  function normalizeFact(raw,index,projectId){
    const r=obj(raw,'IMPACT_CHANGE_FACT_REQUIRED',`changeFacts[${index}]`),type=String(r.type||'').toUpperCase();if(!FACT_TYPES.has(type))throw err('UNSUPPORTED_IMPACT_CHANGE_FACT',type||'<empty>');
    if(r.projectId!=null&&id(r.projectId,`changeFacts[${index}].projectId`)!==projectId)throw err('PROJECT_SCOPE_VIOLATION',`changeFacts[${index}]が別Projectです`);
    const base={type,id:r.id==null?`fact:${index+1}`:id(r.id,`changeFacts[${index}].id`),repositoryId:r.repositoryId==null?null:posInt(r.repositoryId,`changeFacts[${index}].repositoryId`)};
    if(type==='RULE_DEFINITION')return {...base,ruleDefinitionId:id(r.ruleDefinitionId,`changeFacts[${index}].ruleDefinitionId`),ruleDefinitionVersion:r.ruleDefinitionVersion==null?null:posInt(r.ruleDefinitionVersion,`changeFacts[${index}].ruleDefinitionVersion`)};
    if(type==='TEST_DEFINITION')return {...base,testDefinitionId:id(r.testDefinitionId,`changeFacts[${index}].testDefinitionId`),testDefinitionVersion:r.testDefinitionVersion==null?null:posInt(r.testDefinitionVersion,`changeFacts[${index}].testDefinitionVersion`)};
    if(type==='RULE_BINDING')return {...base,ruleBindingId:r.ruleBindingId==null?null:id(r.ruleBindingId,`changeFacts[${index}].ruleBindingId`),previousBinding:r.previousBinding==null?null:clone(r.previousBinding),currentBinding:r.currentBinding==null?null:clone(r.currentBinding)};
    if(type==='ARCHITECTURE_BINDING')return {...base,bindingId:r.bindingId==null?null:id(r.bindingId,`changeFacts[${index}].bindingId`),previousBinding:r.previousBinding==null?null:normalizeBindingRow(r.previousBinding,`changeFacts[${index}].previousBinding`,projectId),currentBinding:r.currentBinding==null?null:normalizeBindingRow(r.currentBinding,`changeFacts[${index}].currentBinding`,projectId)};
    return base;
  }

  function buildContext(ruleTestInput,revisionOverride){
    const state=requireRuleTest().validateState(ruleTestInput),box=state.boxRegistry,architecture=box.architecture,projectId=state.projectId;
    const revision=revisionOverride==null?Number(architecture.project.revision):posInt(revisionOverride,'architectureRevision');
    const repoIds=new Set((architecture.repositoryScopes||[]).map(x=>Number(x.repositoryId)));
    const pathById=new Map((architecture.pathEntries||[]).map(x=>[x.id,x]));
    const nodes=architecture.architectureNodes||[],nodeById=new Map(nodes.map(x=>[x.id,x]));
    const instances=box.boxInstances||[],instanceById=new Map(instances.map(x=>[x.id,x]));
    const requirements=(state.testRequirements||[]).filter(x=>x.status==='ACTIVE');
    const activeBindings=(box.bindings||[]).filter(x=>activeAt(x,revision));
    const bindingsByPath=new Map();for(const b of activeBindings){if(!bindingsByPath.has(b.pathEntryId))bindingsByPath.set(b.pathEntryId,[]);bindingsByPath.get(b.pathEntryId).push(b);}
    for(const list of bindingsByPath.values())list.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    return {state,box,architecture,projectId,revision,repoIds,pathById,nodes,nodeById,instances,instanceById,requirements,activeBindings,bindingsByPath};
  }
  function nodeScope(ctx,nodeId){
    if(!ctx.nodeById.has(nodeId))throw err('IMPACT_NODE_NOT_FOUND',nodeId);const out=new Set([nodeId]),queue=[nodeId];
    while(queue.length){const p=queue.shift();for(const n of ctx.nodes)if(n.parentNodeId===p&&!out.has(n.id)){out.add(n.id);queue.push(n.id);}}
    return out;
  }
  function boxScope(ctx,boxId){
    if(!ctx.instanceById.has(boxId))throw err('IMPACT_BOX_NOT_FOUND',boxId);const out=new Set([boxId]),queue=[boxId];
    while(queue.length){const p=queue.shift();for(const x of ctx.instances)if(x.parentBoxInstanceId===p&&!out.has(x.id)){out.add(x.id);queue.push(x.id);}}
    return out;
  }
  function boxesForBinding(ctx,binding){
    if(binding.targetType==='BOX_INSTANCE')return boxScope(ctx,binding.boxInstanceId);
    const nodes=nodeScope(ctx,binding.architectureNodeId),out=new Set();for(const x of ctx.instances)if(nodes.has(x.architectureNodeId))out.add(x.id);return out;
  }
  function requirementsForBoxes(ctx,boxIds){return ctx.requirements.filter(r=>r.target&&boxIds.has(r.target.boxInstanceId));}
  function relationImpact(ctx,source,binding,extra={}){
    const relation=String(binding.relation||'').toUpperCase();if(!RELATION_SET.has(relation))throw err('INVALID_BINDING_RELATION',relation);
    const boxes=boxesForBinding(ctx,binding),reqs=requirementsForBoxes(ctx,boxes),policy=POLICIES[relation];
    const targetId=binding.targetType==='NODE'?binding.architectureNodeId:binding.boxInstanceId;
    return {
      sourceKind:source.kind,sourceId:source.id,repositoryId:source.repositoryId==null?null:Number(source.repositoryId),pathEntryId:source.pathEntryId||binding.pathEntryId||null,path:source.path||null,
      bindingId:binding.id||null,relation,targetType:binding.targetType,targetId,
      boxInstanceIds:uniqSorted([...boxes]),requirementIds:uniqSorted(reqs.map(x=>x.id)),
      testDefinitions:uniqSorted(reqs.map(x=>`${x.testDefinition.id}@${x.testDefinition.version}`)),
      impactClass:policy.impactClass,requiredAction:policy.requiredAction,assuranceScope:policy.assuranceScope,
      ...extra
    };
  }
  function fullScopeForRepo(ctx,repositoryId,reason,source){
    const rid=Number(repositoryId),bindings=ctx.activeBindings.filter(b=>{const p=ctx.pathById.get(b.pathEntryId);return p&&Number(p.repositoryId)===rid;});
    const nodeIds=new Set(),boxIds=new Set();
    for(const b of bindings){if(b.targetType==='NODE'){for(const n of nodeScope(ctx,b.architectureNodeId))nodeIds.add(n);for(const x of boxesForBinding(ctx,b))boxIds.add(x);}else{for(const x of boxesForBinding(ctx,b)){boxIds.add(x);const inst=ctx.instanceById.get(x);if(inst)nodeIds.add(inst.architectureNodeId);}}}
    if(!nodeIds.size)for(const n of ctx.nodes)nodeIds.add(n.id);if(!boxIds.size)for(const b of ctx.instances)boxIds.add(b.id);
    return {projectId:ctx.projectId,repositoryId:rid,architectureNodeIds:uniqSorted([...nodeIds]),boxInstanceIds:uniqSorted([...boxIds]),reasonCodes:[reason],sources:[source]};
  }
  function addFallback(ctx,acc,repositoryId,reason,source){
    const repoCandidates=repositoryId==null?[...ctx.repoIds]:[Number(repositoryId)];
    for(const rid of repoCandidates){if(!ctx.repoIds.has(rid))throw err('REPOSITORY_SCOPE_VIOLATION',String(rid));const next=fullScopeForRepo(ctx,rid,reason,source);const existing=acc.find(x=>x.repositoryId===rid);if(existing){existing.reasonCodes=uniqSorted([...existing.reasonCodes,...next.reasonCodes]);existing.sources=uniqSorted([...existing.sources,...next.sources]);existing.architectureNodeIds=uniqSorted([...existing.architectureNodeIds,...next.architectureNodeIds]);existing.boxInstanceIds=uniqSorted([...existing.boxInstanceIds,...next.boxInstanceIds]);}else acc.push(next);}
  }
  function scopeFromRuleBinding(ctx,row){
    if(!row||typeof row!=='object')return null;const targetType=String(row.targetType||'').toUpperCase(),inherit=row.inheritToChildren!==false,out=new Set();
    if(targetType==='BOX_INSTANCE'&&row.boxInstanceId){const exact=String(row.boxInstanceId);if(!ctx.instanceById.has(exact))return null;if(inherit)return boxScope(ctx,exact);out.add(exact);return out;}
    if(targetType==='BOX_DEFINITION'&&row.boxDefinitionId&&row.boxDefinitionVersion!=null){for(const x of ctx.instances)if(x.boxDefinitionId===String(row.boxDefinitionId)&&Number(x.boxDefinitionVersion)===Number(row.boxDefinitionVersion)){out.add(x.id);if(inherit)for(const c of boxScope(ctx,x.id))out.add(c);}return out;}
    return null;
  }
  function factImpact(ctx,fact,impacts,fallbacks,edges){
    if(fact.type==='UNCLASSIFIED'){addFallback(ctx,fallbacks,fact.repositoryId,'UNCLASSIFIED_CHANGE',fact.id);return;}
    if(fact.type==='RULE_DEFINITION'){
      const reqs=ctx.requirements.filter(r=>(r.effectiveRules&&r.effectiveRules.sources||[]).some(s=>s.ruleDefinitionId===fact.ruleDefinitionId&&(fact.ruleDefinitionVersion==null||Number(s.ruleDefinitionVersion)===fact.ruleDefinitionVersion)));
      if(reqs.length){const impact={sourceKind:'RULE_DEFINITION',sourceId:fact.id,repositoryId:fact.repositoryId,relation:null,targetType:'RULE_DEFINITION',targetId:fact.ruleDefinitionId,boxInstanceIds:uniqSorted(reqs.map(r=>r.target.boxInstanceId)),requirementIds:uniqSorted(reqs.map(r=>r.id)),testDefinitions:uniqSorted(reqs.map(r=>`${r.testDefinition.id}@${r.testDefinition.version}`)),impactClass:'RULE',requiredAction:'REVALIDATE_REQUIREMENTS',assuranceScope:'MATCHED_REQUIREMENTS'};impacts.push(impact);for(const r of reqs)edges.push({from:refKey('RULE_DEFINITION',fact.ruleDefinitionId),to:refKey('TEST_REQUIREMENT',r.id),relation:'RULE_AFFECTS'});}return;
    }
    if(fact.type==='TEST_DEFINITION'){
      const reqs=ctx.requirements.filter(r=>r.testDefinition&&r.testDefinition.id===fact.testDefinitionId&&(fact.testDefinitionVersion==null||Number(r.testDefinition.version)===fact.testDefinitionVersion));
      if(reqs.length){const impact={sourceKind:'TEST_DEFINITION',sourceId:fact.id,repositoryId:fact.repositoryId,relation:'TESTS',targetType:'TEST_DEFINITION',targetId:fact.testDefinitionId,boxInstanceIds:uniqSorted(reqs.map(r=>r.target.boxInstanceId)),requirementIds:uniqSorted(reqs.map(r=>r.id)),testDefinitions:uniqSorted(reqs.map(r=>`${r.testDefinition.id}@${r.testDefinition.version}`)),impactClass:'TEST_CODE',requiredAction:'RETEST_MATCHED_REQUIREMENTS',assuranceScope:'MATCHED_REQUIREMENTS_ONLY'};impacts.push(impact);for(const r of reqs)edges.push({from:refKey('TEST_DEFINITION',fact.testDefinitionId),to:refKey('TEST_REQUIREMENT',r.id),relation:'TESTS'});}return;
    }
    if(fact.type==='RULE_BINDING'){
      let reqs=[];if(fact.ruleBindingId)reqs=ctx.requirements.filter(r=>(r.effectiveRules&&r.effectiveRules.sources||[]).some(s=>s.bindingId===fact.ruleBindingId));
      const scopes=[scopeFromRuleBinding(ctx,fact.previousBinding),scopeFromRuleBinding(ctx,fact.currentBinding)].filter(Boolean);for(const s of scopes)reqs.push(...requirementsForBoxes(ctx,s));
      reqs=[...new Map(reqs.map(r=>[r.id,r])).values()];
      if(!reqs.length&&!scopes.length){addFallback(ctx,fallbacks,fact.repositoryId,'RULE_BINDING_TARGET_UNKNOWN',fact.id);return;}
      if(reqs.length){impacts.push({sourceKind:'RULE_BINDING',sourceId:fact.id,repositoryId:fact.repositoryId,relation:null,targetType:'RULE_BINDING',targetId:fact.ruleBindingId||fact.id,boxInstanceIds:uniqSorted(reqs.map(r=>r.target.boxInstanceId)),requirementIds:uniqSorted(reqs.map(r=>r.id)),testDefinitions:uniqSorted(reqs.map(r=>`${r.testDefinition.id}@${r.testDefinition.version}`)),impactClass:'RULE_BINDING',requiredAction:'REVALIDATE_REQUIREMENTS',assuranceScope:'MATCHED_REQUIREMENTS'});}return;
    }
    if(fact.type==='ARCHITECTURE_BINDING'){
      const rows=[];if(fact.bindingId){const current=ctx.activeBindings.find(b=>b.id===fact.bindingId);if(current)rows.push(normalizeBindingRow(current,`binding:${fact.bindingId}`,ctx.projectId));}
      if(fact.previousBinding)rows.push(fact.previousBinding);if(fact.currentBinding)rows.push(fact.currentBinding);
      const unique=[...new Map(rows.map(r=>[stable(r),r])).values()];if(!unique.length){addFallback(ctx,fallbacks,fact.repositoryId,'ARCHITECTURE_BINDING_TARGET_UNKNOWN',fact.id);return;}
      for(const row of unique){const im=relationImpact(ctx,{kind:'ARCHITECTURE_BINDING',id:fact.id,repositoryId:fact.repositoryId,pathEntryId:row.pathEntryId},row,{changeFactType:'ARCHITECTURE_BINDING'});impacts.push(im);}
    }
  }
  function aggregateRelationImpacts(impacts){
    const out={};for(const relation of RELATIONS){const list=impacts.filter(x=>x.relation===relation);out[relation]={requirementIds:uniqSorted(list.flatMap(x=>x.requirementIds||[])),testDefinitions:uniqSorted(list.flatMap(x=>x.testDefinitions||[])),sourceIds:uniqSorted(list.map(x=>x.sourceId)),impactClass:POLICIES[relation].impactClass,requiredAction:POLICIES[relation].requiredAction,assuranceScope:POLICIES[relation].assuranceScope};}return out;
  }
  function buildImpactGraph(input){
    const r=obj(input,'IMPACT_GRAPH_INPUT_REQUIRED','ImpactGraph input'),ctx=buildContext(r.ruleTestRegistry,r.architectureRevision),actual=normalizeActual(r.actualChange,ctx.projectId,ctx.repoIds),facts=(r.changeFacts||[]).map((x,i)=>normalizeFact(x,i,ctx.projectId));
    const impacts=[],fallbacks=[],edges=[];
    if(actual){for(const f of actual.files){const source={kind:'PATH_CHANGE',id:`${actual.id}:${f.path}`,repositoryId:actual.repositoryId,pathEntryId:f.pathEntryId,path:f.path};
      if(f.mappingStatus==='UNMAPPED'){addFallback(ctx,fallbacks,actual.repositoryId,'UNMAPPED_PATH',source.id);continue;}
      if(f.mappingStatus==='CONFIRMATION_REQUIRED'){addFallback(ctx,fallbacks,actual.repositoryId,'RENAME_CONFIRMATION_REQUIRED',source.id);continue;}
      if(f.changeType==='UNKNOWN'){addFallback(ctx,fallbacks,actual.repositoryId,'UNCLASSIFIED_CHANGE',source.id);continue;}
      const bindings=ctx.bindingsByPath.get(f.pathEntryId)||[];if(!bindings.length){addFallback(ctx,fallbacks,actual.repositoryId,'BINDING_MISSING',source.id);continue;}
      for(const b of bindings){const im=relationImpact(ctx,source,b,{changeType:f.changeType,mappingStatus:f.mappingStatus});impacts.push(im);edges.push({from:refKey('PATH_ENTRY',f.pathEntryId),to:refKey('ARCHITECTURE_BINDING',b.id),relation:b.relation});const target=b.targetType==='NODE'?b.architectureNodeId:b.boxInstanceId;edges.push({from:refKey('ARCHITECTURE_BINDING',b.id),to:refKey(b.targetType,target),relation:b.relation});for(const reqId of im.requirementIds)edges.push({from:refKey(b.targetType,target),to:refKey('TEST_REQUIREMENT',reqId),relation:b.relation});}
    }}
    for(const fact of facts)factImpact(ctx,fact,impacts,fallbacks,edges);
    const dedupImpacts=[...new Map(impacts.map(x=>[impactKey(x),x])).values()].sort((a,b)=>impactKey(a).localeCompare(impactKey(b)));
    const dedupEdges=[...new Map(edges.map(x=>[edgeKey(x),x])).values()].sort((a,b)=>edgeKey(a).localeCompare(edgeKey(b)));
    fallbacks.sort((a,b)=>a.repositoryId-b.repositoryId);
    const relationImpacts=aggregateRelationImpacts(dedupImpacts),impactedRequirementIds=uniqSorted(dedupImpacts.flatMap(x=>x.requirementIds||[]));
    const core={type:'ImpactGraph',schemaVersion:SCHEMA_VERSION,projectId:ctx.projectId,architectureRevision:ctx.revision,actualChangeId:actual&&actual.id||null,relationImpacts,impacts:dedupImpacts,edges:dedupEdges,fullTestScopes:fallbacks,requiresFullTest:fallbacks.length>0,impactedRequirementIds,status:fallbacks.length?'TARGETED_WITH_FULL_TEST':(dedupImpacts.length?'TARGETED':'NO_IMPACT')};
    return deepFreeze({...core,impactHash:sha256(core)});
  }
  return deepFreeze({SCHEMA_VERSION,RELATIONS,POLICIES,buildImpactGraph,stableStringify:stable,sha256});
});
