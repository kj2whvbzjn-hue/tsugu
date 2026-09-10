import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
async function load(file){const r=await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));}
const {makeBackup,fileResponse}=await load('app/backup.ts');
const {prepareImport}=await load('app/import-project.ts');
const {newProject}=await load('app/model.ts');
test('project-only backup round trips without the original and preserves empty-title editor input',()=>{
 const p=newProject('退避');p.sourceInfo={format:'development-project',projectId:'old',schemaVersion:'1',importedAt:'now',counts:{},warnings:[]};
 const draft={id:'draft',kind:'作業',title:'',body:'未反映本文',reason:'根拠',status:'未着手',parentId:''};
 const record={project:p,revision:4,updatedAt:'now'},before=JSON.stringify(record);
 const backup=makeBackup(record,undefined,'取得失敗',{item:draft});
 assert.equal(backup.backupInfo.originalIncluded,false);assert.equal(JSON.stringify(record),before);
 const restored=prepareImport(backup);
 assert.notEqual(restored.project.id,p.id);assert.equal(restored.project.sourceInfo.originalMissing,true);
 assert.deepEqual(restored.draftItem,draft);assert.match(restored.project.sourceInfo.warnings.at(-1),/元JSON/);
});
test('complete backups retain exact source and reject mismatched original',()=>{
 const p=newProject('退避');p.sourceInfo={format:'development-project',projectId:'old',schemaVersion:'1',importedAt:'now',counts:{},warnings:[]};
 const original='{ "workspace": {"id":"old"} }';
 const b=makeBackup({project:p,revision:1,updatedAt:'now'},original);
 assert.equal(b.backupInfo.originalIncluded,true);assert.equal(prepareImport(b).originalText,original);
 assert.throws(()=>prepareImport({...b,originalText:'{"workspace":{"id":"other"}}'}),/一致/);
});
test('file responses are attachments, private, and preserve bytes',async()=>{
 const r=fileResponse('日本語\nJSON','unsafe\r\nname.json');
 assert.match(r.headers.get('content-disposition'),/^attachment;/);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(await r.text(),'日本語\nJSON');
});
