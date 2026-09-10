import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

async function load(file){const b=await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const model=await load('app/model.ts');
const control=await load('app/change-control.ts');
const {resolveApprovals}=await load('app/approvals.ts');
const now='2026-09-09T00:00:00.000Z';
function task(){return {id:'T-1',kind:'作業',title:'監査対象',body:'',status:'完了',parentId:'',reason:'',task:{workType:'SOURCE_UPDATE',executionOrder:1,dependsOn:[],acceptanceCriteria:['保持を確認'],requiresHumanApproval:true,references:[],changeControl:{...control.emptyChangeControl(),baselineCommit:'a'.repeat(40),baselineSiteVersion:19,baselineProjectRevision:23,plannedFiles:['app/a.ts'],dependencyNotes:['API→D1'],protectedAreas:['他案件と版履歴'],verificationPlan:['他案件が不変'],rollbackPlan:'直前の公開版へ戻す'}}};}

test('new projects require change control while imported projects keep compatibility mode',async()=>{
 assert.equal(model.newProject('新規').changeControlEnabled,true);
 const {prepareImport}=await load('app/import-project.ts');
 assert.equal(prepareImport({workspace:{id:'OLD'},tasks:[]}).project.changeControlEnabled,false);
});

test('implementation approval rejects an incomplete governed source plan',()=>{
 const p=model.newProject('管理');p.items=[{...task(),status:'未着手',task:{...task().task,changeControl:control.emptyChangeControl()}}];
 assert.throws(()=>resolveApprovals(p,undefined,1,{implementation:true},'owner',now),/変更計画/);
});

test('completion approval rejects missing evidence and undocumented drift',()=>{
 const p=model.newProject('管理');const item=task();p.items=[item];
 assert.throws(()=>resolveApprovals(p,undefined,1,{implementation:true,completion:true},'owner',now),/実際に変更|証跡/);
 item.task.changeControl.actualFiles=['app/a.ts','app/unplanned.ts'];item.task.changeControl.verificationEvidence=['46 tests PASS'];
 assert.throws(()=>resolveApprovals(p,undefined,1,{implementation:true,completion:true},'owner',now),/計画外/);
 item.task.changeControl.deviations=['app/unplanned.ts: 型定義の依存により追加'];
 const saved=resolveApprovals(p,undefined,1,{implementation:true,completion:true},'owner',now);assert.equal(saved.completionApproved,true);
});

test('legacy projects govern only tasks that explicitly start a ledger',()=>{
 const p=model.newProject('旧案件');p.changeControlEnabled=false;const item=task();delete item.task.changeControl;p.items=[item];
 assert.equal(control.governedSourceTasks(p).length,0);
 item.task.changeControl=control.emptyChangeControl();assert.equal(control.governedSourceTasks(p).length,1);
});
