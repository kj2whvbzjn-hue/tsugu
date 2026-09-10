import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const b=await build({entryPoints:['app/task-dependencies.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {dependencyIssues,taskTransitionIssues}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const item=(id,status='未着手',deps=[])=>({id,title:id,kind:'作業',status,task:{dependsOn:deps}});
const p=(...items)=>({items});
test('all unfinished prerequisite states reject start and completion; completed prerequisite permits both',()=>{
 for(const status of ['未着手','進行中','保留','中止','要確認','完了'])for(const target of ['進行中','完了']){
  const old=p(item('a',status),item('b','未着手',['a']));
  assert.equal(taskTransitionIssues(old,p(old.items[0],item('b',target,['a']))).length>0,status!=='完了');
 }
});
test('missing, non-task, unstructured and cyclic prerequisites fail closed',()=>{
 for(const a of [undefined,{id:'a',kind:'構成',status:'完了'}, {id:'a',kind:'作業',status:'完了'},item('a','完了',['b'])]){
  const target=item('b','進行中',['a']);assert.ok(dependencyIssues(a?[a,target]:[target],target).length);
 }
});
test('removing unfinished prerequisite cannot bypass the transition',()=>{
 const old=p(item('a'),item('b','未着手',['a']));
 assert.ok(taskTransitionIssues(old,p(item('a'),item('b','完了'))).length);
 assert.ok(taskTransitionIssues(old,p(item('b','完了'))).length);
});
test('reopening prerequisite blocks active successor, but holding successor together is allowed',()=>{
 const old=p(item('a','完了'),item('b','進行中',['a']));
 assert.ok(taskTransitionIssues(old,p(item('a','進行中'),old.items[1])).length);
 assert.deepEqual(taskTransitionIssues(old,p(item('a','進行中'),item('b','保留',['a']))),[]);
});
test('legacy inconsistent text edits and imports remain intact; resume and completion do not',()=>{
 const old=p(item('a'),item('b','進行中',['a']));
 assert.deepEqual(taskTransitionIssues(old,p(old.items[0],{...old.items[1],body:'memo'})),[]);
 assert.deepEqual(taskTransitionIssues(undefined,old),[]);
 for(const status of ['保留','中止'])assert.deepEqual(taskTransitionIssues(old,p(old.items[0],item('b',status,['a']))),[]);
 assert.ok(taskTransitionIssues(old,p(old.items[0],item('b','完了',['a']))).length);
});
test('batch completion uses the whole candidate graph',()=>{
 const old=p(item('a'),item('b','未着手',['a']));
 assert.deepEqual(taskTransitionIssues(old,p(item('a','完了'),item('b','完了',['a']))),[]);
});
