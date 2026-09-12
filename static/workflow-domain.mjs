// TSUGU Workflow: the single domain contract used by UI, import and persistence.
export const SCHEMA = 'tsugu-workflow/1';
export const ROOT = 'data/workflow-projects';
export const STAGES = ['Discovery','Planning','Implementing','Verifying','Completed'];
export const STAGE_LABELS = ['検討','実装準備','実装','確認','完了'];
export const STATUSES = {
  tasks: ['Todo','Doing','Blocked','Done'],
  checks: ['Pending','Passed','Failed','Waived'],
  discussions: ['Open','Pending','Resolved','Archived'],
  decisions: ['Proposed','Approved','Rejected','Superseded'],
  specifications: ['Draft','Review','Approved','Implemented','Verified','Superseded'],
  specification_candidates: ['candidate','approved','rejected','superseded'],
  project_rules: ['Active','Inactive'], system_impacts: ['Open','Resolved']
};
export const COLLECTIONS = ['architecture_nodes','work_boxes','tasks','checks','discussions','decisions','specifications','specification_candidates','system_nodes','system_contracts','system_connections','system_flags','system_events','system_impacts','project_rules','implementation_records','artifacts'];
export const LIFECYCLES = ['Active','Paused','Completed','Superseded','Archived'];
export const WORK_TYPES = ['DEVELOPMENT_ONLY','GAME_DATA','SOURCE_UPDATE'];
const STAGE_STATUS = ['Exploring','Specifying','Implementing','Validating','Completed'];
export const clone = x => structuredClone(x);
export const now = () => new Date().toISOString();
export const id = prefix => `${prefix}-${crypto.randomUUID()}`;
export function assert(ok, message) { if (!ok) throw new Error(message); }
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export async function hash(v) {
  const bytes = new TextEncoder().encode(typeof v === 'string' ? v : canonical(v));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const pending = () => ({status:'Pending',by:'',at:'',content_hash:''});
export function createProject(name) {
  assert(String(name).trim(),'案件名を入力してください');
  const projectId = id('PRJ');
  return {schema_version:SCHEMA,authority:{version:1,instance_id:id('DPI'),canonical_path:`${ROOT}/${projectId}.json`},revision:0,
    workspace:{id:projectId,name:name.trim(),status:'Exploring',ai_attention:'Auto',updated_at:now()},
    project_context:{purpose:'',summary:''},current_focus:{architecture_id:'',work_box_id:'',theme:'',goal:''},
    source_baseline:{repository:'',branch:'',commit_sha:'',source_label:''},
    lifecycle:{status:'Active',superseded_by:'',updated_at:now()},
    workflow:{stage:'Discovery',implementation_approval:pending(),completion_approval:pending()},
    ...Object.fromEntries(COLLECTIONS.map(k=>[k,[]])),history:[]};
}
function obj(x,label) { assert(x && typeof x==='object' && !Array.isArray(x),`${label}: Objectが必要です`); }
function str(x,label,required=true) { assert(typeof x==='string' && (!required || x.trim()),`${label}: 文字列が必要です`); }
function enumValue(x,values,label) { assert(values.includes(x),`${label}: 不正な値 ${String(x)}`); }
function date(x,label) { str(x,label); assert(Number.isFinite(Date.parse(x)),`${label}: 日時が不正です`); }
function refs(rows,key,label) { for(const r of rows) { assert(Array.isArray(r[key]),`${label}.${key}: 配列が必要です`); assert(new Set(r[key]).size===r[key].length,`${label}.${key}: 重複参照`); } }
function dag(rows,edges,label) {
  const map=new Map(rows.map(r=>[r.id,r])), seen=new Set(), visiting=new Set();
  function visit(k) { assert(!visiting.has(k),`${label}: 循環依存 ${k}`); if(seen.has(k))return; assert(map.has(k),`${label}: 参照先が存在しません ${k}`); visiting.add(k); for(const target of edges(map.get(k)))visit(target); visiting.delete(k); seen.add(k); }
  for(const k of map.keys())visit(k);
}
function taskPlan(t) { const {status,approval,created_at,updated_at,...plan}=t; return plan; }
function implementationScope(p) {
  return {context:p.project_context,baseline:p.source_baseline,rules:p.project_rules,architecture:p.architecture_nodes,boxes:p.work_boxes,
    tasks:p.tasks.map(taskPlan),decisions:p.decisions,specifications:p.specifications,systems:p.system_nodes,contracts:p.system_contracts,
    connections:p.system_connections,checks:p.checks.filter(c=>c.gate==='Implementation')};
}
function completionScope(p) { return {implementation:implementationScope(p),tasks:p.tasks,checks:p.checks,artifacts:p.artifacts,implementation_records:p.implementation_records,impacts:p.system_impacts}; }
export async function scopeHash(p,kind) { return hash(kind==='Implementation'?implementationScope(p):completionScope(p)); }
export function resolvedBy(p,c) {
  return p.checks.filter(r=>['Passed','Waived'].includes(r.status) && r.resolves_check_ids.includes(c.id))
    .sort((a,b)=>Date.parse(b.checked_at)-Date.parse(a.checked_at)||a.id.localeCompare(b.id))[0] || null;
}
export function gate(p,kind) {
  const rows=p.checks.filter(c=>c.gate===kind);
  const open=rows.filter(c=>c.status==='Pending'||(c.status==='Failed'&&!resolvedBy(p,c)));
  const failures=p.checks.filter(c=>c.status==='Failed'&&c.required!==false&&!resolvedBy(p,c));
  return {ready:rows.length>0&&open.length===0&&failures.length===0,rows,open,failures};
}
export function boxStatus(p,boxId) {
  const tasks=p.tasks.filter(t=>t.box_id===boxId);
  if(!tasks.length||tasks.every(t=>t.status==='Todo'))return '未着手';
  if(tasks.some(t=>t.status==='Blocked'))return '停止中';
  return tasks.every(t=>t.status==='Done')?'完了':'進行中';
}
export function taskBlockers(p,t) {
  const reasons=[];
  if(p.lifecycle.status!=='Active')reasons.push('案件がActiveではありません');
  if(p.workspace.ai_attention==='Exclude')reasons.push('AI対象外');
  if(!['Todo','Doing'].includes(t.status))reasons.push('TaskがTodo / Doingではありません');
  if(p.workflow.stage!=='Implementing')reasons.push('実装工程ではありません');
  if(!gate(p,'Implementation').ready)reasons.push('実装開始Gateが未成立');
  for(const d of t.depends_on)if(p.tasks.find(x=>x.id===d)?.status!=='Done')reasons.push(`依存未完了: ${d}`);
  if(t.requires_human_approval&&t.approval.status!=='Approved')reasons.push('Task承認待ち');
  return reasons;
}
export function nextTasks(p) { return p.tasks.filter(t=>taskBlockers(p,t).length===0).sort((a,b)=>a.execution_order-b.execution_order||a.id.localeCompare(b.id)); }
export async function validate(p) {
  obj(p,'Project'); assert(p.schema_version===SCHEMA,'未対応の案件形式です。旧TSUGU items / coreは取り込みません');
  assert(!('items'in p)&&!('core'in p),'旧モデルは使用できません');
  obj(p.workspace,'workspace'); str(p.workspace.id,'workspace.id'); assert(/^[A-Za-z0-9._-]+$/.test(p.workspace.id),'案件IDが不正です');
  str(p.workspace.name,'workspace.name'); date(p.workspace.updated_at,'workspace.updated_at');
  enumValue(p.workspace.ai_attention,['Auto','Include','Exclude'],'ai_attention');
  obj(p.authority,'authority'); assert(p.authority.version===1,'authority.versionが不正です');
  assert(/^DPI-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.authority.instance_id),'instance_idが不正です');
  assert(p.authority.canonical_path===`${ROOT}/${p.workspace.id}.json`,'正本パスが一致しません');
  assert(Number.isSafeInteger(p.revision)&&p.revision>=0,'revisionが不正です');
  for(const k of ['project_context','current_focus','source_baseline','lifecycle','workflow'])obj(p[k],k);
  enumValue(p.lifecycle.status,LIFECYCLES,'lifecycle'); date(p.lifecycle.updated_at,'lifecycle.updated_at');
  if(p.lifecycle.status==='Superseded')str(p.lifecycle.superseded_by,'superseded_by');
  const rank=STAGES.indexOf(p.workflow.stage);assert(rank>=0,'工程が不正です');
  assert(p.workspace.status===STAGE_STATUS[rank],'工程と互換状態が一致しません');
  const maps={};
  for(const k of COLLECTIONS) {
    assert(Array.isArray(p[k]),`${k}: 配列が必要です`); maps[k]=new Map();
    for(const row of p[k]) { obj(row,k);str(row.id,`${k}.id`);assert(/^[A-Za-z0-9._-]+$/.test(row.id),`${k}: 不正なID`);assert(!maps[k].has(row.id),`${k}: ID重複 ${row.id}`);maps[k].set(row.id,row);
      if(STATUSES[k])enumValue(row.status,STATUSES[k],`${k}.status`);
      if(['discussions','decisions','specifications','specification_candidates'].includes(k))str(row.title,`${k}.title`);
      for(const f of ['created_at','updated_at'])if(row[f])date(row[f],`${k}.${f}`);
    }
  }
  const ref=(k,v,label,optional=false)=>{if(optional&&!v)return;assert(maps[k].has(v),`${label}: 参照先が存在しません ${v}`);};
  dag(p.architecture_nodes,r=>r.parent_id?[r.parent_id]:[],'Architecture');
  for(const r of p.architecture_nodes)str(r.name,'Architecture.name');
  for(const r of p.work_boxes){str(r.title,'WorkBox.title');ref('architecture_nodes',r.node_id,'WorkBox');}
  refs(p.tasks,'depends_on','Task');dag(p.tasks,r=>r.depends_on,'Task');
  for(const t of p.tasks) {
    ref('work_boxes',t.box_id,'Task.box_id');str(t.title,'Task.title');str(t.acceptance_criteria,'Task.acceptance_criteria');
    assert(Number.isSafeInteger(t.execution_order)&&t.execution_order>=0,'Task.execution_orderは0以上の整数が必要です');
    enumValue(t.work_type,WORK_TYPES,'work_type');assert(typeof t.requires_human_approval==='boolean','requires_human_approvalが不正です');
    obj(t.approval,'Task.approval');enumValue(t.approval.status,['Pending','Approved','Rejected'],'Task.approval.status');
    if(t.approval.status==='Approved'){str(t.approval.by,'Task承認者');date(t.approval.at,'Task承認日時');assert(t.approval.content_hash===await hash(taskPlan(t)),'Task承認対象が変わっています');}
    if(['Doing','Done'].includes(t.status)){assert(t.depends_on.every(d=>maps.tasks.get(d).status==='Done'),'Taskの依存が未完了です');assert(!t.requires_human_approval||t.approval.status==='Approved','Task承認がありません');}
    if(t.status==='Done'){const completionChecks=p.checks.filter(c=>c.target_type==='Task'&&c.target_id===t.id&&c.gate==='Completion');assert(completionChecks.length>0&&completionChecks.every(c=>['Passed','Waived'].includes(c.status)||(c.status==='Failed'&&resolvedBy(p,c))),'完了TaskのCompletion Checkが不足しています');}
    if(t.status==='Done'&&t.work_type!=='DEVELOPMENT_ONLY')assert(p.implementation_records.some(r=>(r.task_ids||[]).includes(t.id)&&r.result==='Applied'),'完了実装Taskの実装記録がありません');
    for(const sid of t.specification_ids||[])ref('specifications',sid,'Task.specification_ids');
  }
  const targets={Project:null,Architecture:'architecture_nodes',WorkBox:'work_boxes',Task:'tasks',Artifact:'artifacts'};
  for(const c of p.checks) {
    str(c.title,'Check.title');enumValue(c.gate,['General','Implementation','Completion'],'Check.gate');
    enumValue(c.target_type,Object.keys(targets),'Check.target_type');
    if(c.target_type==='Project')assert(c.target_id===p.workspace.id,'CheckのProjectが不一致');else ref(targets[c.target_type],c.target_id,'Check.target');
    assert(typeof c.required==='boolean','Check.requiredが不正です');
    assert(Array.isArray(c.resolves_check_ids),'resolves_check_idsが必要です');
    if(c.status!=='Pending'){str(c.result,'Check.result');str(c.evidence,'Check.evidence');str(c.checked_by,'Check.checked_by');date(c.checked_at,'Check.checked_at');}
    for(const rid of c.resolves_check_ids){ref('checks',rid,'解決Check');const old=maps.checks.get(rid);
      assert(old.status==='Failed'&&['Passed','Waived'].includes(c.status),'解決関係はPassed/WaivedからFailedのみ');
      assert(old.target_type===c.target_type&&old.target_id===c.target_id&&old.gate===c.gate,'別対象のFAILは解決できません');
      assert(Date.parse(c.checked_at)>=Date.parse(old.checked_at),'失敗より古いCheckでは解決できません');
    }
    for(const a of c.artifact_ids||[])ref('artifacts',a,'Check.artifact_ids');
  }
  for(const a of p.artifacts){str(a.title,'Artifact.title');str(a.uri,'Artifact.uri');assert(/^[0-9a-f]{64}$/i.test(a.sha256),'Artifact SHA-256が必要です');str(a.version,'Artifact.version');}
  for(const d of p.decisions)for(const r of d.source_discussion_ids||[])ref('discussions',r,'Decision');
  dag(p.specifications,r=>r.depends_on||[],'Specification');
  for(const s of [...p.specifications,...p.specification_candidates]){
    if(s.system_node_id)ref('system_nodes',s.system_node_id,'Specification.system');
    for(const c of s.contract_ids||[])ref('system_contracts',c,'Specification.contract');
    for(const d of s.decision_refs||[])ref('decisions',d,'Specification.decision');
  }
  for(const c of p.specification_candidates){ref('specifications',c.target_specification_id,'Candidate.target');for(const b of c.material_snapshot?.material_ids||[])ref('work_boxes',b,'Candidate.material');}
  for(const c of p.system_contracts){ref('system_nodes',c.producer_system_id,'Contract.producer');for(const r of c.consumer_system_ids||[])ref('system_nodes',r,'Contract.consumer');}
  for(const c of p.system_connections){ref('system_nodes',c.from_system_id,'Connection.from');ref('system_nodes',c.to_system_id,'Connection.to');ref('system_contracts',c.contract_id,'Connection.contract',true);enumValue(c.relation,['PROVIDES','REQUIRES','AFFECTS','IMPLEMENTS'],'Connection.relation');}
  for(const x of p.system_impacts)ref('system_nodes',x.system_node_id,'Impact.system');
  for(const r of p.implementation_records){enumValue(r.result,['Applied','Partial','Reverted'],'Implementation.result');assert(/^[0-9a-f]{40}$/i.test(r.commit_sha),'実装記録には固定commit SHAが必要です');str(r.repository,'Implementation.repository');str(r.evidence,'Implementation.evidence');for(const tid of r.task_ids||[])ref('tasks',tid,'Implementation.task');for(const bid of r.work_box_ids||[])ref('work_boxes',bid,'Implementation.box');}
  ref('architecture_nodes',p.current_focus.architecture_id,'Focus.architecture',true);ref('work_boxes',p.current_focus.work_box_id,'Focus.box',true);
  for(const [kind,key,min] of [['Implementation','implementation_approval',2],['Completion','completion_approval',4]]){
    const a=p.workflow[key];obj(a,key);enumValue(a.status,['Pending','Approved'],key);
    if(a.status==='Approved'){str(a.by,`${key}.by`);date(a.at,`${key}.at`);assert(rank>=min,`${key}: 工程と矛盾`);assert(a.content_hash===await scopeHash(p,kind),`${key}: 承認後に対象が変わっています`);}
    if(rank>=min)assert(a.status==='Approved',`${kind}: 承認が必要です`);
  }
  if(rank>=2)assert(p.tasks.filter(t=>t.status==='Doing').every(t=>t.depends_on.every(d=>maps.tasks.get(d).status==='Done')),'実行中Taskの依存が不正');
  if(rank===4){assert(gate(p,'Completion').ready,'完了Gateが未成立');assert(p.tasks.every(t=>t.status==='Done'),'未完了Taskがあります');assert(p.lifecycle.status==='Completed','完了Lifecycleが不一致');assert(!p.system_impacts.some(i=>i.status==='Open'),'未解決Impactがあります');}
  if(p.lifecycle.status==='Completed')assert(rank===4,'LifecycleだけをCompletedにできません');
  assert(Array.isArray(p.history),'historyが必要です');
  return p;
}
function setStage(p,stage){p.workflow.stage=stage;p.workspace.status=STAGE_STATUS[STAGES.indexOf(stage)];}
function audit(p,actor,message){p.workspace.updated_at=now();p.history.push({id:id('HIS'),at:now(),by:actor.login,message});}
function human(actor){assert(actor?.login&&actor.type==='User'&&actor.canWrite,'GitHubで確認された書込権限のある利用者が必要です');}
async function invalidate(before,p){
  for(const t of p.tasks)if(t.approval.status==='Approved'&&t.approval.content_hash!==await hash(taskPlan(t)))t.approval=pending();
  if(p.workflow.implementation_approval.status==='Approved'&&await scopeHash(before,'Implementation')!==await scopeHash(p,'Implementation')){
    p.workflow.implementation_approval=pending();p.workflow.completion_approval=pending();setStage(p,'Planning');
    // Modified plans must be reviewed before executing again. Completed task evidence remains in history.
    for(const t of p.tasks)if(t.status==='Doing')t.status='Todo';
  }
  if(p.workflow.completion_approval.status==='Approved'&&await scopeHash(before,'Completion')!==await scopeHash(p,'Completion')){
    p.workflow.completion_approval=pending();setStage(p,'Verifying');p.lifecycle.status='Active';p.lifecycle.updated_at=now();
  }
}
export async function upsert(before,collection,record,actor){
  human(actor);assert(COLLECTIONS.includes(collection),'未対応collection');assert(before.lifecycle.status==='Active','Active案件のみ編集できます');assert(before.workflow.stage!=='Completed','完了案件は再開操作が必要です');
  const p=clone(before),old=p[collection].find(r=>r.id===record.id),r=clone(record);
  if(collection==='checks'&&old&&old.status!=='Pending')throw new Error('実施済みCheckは変更・削除できません。再Checkを追加してください');
  if(collection==='artifacts'&&old)throw new Error('成果物の確定版は変更できません。新しいIDを追加してください');
  if(collection==='tasks'){assert(!old||r.status===old.status,'Task状態は専用操作で変更してください');assert(old||r.status==='Todo','新TaskはTodoで登録してください');r.approval=old?clone(old.approval):pending();}
  if(collection==='specification_candidates')assert(r.status==='candidate','仕様候補の承認は専用操作を使ってください');
  if(collection==='checks'&&r.status!=='Pending'&&!old?.checked_at){r.checked_at=now();r.checked_by=actor.login;}
  r.created_at=old?.created_at||r.created_at||now();r.updated_at=now();
  if(old)p[collection][p[collection].indexOf(old)]=r;else p[collection].push(r);
  await invalidate(before,p);audit(p,actor,`${collection}: ${r.id} を${old?'更新':'追加'}`);return validate(p);
}
export async function removeRecord(before,collection,recordId,actor){
  human(actor);assert(COLLECTIONS.includes(collection),'未対応collection');assert(before.lifecycle.status==='Active','Active案件のみ編集できます');
  assert(!['checks','artifacts','implementation_records','system_events'].includes(collection),'証跡は削除できません');
  assert(before.workflow.stage!=='Completed','完了案件は再開操作が必要です');const p=clone(before);
  assert(p[collection].some(r=>r.id===recordId),'削除対象がありません');p[collection]=p[collection].filter(r=>r.id!==recordId);
  await invalidate(before,p);audit(p,actor,`${collection}: ${recordId} を削除`);return validate(p);
}
export async function updateContext(before,changes,actor){human(actor);assert(before.lifecycle.status==='Active','Active案件のみ編集できます');const p=clone(before);for(const k of Object.keys(changes)){assert(['project_context','current_focus','source_baseline'].includes(k),'変更できないfield');p[k]=clone(changes[k]);}await invalidate(before,p);audit(p,actor,'案件情報を更新');return validate(p);}
export async function transition(before,action,actor,detail={}){
  human(actor);await validate(before);const p=clone(before),stage=p.workflow.stage;
  assert(p.lifecycle.status==='Active'||['reopen','resume','archive','supersede'].includes(action),'案件がActiveではありません');
  if(action==='planning'){assert(stage==='Discovery','検討からのみ進めます');setStage(p,'Planning');}
  else if(action==='implementation'){assert(stage==='Planning','実装準備からのみ承認できます');assert(gate(p,'Implementation').ready,'実装開始Gateが未成立');p.workflow.implementation_approval={status:'Approved',by:actor.login,at:now(),content_hash:await scopeHash(p,'Implementation')};setStage(p,'Implementing');}
  else if(action==='verifying'){assert(stage==='Implementing','実装からのみ進めます');setStage(p,'Verifying');}
  else if(action==='completion'){assert(stage==='Verifying','確認工程からのみ承認できます');assert(gate(p,'Completion').ready,'完了Gateが未成立');assert(p.tasks.every(t=>t.status==='Done'),'未完了Taskがあります');p.workflow.completion_approval={status:'Approved',by:actor.login,at:now(),content_hash:await scopeHash(p,'Completion')};setStage(p,'Completed');p.lifecycle.status='Completed';}
  else if(action==='back'){assert(STAGES.indexOf(stage)>0&&stage!=='Completed','戻せる工程ではありません');setStage(p,STAGES[STAGES.indexOf(stage)-1]);p.workflow.completion_approval=pending();if(STAGES.indexOf(p.workflow.stage)<2)p.workflow.implementation_approval=pending();}
  else if(action==='reopen'){assert(stage==='Completed','完了案件ではありません');setStage(p,'Verifying');p.workflow.completion_approval=pending();p.lifecycle.status='Active';}
  else if(action==='pause'){assert(stage!=='Completed','完了案件は保留できません');p.lifecycle.status='Paused';}
  else if(action==='resume'){assert(p.lifecycle.status==='Paused','保留案件ではありません');p.lifecycle.status='Active';}
  else if(action==='archive'){assert(stage!=='Completed','完了状態は維持してください');p.lifecycle.status='Archived';}
  else if(action==='supersede'){str(detail.superseded_by,'置換先案件ID');assert(detail.superseded_by!==p.workspace.id,'自分自身へ置換できません');assert(stage!=='Completed','完了状態は維持してください');p.lifecycle.status='Superseded';p.lifecycle.superseded_by=detail.superseded_by;}
  else throw new Error('未対応操作');
  p.lifecycle.updated_at=now();audit(p,actor,`工程操作: ${action}`);return validate(p);
}
export async function approveTask(before,taskId,actor){human(actor);const p=clone(before);assert(p.lifecycle.status==='Active','Active案件のみ承認できます');const t=p.tasks.find(t=>t.id===taskId);assert(t,'Taskがありません');t.approval={status:'Approved',by:actor.login,at:now(),content_hash:await hash(taskPlan(t))};audit(p,actor,`Task承認: ${taskId}`);return validate(p);}
export async function changeTaskStatus(before,taskId,status,actor){
  human(actor);const p=clone(before),t=p.tasks.find(t=>t.id===taskId);assert(t,'Taskがありません');enumValue(status,STATUSES.tasks,'Task.status');
  assert(p.lifecycle.status==='Active','Active案件のみ操作できます');
  if(status==='Doing'){const reasons=taskBlockers(p,t);assert(!reasons.length,reasons.join(' / '));}
  if(status==='Done'){assert(t.status==='Doing','Doingから完了してください');assert(gate(p,'Implementation').ready,'未解決の必須FAILがあります');assert(['Implementing','Verifying'].includes(p.workflow.stage),'実装・確認工程で完了してください');const checks=p.checks.filter(c=>c.target_type==='Task'&&c.target_id===taskId&&c.gate==='Completion');assert(checks.length>0&&checks.every(c=>['Passed','Waived'].includes(c.status)||(c.status==='Failed'&&resolvedBy(p,c))),'Taskの完了Checkが未成立');}
  if(status==='Done'&&t.work_type!=='DEVELOPMENT_ONLY'){assert(p.implementation_records.some(r=>(r.task_ids||[]).includes(t.id)&&r.result==='Applied'),'実装TaskにはAppliedの実装記録と固定commitが必要です');}
  assert(t.status!=='Done','完了Taskは変更せず修正Taskを追加してください');t.status=status;t.updated_at=now();audit(p,actor,`Task状態: ${taskId} → ${status}`);return validate(p);
}
// AI returns complete records, not partial record patches. Merge first, then validate references.
export async function mergeReturn(before,input,actor){
  human(actor);assert(before.lifecycle.status==='Active','Active案件のみ統合できます');assert(input.project_id===before.workspace.id&&input.instance_id===before.authority.instance_id,'案件identityが不一致');assert(input.base_revision===before.revision,'古いbase_revisionです');
  const p=clone(before);assert(Object.keys(input).every(k=>['project_id','instance_id','base_revision','summary','upserts'].includes(k)),'AI返却に許可されていないfieldがあります');assert(Array.isArray(input.upserts),'upsertsが必要です');
  const seen=new Set();for(const item of input.upserts){const {collection,record}=item;assert(COLLECTIONS.includes(collection),'未対応collection');const key=collection+':'+record?.id;assert(!seen.has(key),'統合内ID重複');seen.add(key);const r=clone(record),old=p[collection].find(x=>x.id===r.id);
    if(collection==='tasks'){assert(!('approval'in r),'AI返却でapprovalは変更できません');r.approval=old?clone(old.approval):pending();assert(!old||r.status===old.status,'Task状態は専用操作で変更してください');assert(old||r.status==='Todo','新TaskはTodoで登録してください');}
    if(collection==='checks'){assert(r.status!=='Waived','AIはCheckを免除できません');assert(!old||old.status==='Pending','実施済みCheckは変更できません');r.checked_by=r.status==='Pending'?'':'AI (JSON import)';}
    if(collection==='artifacts')assert(!old,'成果物の確定版は変更できません');
    if(collection==='decisions')assert(r.status!=='Approved'&&(!old||old.status!=='Approved'),'AIはDecision承認を変更できません');
    if(collection==='specifications')assert(!['Approved','Implemented','Verified'].includes(r.status),'AIは正式仕様の承認を変更できません');
    if(collection==='specification_candidates')assert(r.status==='candidate','AIは候補を承認できません');
    if(old)p[collection][p[collection].indexOf(old)]=r;else p[collection].push(r);
  }
  await invalidate(before,p);audit(p,actor,`AI返却統合: ${String(input.summary||'')} / ${input.upserts.length}件`);return validate(p);
}
export async function assertSave(previous,p){
  await validate(p);if(!previous){assert(p.revision===0,'新規案件のrevisionが不正');return;}
  assert(previous.workspace.id===p.workspace.id&&previous.authority.instance_id===p.authority.instance_id,'保存先のidentityが不一致');
  assert(previous.revision===p.revision,'案件revisionが競合しています');
  for(const c of previous.checks.filter(c=>c.status!=='Pending'))assert(canonical(p.checks.find(x=>x.id===c.id))===canonical(c),'実施済みCheckが変更・削除されています');
  for(const a of previous.artifacts)assert(canonical(p.artifacts.find(x=>x.id===a.id))===canonical(a),'確定成果物が変更・削除されています');
  assert(previous.history.every((h,i)=>canonical(h)===canonical(p.history[i])),'履歴を巻き戻せません');
}
export function recordTemplate(collection,p){
  const r={id:id(collection.slice(0,4).toUpperCase()),title:'',created_at:now(),updated_at:now()};
  const templates={
    architecture_nodes:{id:r.id,name:'',parent_id:'',created_at:r.created_at,updated_at:r.updated_at},
    work_boxes:{...r,node_id:p.architecture_nodes[0]?.id||'',body:''},
    tasks:{...r,box_id:p.work_boxes[0]?.id||'',status:'Todo',execution_order:p.tasks.length+1,depends_on:[],acceptance_criteria:'',work_type:'DEVELOPMENT_ONLY',requires_human_approval:false,approval:pending(),specification_ids:[]},
    checks:{...r,gate:'General',target_type:'Project',target_id:p.workspace.id,status:'Pending',required:true,result:'',evidence:'',checked_by:'',checked_at:'',resolves_check_ids:[],artifact_ids:[]},
    discussions:{...r,status:'Open',summary:'',body:'',open_questions:'',conclusion:'',related_discussion_ids:[]},
    decisions:{...r,status:'Proposed',text:'',rationale:'',source_discussion_ids:[]},
    specifications:{...r,status:'Draft',body:'',summary:'',decision_refs:[],depends_on:[],acceptance_criteria:'',system_node_id:'',contract_ids:[],revision:1},
    specification_candidates:{...r,status:'candidate',target_specification_id:p.specifications[0]?.id||'',body:'',material_snapshot:{material_ids:[],decision_ids:[],snapshot_hash:''},base_specification_hash:''},
    system_nodes:{id:r.id,name:'',description:''},system_contracts:{...r,name:'',producer_system_id:'',consumer_system_ids:[],definition:''},
    system_connections:{...r,from_system_id:'',to_system_id:'',relation:'PROVIDES',contract_id:'',purpose:''},
    system_flags:{...r,scope_type:'Project',scope_id:p.workspace.id,value:''},system_events:{...r,target_type:'Project',target_id:p.workspace.id,event_type:'',at:now()},
    system_impacts:{...r,system_node_id:'',status:'Open',summary:''},project_rules:{...r,text:'',status:'Active',source_type:'Human',source_id:''},
    implementation_records:{...r,task_ids:[],work_box_ids:[],repository:'',commit_sha:'',result:'Applied',evidence:'',recorded_at:now()},
    artifacts:{...r,uri:'',version:'1',sha256:''}
  };return templates[collection];
}
async function candidateMaterials(p,c){
  const ms=c.material_snapshot;obj(ms,'素材snapshot');assert(Array.isArray(ms.material_ids)&&ms.material_ids.length>0,'素材WorkBoxを1件以上指定してください');
  const materials=ms.material_ids.map(id=>{const b=p.work_boxes.find(b=>b.id===id);assert(b,'素材WorkBoxがありません');return b;});
  const decisions=(ms.decision_ids||[]).map(id=>{const d=p.decisions.find(d=>d.id===id);assert(d?.status==='Approved','素材Decisionが未承認です');return d;});
  return hash({materials,decisions});
}
export async function captureCandidate(before,candidateId,actor){
  human(actor);assert(before.lifecycle.status==='Active','Active案件のみ編集できます');const p=clone(before),c=p.specification_candidates.find(x=>x.id===candidateId);assert(c?.status==='candidate','候補がありません');
  const spec=p.specifications.find(x=>x.id===c.target_specification_id);assert(spec,'対象仕様がありません');
  c.material_snapshot.snapshot_hash=await candidateMaterials(p,c);c.base_specification_hash=await hash(spec);c.updated_at=now();audit(p,actor,`仕様候補の素材固定: ${c.id}`);return validate(p);
}
export async function promoteCandidate(before,candidateId,actor){
  human(actor);assert(before.lifecycle.status==='Active','Active案件のみ承認できます');const p=clone(before),c=p.specification_candidates.find(x=>x.id===candidateId);assert(c?.status==='candidate','候補がありません');
  const spec=p.specifications.find(x=>x.id===c.target_specification_id);assert(spec,'対象仕様がありません');str(c.body,'候補本文');
  assert(c.material_snapshot.snapshot_hash===await candidateMaterials(p,c),'素材が変わっています。再整理してください');assert(c.base_specification_hash===await hash(spec),'正式仕様が変わっています');
  assert(!p.system_impacts.some(i=>i.status==='Open'&&(!c.system_node_id||i.system_node_id===c.system_node_id)),'未解決の変更影響があります');
  for(const k of ['title','body','summary','acceptance_criteria','system_node_id','contract_ids','depends_on'])if(k in c)spec[k]=clone(c[k]);
  spec.status='Approved';spec.revision++;spec.source_candidate_id=c.id;spec.decision_refs=clone(c.material_snapshot.decision_ids||[]);spec.approved_by=actor.login;spec.approved_at=now();spec.updated_at=now();
  c.status='approved';c.approved_by=actor.login;c.approved_at=now();await invalidate(before,p);audit(p,actor,`仕様候補を正式承認: ${c.id}`);return validate(p);
}
