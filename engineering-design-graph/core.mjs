export const ARTIFACT_TYPES = ['requirement','specification','domain','system','module','interface','task','decision','question','source'];
export const RELATION_TYPES = ['refines','uses','owns','decomposed_to','exposes','implements','depends_on','references','conflicts_with','supersedes','derived_from','affected_by'];

export const relationRegistry = {
  refines: { from:['requirement'], to:['specification'], impactWeight:1 },
  uses: { from:['specification','module','system'], to:['domain','interface'], impactWeight:.7 },
  owns: { from:['system'], to:['domain'], impactWeight:.8 },
  decomposed_to: { from:['system'], to:['module'], impactWeight:.9 },
  exposes: { from:['module'], to:['interface'], impactWeight:.9 },
  implements: { from:['task'], to:['module','interface'], impactWeight:1 },
  depends_on: { from:['system','module','task'], to:['system','module','task'], impactWeight:.9, acyclic:true },
  references: { from:ARTIFACT_TYPES, to:ARTIFACT_TYPES, impactWeight:.3 },
  conflicts_with: { from:ARTIFACT_TYPES, to:ARTIFACT_TYPES, impactWeight:1 },
  supersedes: { from:ARTIFACT_TYPES, to:ARTIFACT_TYPES, impactWeight:.8, acyclic:true },
  derived_from: { from:ARTIFACT_TYPES, to:ARTIFACT_TYPES, impactWeight:.6 },
  affected_by: { from:ARTIFACT_TYPES, to:ARTIFACT_TYPES, impactWeight:.8 }
};

export function byId(project){ return new Map(project.artifacts.map(a=>[a.id,a])); }
export function artifactByKey(project,key){ return project.artifacts.find(a=>a.key===key); }

export function validateRelation(project, relation){
  const map=byId(project), from=map.get(relation.fromArtifactId), to=map.get(relation.toArtifactId), def=relationRegistry[relation.type];
  if(!from || !to) return {ok:false,error:'Relation endpoint does not exist'};
  if(!def) return {ok:false,error:'Unknown relation type'};
  if(!def.from.includes(from.type) || !def.to.includes(to.type)) return {ok:false,error:`${relation.type} does not allow ${from.type} -> ${to.type}`};
  if(from.id===to.id) return {ok:false,error:'Self relation is not allowed'};
  return {ok:true};
}

export function detectCycles(project, type='depends_on'){
  const edges=project.relations.filter(r=>r.type===type && r.status!=='deprecated');
  const adj=new Map(); for(const e of edges){ if(!adj.has(e.fromArtifactId)) adj.set(e.fromArtifactId,[]); adj.get(e.fromArtifactId).push(e.toArtifactId); }
  const visiting=new Set(), visited=new Set(), stack=[], cycles=[];
  function dfs(id){
    if(visiting.has(id)){ const i=stack.indexOf(id); cycles.push([...stack.slice(i),id]); return; }
    if(visited.has(id)) return;
    visiting.add(id); stack.push(id); for(const n of adj.get(id)||[]) dfs(n); stack.pop(); visiting.delete(id); visited.add(id);
  }
  for(const id of adj.keys()) dfs(id); return cycles;
}

export function trace(project, rootId, direction='downstream', maxDepth=8){
  const rels=project.relations.filter(r=>r.status!=='deprecated'), result=[], seen=new Set([rootId]), q=[{id:rootId,depth:0}];
  while(q.length){ const cur=q.shift(); if(cur.depth>=maxDepth) continue; for(const r of rels){
    const next=direction==='downstream' ? (r.fromArtifactId===cur.id?r.toArtifactId:null) : (r.toArtifactId===cur.id?r.fromArtifactId:null);
    if(next && !seen.has(next)){ seen.add(next); result.push({artifactId:next,relation:r,depth:cur.depth+1}); q.push({id:next,depth:cur.depth+1}); }
  }} return result;
}

export function requirementCoverage(project, req){
  // Coverage follows semantic traceability, including inverse UI labels such as
  // Module <-implements- Task. Canonical relation storage direction is preserved.
  const rels=project.relations.filter(r=>r.status!=='deprecated');
  const reach=new Set([req.id]), q=[req.id];
  while(q.length){
    const id=q.shift();
    for(const r of rels){
      const next=r.fromArtifactId===id?r.toArtifactId:(r.toArtifactId===id?r.fromArtifactId:null);
      if(next && !reach.has(next)){ reach.add(next); q.push(next); }
    }
  }
  reach.delete(req.id);
  const arts=project.artifacts.filter(a=>reach.has(a.id));
  const hasSpec=arts.some(a=>a.type==='specification');
  const hasArch=arts.some(a=>a.type==='system'||a.type==='module');
  const hasTask=arts.some(a=>a.type==='task');
  const externallyObservable=arts.some(a=>a.type==='interface');
  const checks=[hasSpec,hasArch,hasTask];
  if(externallyObservable) checks.push(true);
  return {score:Math.round(checks.filter(Boolean).length/checks.length*100),hasSpec,hasArch,hasTask,hasInterface:externallyObservable};
}

export function runValidation(project){
  const issues=[]; const rels=project.relations.filter(r=>r.status!=='deprecated');
  const add=(ruleId,severity,artifactIds,title,message)=>issues.push({id:`${ruleId}:${artifactIds.join(',')}`,ruleId,severity,artifactIds,title,message,status:'open'});
  for(const a of project.artifacts){
    if(a.type==='requirement'){
      if(a.payload?.priority==='must' && !(a.payload?.acceptanceCriteria?.length)) add('VAL-REQ-001','error',[a.id],'Must requirement has no acceptance criteria','Add at least one acceptance criterion.');
      if(!(a.sourceIds?.length)) add('VAL-REQ-002','warning',[a.id],'Requirement has no source','Attach at least one source.');
    }
    if(a.type==='specification' && !rels.some(r=>r.type==='refines'&&r.toArtifactId===a.id)) add('VAL-SPEC-001','error',[a.id],'Orphan specification','Map the specification from a requirement.');
    if(a.type==='module'){
      if(!a.payload?.responsibility?.trim()) add('VAL-MOD-001','error',[a.id],'Module responsibility is empty','Define a focused responsibility.');
      if(!(a.payload?.mustNot?.length)) add('VAL-MOD-002','warning',[a.id],'Module has no must-not boundary','Add non-responsibilities to prevent scope growth.');
    }
    if(a.type==='interface'){
      if(!a.payload?.inputSchema || !a.payload?.outputSchema) add('VAL-IF-001','error',[a.id],'Interface schema missing','Define both input and output schemas.');
      if(a.payload?.direction==='inbound' && !(a.payload?.errorSchemas?.length)) add('VAL-IF-002','error',[a.id],'Inbound interface has no error contract','Define expected error contracts.');
    }
    if(a.type==='task'){
      if(!rels.some(r=>r.type==='implements'&&r.fromArtifactId===a.id)) add('VAL-TASK-001','error',[a.id],'Task implements nothing','Link the task to a module or interface.');
      if(!(a.payload?.testConditions?.length)) add('VAL-TASK-002','error',[a.id],'Task has no test conditions','Add executable test conditions.');
    }
    if(a.type==='question' && a.payload?.blocking && !a.payload?.answer) add('VAL-Q-001','critical',[a.id],'Blocking question unresolved',a.payload.question||'Resolve this question before implementation.');
  }
  for(const cycle of detectCycles(project,'depends_on')) add('VAL-DEP-001','critical',cycle.slice(0,-1),'Dependency cycle detected','Break the dependency cycle or document an approved exception.');
  for(const r of rels){ const vr=validateRelation(project,r); if(!vr.ok) add('VAL-REL-001','error',[r.fromArtifactId,r.toArtifactId],'Invalid relation',vr.error); }
  return issues;
}

export function readiness(project){
  const issues=runValidation(project); const blocking=[]; const reqs=project.artifacts.filter(a=>a.type==='requirement'&&a.payload?.priority==='must');
  if(reqs.some(r=>requirementCoverage(project,r).score<100)) blocking.push('Must Requirement coverage must be 100%');
  if(project.artifacts.some(a=>['specification','domain','system','module','interface'].includes(a.type)&&a.status!=='approved')) blocking.push('Implementation artifacts must be approved');
  if(project.artifacts.some(a=>a.type==='question'&&a.payload?.blocking&&!a.payload?.answer)) blocking.push('Blocking questions must be resolved');
  if(issues.some(i=>i.severity==='critical')) blocking.push('Critical validation issues must be zero');
  if(project.artifacts.filter(a=>a.type==='task').some(a=>!(a.payload?.testConditions?.length))) blocking.push('Tasks must have test conditions');
  const warningCount=issues.filter(i=>i.severity==='warning').length;
  const unique=[...new Set(blocking)]; const total=5; const score=Math.round((total-Math.min(total,unique.length))/total*100);
  return {status:unique.length?'NOT_READY':warningCount?'READY_WITH_WARNINGS':'READY',score,blocking:unique,issues};
}

export function impact(project, artifactId){
  return trace(project,artifactId,'downstream').map(x=>({artifact:byId(project).get(x.artifactId),relationType:x.relation.type,depth:x.depth,weight:relationRegistry[x.relation.type]?.impactWeight??.5}));
}

export function makeSampleProject(){
  const now=new Date().toISOString(); const A=(id,key,type,title,status,payload={},extra={})=>({id,projectId:'p1',key,type,title,status,knowledgeState:'known',version:1,currentVersionId:`${id}-v1`,tags:[],sourceIds:extra.sourceIds||[],metadata:{},createdAt:now,updatedAt:now,payload});
  const artifacts=[
    A('req1','REQ-ORDER-001','requirement','注文を作成できる','approved',{priority:'must',statement:'認証済みユーザーはカート内の商品から注文を作成できる',acceptanceCriteria:['空のカートでは注文できない','在庫不足の商品が存在する場合は失敗する','成功時に注文IDが生成される','注文作成後にカートが確定状態になる']},{sourceIds:['src1']}),
    A('spec1','SPEC-ORDER-CREATE-001','specification','注文作成仕様','approved',{preconditions:['user authenticated','cart belongs to user'],processingRules:['validate cart non-empty','validate inventory','calculate price','create order'],failureCases:['CART_EMPTY','INVENTORY_SHORTAGE','INVALID_PAYMENT_METHOD'],outputs:['orderId','status','totalAmount']}),
    A('dom1','DOMAIN-ORDER','domain','Order Domain','approved',{kind:'aggregate',definition:'Order lifecycle and invariants',invariants:['totalAmount >= 0','at least one OrderItem']}),
    A('sys1','SYS-ORDER','system','Order System','approved',{responsibility:'Order lifecycle and consistency'}),
    A('mod1','MOD-ORDER-VALIDATOR','module','Order Validator','approved',{responsibility:'validate business conditions before order creation',mustNot:['calculate prices','write DB','execute payment']}),
    A('if1','IF-ORDER-CREATE-001','interface','POST /orders','approved',{kind:'http',direction:'inbound',operation:'POST',endpoint:'/orders',inputSchema:{cartId:'string',paymentMethodId:'string'},outputSchema:{orderId:'string',status:'string',totalAmount:'integer'},errorSchemas:['CART_EMPTY','INVENTORY_SHORTAGE','INVALID_PAYMENT_METHOD'],idempotency:{strategy:'Idempotency-Key'}}),
    A('task1','TASK-ORDER-014','task','Implement OrderValidator','draft',{objective:'Implement OrderValidator',testConditions:['Empty cart','Inventory shortage','Invalid quantity','Valid order'],definitionOfDone:['Unit tests pass','No unresolved design question','Interface contract satisfied']}),
    A('src1','SRC-ORDER-001','source','Order workshop notes','approved',{kind:'user_input',excerpt:'Authenticated users create orders from carts.'})
  ];
  const R=(id,from,to,type)=>({id,projectId:'p1',fromArtifactId:from,toArtifactId:to,type,status:'active',source:'human',createdAt:now,updatedAt:now});
  const relations=[R('r1','req1','spec1','refines'),R('r2','spec1','dom1','uses'),R('r3','sys1','dom1','owns'),R('r4','sys1','mod1','decomposed_to'),R('r5','mod1','if1','exposes'),R('r6','task1','mod1','implements'),R('r7','spec1','sys1','references')];
  return {id:'p1',name:'EC Order Creation',artifacts,relations,changes:[]};
}
