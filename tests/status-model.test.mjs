import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

async function loadSource(file,plugins=[]){
  const result=await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',write:false,plugins});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const model=await loadSource('app/model.ts');
const {prepareImport}=await loadSource('app/import-project.ts');
const {auditImportedStatuses}=await loadSource('app/status-audit.ts');
const {resolveApprovals,reopenForActiveWork}=await loadSource('app/approvals.ts');
const {parseBulkWork,bulkWorkHeader}=await loadSource('app/bulk-work.ts');
const legacy=(status)=>({workspace:{id:'LEGACY-1',name:'状態検証'},decisions:[{id:'D-1',title:'判断',status,text:'本文',rationale:'根拠'}]});

test('Decision source states retain their meaning',()=>{
  for(const [input,expected] of Object.entries({Proposed:'提案中',Draft:'提案中',Pending:'提案中',Rejected:'却下',Approved:'確定',Accepted:'確定',Superseded:'廃止',Deprecated:'廃止'})){
    const {project}=prepareImport(legacy(input));
    assert.equal(project.items[0].status,expected,input);
    assert.equal(project.sourceInfo.warnings.length,0);
  }
});
test('unknown and missing decisions require review and preserve an explanatory warning',()=>{
  for(const value of ['CustomState','toString',undefined]){
    const input=legacy(value),text=JSON.stringify(input),result=prepareImport(input,text);
    assert.equal(result.project.items[0].status,'要確認');
    assert.match(result.project.sourceInfo.warnings[0],/決定.*D-1.*要確認/);
    if(value)assert.ok(result.project.sourceInfo.warnings[0].includes(value));
    assert.equal(result.originalText,text);
  }
});
test('every kind/status pair follows the single definition',()=>{
  const statuses=[...new Set(Object.values(model.statusByKind).flat())];
  for(const kind of model.kinds)for(const status of statuses){
    const item={id:'item',kind,status,title:'項目',body:'',reason:'',parentId:''};
    assert.equal(model.itemSchema.safeParse(item).success,model.statusByKind[kind].includes(status),`${kind}/${status}`);
  }
});
test('foreign-kind legacy statuses do not cross-map to successful states',()=>{
  const result=prepareImport({workspace:{id:'L'},discussions:[{id:'d',title:'議論',status:'Passed'}],checks:[{id:'c',title:'検証',status:'Approved'}]});
  assert.deepEqual(result.project.items.map(i=>i.status),['要確認','要確認']);
  assert.equal(result.project.sourceInfo.warnings.length,2);
});
test('stateless architecture and work boxes retain supported defaults and links',()=>{
  const p=prepareImport({workspace:{id:'L'},architecture_nodes:[{id:'a',name:'構成'}],work_boxes:[{id:'b',title:'作業箱',node_id:'a'}],tasks:[{id:'t',title:'タスク',box_id:'b',status:'Doing'}]}).project;
  assert.deepEqual(p.items.map(i=>i.status),['未着手','未着手','進行中']);
  assert.deepEqual(p.items.map(i=>i.parentId),['','a','b']);
  assert.equal(p.items[2].task.workType,null);
  assert.equal(p.items[2].task.reviewRequired,true);
  assert.ok(p.sourceInfo.warnings.every(w=>w.startsWith('t:')));
});
test('valid new-format backups preserve item meanings',()=>{
  const original=JSON.stringify(legacy('Approved')),first=prepareImport(JSON.parse(original),original);
  const next=prepareImport({project:first.project,originalText:original});
  assert.deepEqual(next.project.items,first.project.items);
  assert.equal(next.originalText,original);
  assert.notEqual(next.project.id,first.project.id);
});
test('audit reports historical mismatches without changing the project or source',()=>{
  const original=legacy('Proposed'),p=prepareImport(original).project;
  p.items[0].status='確定';const before=JSON.stringify({p,original});
  assert.equal(auditImportedStatuses(p,original)[0].expected,'提案中');
  assert.equal(JSON.stringify({p,original}),before);
  assert.equal(auditImportedStatuses(prepareImport(legacy('Approved')).project,legacy('Approved')).length,0);
  assert.throws(()=>auditImportedStatuses(p,{workspace:{id:'OTHER'}}),/一致/);
});
test('API rejects invalid combinations before touching persistent storage',async()=>{
  const {POST}=await loadSource('app/api/projects/route.ts',[{name:'no-storage',setup(b){
    b.onResolve({filter:/^@\/db\/store$/},()=>({path:'store',namespace:'mock'}));
    b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export function database(){throw Error("Storage must not be touched")};export function originalBucket(){throw Error("Storage must not be touched")}',loader:'js'}));
  }}]);
  for(const [kind,status] of [['議論','PASS'],['決定','未着手']]){
    const project=model.newProject('検証');project.items=[{id:'x',kind,status,title:'不正な組合せ',body:'',reason:'',parentId:''}];
    const response=await POST(new Request('https://example.test/api/projects',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-email':'test@example.test',Origin:'https://example.test'},body:JSON.stringify({project,baseRevision:0})}));
    assert.equal(response.status,400);
    assert.match((await response.json()).error,/状態/);
  }
});
test('AI proposals use the same kind-specific validation',()=>{
  const proposal={projectId:crypto.randomUUID(),baseRevision:1,summary:'検証',changes:{},upserts:[{id:'x',kind:'決定',status:'PASS',title:'test',body:'',reason:'',parentId:''}]};
  assert.equal(model.proposalSchema.safeParse(proposal).success,false);
});
test('work can be cancelled without making cancellation a status for other item kinds',()=>{
  const item={id:'x',kind:'作業',status:'中止',title:'中止した作業',body:'',reason:'',parentId:''};
  assert.equal(model.itemSchema.safeParse(item).success,true);
  assert.equal(model.itemSchema.safeParse({...item,kind:'構成'}).success,false);
});
test('active work reopens a completed project, while completed or cancelled work does not',()=>{
  for(const [status,stage] of [['未着手','実装準備'],['進行中','実装準備'],['保留','実装準備'],['要確認','実装準備'],['完了','完了'],['中止','完了']]){
    const project=model.newProject('割り込み');project.stage='完了';project.items=[{id:'x',kind:'作業',status,title:'作業',body:'',reason:'',parentId:''}];
    assert.equal(reopenForActiveWork(project).stage,stage,status);
  }
});
test('completion approval rejects active work and accepts cancelled work',()=>{
  for(const status of ['未着手','進行中','保留','要確認']){
    const project=model.newProject('完了判定');project.stage='完了';project.items=[{id:'x',kind:'作業',status,title:'作業',body:'',reason:'',parentId:''}];
    assert.throws(()=>resolveApprovals(project,undefined,1,{implementation:true,completion:true},'owner','2026-09-09T00:00:00.000Z'),/完了または中止/);
  }
  const project=model.newProject('完了判定');project.stage='完了';project.items=[{id:'x',kind:'作業',status:'中止',title:'作業',body:'',reason:'',parentId:''}];
  assert.equal(resolveApprovals(project,undefined,1,{implementation:true,completion:true},'owner','2026-09-09T00:00:00.000Z').completionApproved,true);
});
test('bulk work accepts spreadsheet rows and resolves intra-batch and existing dependencies',()=>{
  let n=0;const existing=[{id:'root',kind:'構成',status:'未着手',title:'機能A',body:'',reason:'',parentId:''}];
  const raw=bulkWorkHeader+'\n設計\t仕様を決める\t未着手\t機能A\t工程・仕様のみ\t1\t\t仕様確定\t必要\n実装\tコード変更\t未着手\t機能A\tソース変更\t2\t設計\t自動テスト成功;画面確認\t追加要求なし';
  const result=parseBulkWork(raw,existing,()=>`new-${++n}`);
  assert.deepEqual(result.errors,[]);assert.equal(result.items.length,2);
  assert.equal(result.items[0].parentId,'root');assert.equal(result.items[1].task.dependsOn[0],result.items[0].id);
  assert.deepEqual(result.items[1].task.acceptanceCriteria,['自動テスト成功','画面確認']);
  assert.equal(result.items[1].task.workType,'SOURCE_UPDATE');assert.equal(result.items[1].task.requiresHumanApproval,false);
});
test('bulk work reports row-specific invalid references and values before applying',()=>{
  const result=parseBulkWork('作業A\t\t不正状態\t不明な構成\t未知\t1.5\t不明な依存',[],()=> 'new');
  assert.equal(result.items.length,0);assert.ok(result.errors.length>=4);
  assert.ok(result.errors.every(e=>e.startsWith('1行目:')));
});
