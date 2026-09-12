import {addChangeItem,artifactByKey,byId,createChangeSet,runValidation} from './core.mjs';

const now=()=>new Date().toISOString();
const uid=()=>globalThis.crypto?.randomUUID?.()||`id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const clone=x=>structuredClone(x);

export const AI_ROLES=['idea_structurer','requirement_extractor','requirement_reviewer','specification_builder','missing_case_detector','conflict_detector','domain_extractor','architecture_advisor','dependency_analyzer','interface_generator','task_planner','impact_analyzer','readiness_reviewer'];
export const KNOWLEDGE_STATES=['known','assumed','proposed','undefined'];

export function ensureAIStore(project){
  project.aiRequests=project.aiRequests||[];
  project.aiCandidates=project.aiCandidates||[];
  project.aiPolicy=project.aiPolicy||{enabled:true,allowedProviders:['local-demo'],sensitiveDataTransmissionAllowed:false,retention:'project'};
  return project;
}

export function buildAIContext(project,targetArtifactId,{maxRelated=24}={}){
  ensureAIStore(project);
  const map=byId(project),target=targetArtifactId?map.get(targetArtifactId):null;
  const relations=project.relations.filter(r=>r.status!=='deprecated'&&(!target||r.fromArtifactId===target.id||r.toArtifactId===target.id)).slice(0,maxRelated);
  const relatedIds=new Set(relations.flatMap(r=>[r.fromArtifactId,r.toArtifactId]));
  if(target)relatedIds.add(target.id);
  const related=[...relatedIds].map(id=>map.get(id)).filter(Boolean);
  const sources=related.filter(a=>a.type==='source');
  const domains=related.filter(a=>a.type==='domain');
  const questions=related.filter(a=>a.type==='question'&&!a.payload?.answer);
  const decisions=related.filter(a=>a.type==='decision');
  const issues=runValidation(project).filter(i=>!target||i.artifactIds.includes(target.id)||i.artifactIds.some(id=>relatedIds.has(id)));
  return {project:{id:project.id,name:project.name,revision:project.revision},target:target?clone(target):null,relations:clone(relations),sources:clone(sources),domains:clone(domains),openQuestions:clone(questions),decisions:clone(decisions),validationIssues:clone(issues)};
}

function normalizeCandidate(project,raw,request){
  const operation=raw.operation||'update';
  if(!['create','update','relation','question','validation'].includes(operation))throw new Error(`Unsupported AI candidate operation: ${operation}`);
  const confidence=Math.max(0,Math.min(1,Number(raw.confidence??0)));
  const knowledgeState=raw.knowledgeState||raw.proposedPayload?.knowledgeState||'proposed';
  if(!KNOWLEDGE_STATES.includes(knowledgeState))throw new Error(`Invalid knowledgeState: ${knowledgeState}`);
  if(knowledgeState==='known'&&!raw.sourceRefs?.length&&!raw.provenance?.sourceArtifactIds?.length)throw new Error('Known AI claim requires source evidence');
  return {
    id:uid(),projectId:project.id,requestId:request.id,operation,
    targetArtifactId:raw.targetArtifactId||request.targetArtifactId||null,
    proposedType:raw.proposedType||null,
    proposedPayload:clone(raw.proposedPayload??raw.payload??{}),
    proposedTitle:raw.proposedTitle||null,
    proposedKey:raw.proposedKey||null,
    relation:raw.relation?clone(raw.relation):null,
    knowledgeState,confidence,status:'pending',
    provenance:{provider:request.provider,model:request.model,promptTemplateVersion:request.promptTemplateVersion,schemaVersion:request.schemaVersion,sourceArtifactIds:raw.sourceRefs||raw.provenance?.sourceArtifactIds||[],...clone(raw.provenance||{})},
    createdAt:now(),resolvedAt:null
  };
}

export async function requestAICandidates(project,{role,targetArtifactId=null,input='',provider,providerName='local-demo',model='deterministic-demo',promptTemplateVersion='1',schemaVersion='1',actorUserId='local-user'}={}){
  ensureAIStore(project);
  if(!project.aiPolicy.enabled)throw new Error('AI is disabled for this project');
  if(!AI_ROLES.includes(role))throw new Error(`Unsupported AI role: ${role}`);
  if(!project.aiPolicy.allowedProviders.includes(providerName))throw new Error(`AI provider not allowed: ${providerName}`);
  if(!provider?.generateStructured)throw new Error('AI provider adapter must implement generateStructured');
  const request={id:uid(),projectId:project.id,role,targetArtifactId,input,provider:providerName,model,promptTemplateVersion,schemaVersion,actorUserId,status:'running',createdAt:now(),completedAt:null,metadata:{}};
  project.aiRequests.push(request);
  const context=buildAIContext(project,targetArtifactId);
  const started=Date.now();
  const result=await provider.generateStructured({role,input,context,schemaVersion});
  const raws=Array.isArray(result?.candidates)?result.candidates:[];
  const candidates=raws.map(raw=>normalizeCandidate(project,raw,request));
  project.aiCandidates.push(...candidates);
  request.status='completed';request.completedAt=now();request.metadata={latencyMs:Date.now()-started,tokenUsage:result?.tokenUsage||null,candidateCount:candidates.length};
  return {request,candidates,questions:clone(result?.questions||[]),context};
}

export function acceptAICandidate(project,candidateId,{actorUserId='local-user',editedPayload=null}={}){
  ensureAIStore(project);
  const c=project.aiCandidates.find(x=>x.id===candidateId);
  if(!c)throw new Error('AI candidate not found');
  if(c.status!=='pending'&&c.status!=='edited')throw new Error('AI candidate is already resolved');
  let cs=project.changeSets?.find(x=>x.status==='open'&&x.actorUserId===actorUserId);
  if(!cs)cs=createChangeSet(project,'AI candidate review',actorUserId);
  const payload=clone(editedPayload??c.proposedPayload);
  if(c.operation==='update'){
    const target=project.artifacts.find(a=>a.id===c.targetArtifactId);
    if(!target)throw new Error('AI candidate target artifact not found');
    addChangeItem(cs,{kind:'update_artifact',artifactId:target.id,expectedRevision:target.revision||1,previousStatus:target.status,patch:payload});
  }else if(c.operation==='create'||c.operation==='question'){
    const type=c.operation==='question'?'question':c.proposedType;
    if(!type)throw new Error('AI create candidate requires proposedType');
    const key=c.proposedKey||`AI-${type.toUpperCase()}-${String(project.artifacts.length+1).padStart(3,'0')}`;
    if(artifactByKey(project,key))throw new Error(`Artifact key already exists: ${key}`);
    const t=now(),id=uid();
    addChangeItem(cs,{kind:'create_artifact',artifact:{id,projectId:project.id,key,type,title:c.proposedTitle||payload.title||key,description:payload.description||payload.statement||'',status:'draft',knowledgeState:c.knowledgeState==='known'?'known':'proposed',version:1,revision:1,currentVersionId:`${id}-v1`,tags:[],sourceIds:c.provenance.sourceArtifactIds||[],metadata:{aiCandidateId:c.id},payload,createdAt:t,updatedAt:t}});
  }else if(c.operation==='relation'){
    if(!c.relation)throw new Error('AI relation candidate requires relation');
    addChangeItem(cs,{kind:'create_relation',relation:{id:uid(),projectId:project.id,status:'active',source:'ai',confidence:c.confidence,createdAt:now(),updatedAt:now(),...clone(c.relation)}});
  }else if(c.operation==='validation'){
    addChangeItem(cs,{kind:'update_artifact',artifactId:c.targetArtifactId,patch:payload});
  }
  c.status=editedPayload?'edited':'accepted';c.resolvedAt=now();c.resolvedBy=actorUserId;c.changeSetId=cs.id;
  return {candidate:c,changeSet:cs};
}

export function rejectAICandidate(project,candidateId,{actorUserId='local-user',reason=''}={}){
  ensureAIStore(project);
  const c=project.aiCandidates.find(x=>x.id===candidateId);
  if(!c)throw new Error('AI candidate not found');
  if(c.status!=='pending'&&c.status!=='edited')throw new Error('AI candidate is already resolved');
  c.status='rejected';c.resolvedAt=now();c.resolvedBy=actorUserId;c.rejectionReason=reason;
  return c;
}

export function createLocalDemoProvider(){
  return {name:'local-demo',async generateStructured({role,context}){
    const target=context.target;
    if(role==='requirement_reviewer'&&target?.type==='requirement')return {candidates:[{operation:'update',targetArtifactId:target.id,confidence:.92,knowledgeState:'proposed',proposedPayload:{payload:{...target.payload,reviewNote:'AI candidate: acceptance criteria and source traceability reviewed'}},provenance:{sourceArtifactIds:target.sourceIds||[]}}],questions:[]};
    if(role==='task_planner')return {candidates:[{operation:'create',proposedType:'task',proposedKey:'TASK-AI-001',proposedTitle:'AI Proposed Implementation Task',confidence:.78,knowledgeState:'proposed',proposedPayload:{objective:'Review and implement the selected design slice',testConditions:['Validation passes'],definitionOfDone:['Human review completed']}}],questions:[]};
    return {candidates:[],questions:[{text:'No deterministic demo candidate for this role/context.'}]};
  }};
}
