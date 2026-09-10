import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['app/handoff.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {buildHandoff,handoffLimits}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const project={schemaVersion:1,id:'a4a1c3d7-e26d-4768-a8f2-c1e28c9237c1',name:'テスト',purpose:'目的',rules:'方針',baseline:'基準',focus:'焦点',next:'次',stage:'検討',implementationApproved:false,completionApproved:false,items:[]};
const record=p=>({project:p,revision:5,updatedAt:'2026-09-07'});
const item=(id,kind,status,body='本文')=>({id,kind,status,title:id,body,reason:'理由',parentId:''});
test('573 large items remain bounded and report omissions without mutation',()=>{
  const p={...project,purpose:'P'.repeat(200000),items:Array.from({length:573},(_,i)=>item('task-'+i,'作業','進行中','B'.repeat(10000)))};
  const before=JSON.stringify(p),text=buildHandoff(record(p));
  assert.ok(text.length<=handoffLimits.maxCharacters);
  assert.match(text,/全573件 \/ 抜粋8件/);assert.match(text,/565件を省略/);
  assert.equal(JSON.stringify(p),before);assert.match(text,/基準版: 5/);assert.match(text,/全文を要求/);
});
test('summary omits settled content and prioritizes unresolved issues',()=>{
  const p={...project,items:[item('done','作業','完了','FINISHED_BODY'),item('pass','検証','PASS','PASSED_BODY'),...Array.from({length:20},(_,i)=>item('approved-'+i,'決定','確定')),item('proposal','決定','提案中'),item('failed','検証','FAIL')]};
  const text=buildHandoff(record(p));
  assert.ok(!text.includes('FINISHED_BODY'));assert.ok(!text.includes('PASSED_BODY'));
  assert.match(text,/proposal/);assert.match(text,/failed/);
});
test('explicit complete mode retains all item bodies',()=>{
  const p={...project,items:[item('done','作業','完了','FULL_BODY')]};
  assert.ok(!buildHandoff(record(p)).includes('FULL_BODY'));
  assert.match(buildHandoff(record(p),'完全版'),/FULL_BODY/);
});
test('maximum length holds across all kinds and oversized IDs',()=>{
  const p={...project,items:['構成','作業','議論','決定','検証'].flatMap(kind=>Array.from({length:8},()=>({...item('x'.repeat(200000),kind,'要確認','b'.repeat(200000)),parentId:'y'.repeat(200000),reason:'r'.repeat(200000)})))};
  assert.ok(buildHandoff(record(p)).length<=handoffLimits.maxCharacters);
});
