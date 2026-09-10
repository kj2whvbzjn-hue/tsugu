import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
async function load(file,plugins=[]){const b=await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',write:false,plugins});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {newProject}=await load('app/model.ts');
const {resolveApprovals,readApprovals}=await load('app/approvals.ts');
const now='2026-09-07T00:00:00.000Z';
test('approval stamps are server-owned, tied to saved revision, and expire on the next save',()=>{
 const p=newProject('承認');
 const approved=resolveApprovals(p,undefined,0,{implementation:true},'owner',now);
 assert.equal(approved.implementationApproval.approvedRevision,1);
 assert.equal(readApprovals(approved,1).implementationApproved,true);
 assert.equal(readApprovals(approved,2).implementationApproved,false);
 const edited=resolveApprovals({...approved,purpose:'変更'},approved,1,{},'owner',now);
 assert.equal(edited.implementationApproved,false);
 assert.equal(edited.implementationApproval.approvedRevision,1);
 const forged=resolveApprovals(approved,undefined,0,{},'owner',now);
 assert.equal(forged.implementationApproved,false);assert.equal(forged.implementationApproval,undefined);
 const legacy={...p,implementationApproved:true};assert.equal(readApprovals(legacy,1).implementationApproved,false);
});
test('same-stage edits remain saveable, but forward gates and failed checks require approval',()=>{
 const old={...newProject('工程'),stage:'実装',implementationApproved:true};
 assert.equal(resolveApprovals({...old,focus:'更新'},old,1,{},'u',now).stage,'実装');
 assert.throws(()=>resolveApprovals({...old,stage:'確認'},old,1,{},'u',now),/実装承認/);
 const done=resolveApprovals({...old,stage:'完了'},old,1,{implementation:true,completion:true},'u',now);
 assert.equal(done.completionApproval.approvedRevision,2);
 assert.throws(()=>resolveApprovals({...old,items:[{kind:'検証',status:'FAIL'}]},old,1,{implementation:true,completion:true},'u',now),/検証/);
});

function setup(){
 const sql=new DatabaseSync(':memory:');
 for(const name of ['0000_tiny_living_tribunal','0001_smooth_shotgun','0002_redundant_hiroim','0003_overjoyed_exiles','0004_blue_yellowjacket'])sql.exec(readFileSync('drizzle/'+name+'.sql','utf8'));
 const files=new Map();let failPut=false,failDelete=false,beforeBatch;
 const db={prepare(query){return {bind(...args){return {async first(){return sql.prepare(query).get(...args)??null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}}},query,args}}}},async batch(statements){if(beforeBatch){const fn=beforeBatch;beforeBatch=undefined;fn();}sql.exec('BEGIN');try{const results=[];for(const st of statements)results.push(await st.run());sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}}};
 const bucket={async put(key,value){if(failPut)throw Error('R2 unavailable');files.set(key,value)},async get(key){return files.has(key)?{body:files.get(key)}:null},async delete(key){if(failDelete)throw Error('Delete unavailable');files.delete(key)}};
 globalThis.__revisionStore={db,bucket};
 return {sql,files,setFailPut:v=>failPut=v,setFailDelete:v=>failDelete=v,race:fn=>beforeBatch=fn};
}
const api=await load('app/api/projects/route.ts',[{name:'test-store',setup(b){b.onResolve({filter:/^@\/db\/store$/},()=>({path:'store',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const database=()=>globalThis.__revisionStore.db;export const originalBucket=()=>globalThis.__revisionStore.bucket;',loader:'js'}));}}]);
const exportApi=await load('app/api/projects/export/route.ts',[{name:'test-export-store',setup(b){b.onResolve({filter:/^@\/db\/store$/},()=>({path:'store',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const database=()=>globalThis.__revisionStore.db;export const originalBucket=()=>globalThis.__revisionStore.bucket;',loader:'js'}));}}]);
const req=(path,method='GET',body,email='one@example.test')=>new Request('https://example.test/api/projects'+path,{method,headers:{'oai-authenticated-user-email':email,origin:'https://example.test','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
test('history is bounded, retrievable and owner-scoped; legacy bodies are preserved',async()=>{
 const h=setup(),p=newProject('履歴');let record;
 for(let i=0;i<53;i++){const response=await api.POST(req('','POST',{project:p,baseRevision:i}));assert.equal(response.status,200);record=await response.json();}
 assert.equal(h.sql.prepare('SELECT count(*) n FROM revisions').get().n,50);
 assert.equal(h.sql.prepare("SELECT count(*) n FROM revisions WHERE body<>''").get().n,0);
 assert.equal(h.files.size,50);
 assert.equal((await api.GET(req('?snapshot='+p.id+'&revision=1'))).status,404);
 const snap=await api.GET(req('?snapshot='+p.id+'&revision=53'));assert.equal(snap.status,200);assert.equal((await snap.json()).revision,53);
 assert.equal((await api.GET(req('?snapshot='+p.id+'&revision=53','GET',null,'other@example.test'))).status,404);
 const otherHistory=await api.GET(req('?history='+p.id,'GET',null,'other@example.test'));assert.deepEqual(await otherHistory.json(),[]);
 const owner=h.sql.prepare('SELECT owner FROM projects').get().owner;
 h.sql.prepare('INSERT INTO revisions (key,project_id,owner,revision,body,summary,created_at) VALUES (?,?,?,?,?,?,?)').run('old',p.id,owner,1,JSON.stringify(p),'旧版',now);
 const old=await api.GET(req('?snapshot='+p.id+'&revision=1'));assert.equal((await old.json()).project.name,p.name);
 const del=await api.DELETE(req('','DELETE',{projectId:p.id,baseRevision:53}));assert.equal(del.status,200);
 assert.equal(h.sql.prepare('SELECT count(*) n FROM revisions').get().n,0);
 // Deferred deletion is owner-scoped and drains in bounded batches.
 await api.GET(req(''));await api.GET(req(''));assert.equal(h.files.size,0);
 h.sql.close();
});
test('storage failure and a late optimistic conflict do not write or prune history',async(t)=>{
 t.mock.method(console,'error',()=>{});
 const h=setup(),p=newProject('障害');
 assert.equal((await api.POST(req('','POST',{project:p,baseRevision:0}))).status,200);
 h.setFailPut(true);assert.equal((await api.POST(req('','POST',{project:p,baseRevision:1}))).status,503);
 assert.equal(h.sql.prepare('SELECT revision FROM projects').get().revision,1);
 h.setFailPut(false);h.race(()=>h.sql.prepare('UPDATE projects SET revision=2').run());
 assert.equal((await api.POST(req('','POST',{project:p,baseRevision:1}))).status,409);
 assert.equal(h.sql.prepare('SELECT count(*) n FROM revisions').get().n,1);assert.equal(h.files.size,1);
 h.sql.close();
});
test('API records explicit approvals and invalidates them on content changes',async()=>{
 const h=setup(),p=newProject('実API承認');
 let response=await api.POST(req('','POST',{project:p,baseRevision:0,approvals:{implementation:true}}));
 let record=await response.json();assert.equal(record.project.implementationApproval.approvedRevision,1);
 response=await api.POST(req('','POST',{project:{...record.project,focus:'変更'},baseRevision:1}));
 record=await response.json();assert.equal(record.project.implementationApproved,false);
 assert.equal(record.project.implementationApproval.approvedRevision,1);
 const count=h.files.size;
 assert.equal((await api.POST(req('','POST',{project:p,baseRevision:2},'other@example.test'))).status,409);
 assert.equal(h.files.size,count);
 h.sql.close();
});
test('project-only restore and export work without originals; exports enforce owner and revision',async()=>{
 const h=setup(),p=newProject('本体復元');p.sourceInfo={format:'development-project',projectId:'old',schemaVersion:'1',importedAt:now,counts:{},warnings:[],originalMissing:true};
 assert.equal((await api.POST(req('','POST',{project:p,baseRevision:0}))).status,200);
 const url='?id='+p.id+'&revision=1';
 const response=await exportApi.GET(req(url+'&original=1'));assert.equal(response.status,200);
 assert.match(response.headers.get('content-disposition'),/attachment/);
 const backup=await response.json();assert.equal(backup.project.name,p.name);assert.equal(backup.backupInfo.originalIncluded,false);assert.ok(backup.backupInfo.originalFetchError);
 assert.equal((await exportApi.GET(req(url+'&kind=original'))).status,503);
 assert.equal((await exportApi.GET(req(url,'GET',null,'other@example.test'))).status,404);
 assert.equal((await exportApi.GET(req('?id='+p.id+'&revision=2'))).status,409);
 assert.equal((await exportApi.GET(new Request('https://example.test/api/projects/export'+url))).status,401);
 const md=await exportApi.GET(req(url+'&kind=handoff'));assert.match(md.headers.get('content-type'),/text\/markdown/);
 h.sql.close();
});
