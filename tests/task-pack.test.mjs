import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
async function load(file){const b=await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {newProject,projectSchema}=await load('app/model.ts');
const {prepareImport}=await load('app/import-project.ts');
const {taskMetadataProposal}=await load('app/task-import.ts');
const {prepareProposal}=await load('app/proposals.ts');
const {buildTaskPack,taskReadiness,resolveMaterial,taskPackLimit}=await load('app/task-pack.ts');
const {materialRefSchema}=await load('app/task-contract.ts');
const contract=()=>({workType:'SOURCE_UPDATE',executionOrder:1,dependsOn:[],acceptanceCriteria:['保存後の版が一致する'],requiresHumanApproval:true,references:[{section:'specifications',id:'SPEC-1'}],changeControl:{baselineCommit:'a'.repeat(40),baselineSiteVersion:19,baselineProjectRevision:1,plannedFiles:['app/task-pack.ts'],dependencyNotes:['作業パック→資料解決'],protectedAreas:['元資料'],forbiddenAreas:[],verificationPlan:['全文を保持'],actualFiles:[],deviations:[],verificationEvidence:[],rollbackPlan:'前版へ戻す'}});
function record(){const project=newProject('作業パック検証');project.stage='実装準備';project.implementationApproved=true;project.implementationApproval={approvedRevision:1,approvedAt:'2026-09-08T00:00:00.000Z',approvedBy:'human'};project.sourceRefs=[{kind:'source',repository:'https://example.test/source',branch:'main',commit:'a'.repeat(40),path:''}];project.items=[{id:'TASK-1',kind:'作業',title:'保存経路',body:'本文',status:'未着手',parentId:'',reason:'',task:contract()}];return {project,revision:1,updatedAt:'2026-09-08T00:00:00.000Z'};}
const original=()=>({workspace:{id:'LEGACY-1',ai_attention:'Auto'},lifecycle:{status:'Active'},specifications:[{id:'SPEC-1',body:'全文を保持する。'.repeat(60)}]});

test('task pack includes selected full source and never grants execution or asserts Git freshness',()=>{
 const r=record(),o=original(),before=JSON.stringify({r,o});const {packet,text}=buildTaskPack(r,'TASK-1',o,'hash');
 assert.equal(packet.readyForHumanReview,true);assert.equal(packet.contentComplete,true);
 assert.equal(packet.executionAuthorized,false);assert.equal(packet.externalBaselineVerified,false);
 assert.equal(packet.materials[0].content.body,o.specifications[0].body);assert.ok(text.includes(o.specifications[0].body));assert.equal(JSON.stringify({r,o}),before);
});
test('missing materials, old approval, dependencies and cycles block readiness',()=>{
 const r=record();r.revision=2;r.project.items[0].task.dependsOn=['MISSING'];
 let packet=buildTaskPack(r,'TASK-1',{...original(),specifications:[]}).packet;
 assert.equal(packet.readyForHumanReview,false);assert.equal(packet.contentComplete,false);assert.match(packet.blockers.join(' '),/承認.*依存|依存.*承認/);
 r.project.items.push({...r.project.items[0],id:'MISSING',status:'完了',task:{...contract(),dependsOn:['TASK-1']}});
 assert.match(taskReadiness(r,r.project.items[0]).join(' '),/循環/);
});
test('large materials are explicitly incomplete; duplicate IDs and bad row selectors are rejected',()=>{
 const o=original();o.specifications[0].body='大'.repeat(taskPackLimit);
 const result=buildTaskPack(record(),'TASK-1',o);assert.equal(result.packet.contentComplete,false);assert.equal(result.packet.readyForHumanReview,false);assert.ok(Buffer.byteLength(result.text)<=taskPackLimit);
 assert.throws(()=>resolveMaterial({specifications:[{id:'x'},{id:'x'}]},{section:'specifications',id:'x'}),/重複/);
 const rows={records:[{job_code:'SWD',level:1},{job_code:'SWD',level:2}]};
 assert.deepEqual(resolveMaterial(rows,{section:'records',id:'@row:1'}),rows.records[1]);assert.deepEqual(resolveMaterial(rows,{section:'records',id:'$'}),rows.records);
 assert.throws(()=>resolveMaterial(rows,{section:'records',id:'@row:4'}));
});
test('cross-project references need both ID and revision and cannot bypass the owner-aware store',()=>{
 const r=record(),ref={section:'specifications',id:'SPEC-1',projectId:crypto.randomUUID()};
 assert.equal(materialRefSchema.safeParse(ref).success,false);ref.baseRevision=1;r.project.items[0].task.references=[ref];
 assert.equal(buildTaskPack(r,'TASK-1',original()).packet.contentComplete,false);
});
test('legacy import retains execution metadata, with no approval promotion and no mutation',()=>{
 const row={id:'TASK-1',title:'作業',status:'Todo',work_type:'SOURCE_UPDATE',execution_order:4,depends_on:['TASK-0'],acceptance_criteria:['条件'],requires_human_approval:true,approval:{status:'Approved'}};
 const input={workspace:{id:'LEGACY-1'},tasks:[row]};const before=JSON.stringify(input),p=prepareImport(input).project;
 assert.equal(p.items[0].task.workType,'SOURCE_UPDATE');assert.equal(p.items[0].task.executionOrder,4);assert.deepEqual(p.items[0].task.dependsOn,['TASK-0']);assert.equal(p.implementationApproval,undefined);assert.equal(JSON.stringify(input),before);
 const broken=prepareImport({workspace:{id:'L'},tasks:[{id:'T',status:'Todo',depends_on:'not an array'}]}).project;
 assert.equal(broken.items[0].task.reviewRequired,true);assert.equal(broken.items[0].task.workType,null);
});
test('metadata proposal preserves edited text and proposals may not drop existing task fields',()=>{
 const input={workspace:{id:'LEGACY-1'},tasks:[{id:'TASK-1',title:'old',work_type:'GAME_DATA',execution_order:1,depends_on:[],acceptance_criteria:['条件'],requires_human_approval:true}]};
 const p=prepareImport(input).project;delete p.items[0].task;p.items[0].body='取込後に編集した本文';const before=JSON.stringify(p);
 const result=taskMetadataProposal(p,input);assert.equal(result.upserts[0].body,p.items[0].body);assert.equal(JSON.stringify(p),before);assert.equal(result.upserts[0].task.workType,'GAME_DATA');
 const r=record(),item={...r.project.items[0]};delete item.task;
 assert.throws(()=>prepareProposal(r,{projectId:r.project.id,baseRevision:1,summary:'更新',changes:{},upserts:[item]}),/省略/);
 assert.equal(projectSchema.safeParse({...r.project,items:[{...r.project.items[0],kind:'議論',status:'未解決'}]}).success,false);
});
