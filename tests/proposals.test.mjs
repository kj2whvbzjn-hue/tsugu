import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
const plugin={name:'proposal-store-test',setup(b){b.onResolve({filter:/^@\/db\/store$/},()=>({path:'store',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const database=()=>globalThis.__proposalTest.db;export const originalBucket=()=>globalThis.__proposalTest.bucket;',loader:'js'}));}};
async function load(file){const b=await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',write:false,plugins:[plugin]});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const projects=await load('app/api/projects/route.ts'),proposals=await load('app/api/proposals/route.ts'),mcp=await load('app/mcp/route.ts');
const context=await load('app/api/projects/task-context/route.ts');
const {newProject}=await load('app/model.ts');
const origin='https://tsugu.test';
function req(path,body,options={}){return new Request(origin+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',origin,...(options.anonymous?{}:{'oai-authenticated-user-id':options.owner||'one'}),...options.headers},...(body?{body:JSON.stringify(body)}:{})});}
function setup(){
 const sql=new DatabaseSync(':memory:');for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+name,'utf8'));
 const files=new Map();let failPut=false,beforeBatch;
 const db={prepare(query){return {bind(...args){return {async first(){return sql.prepare(query).get(...args)??null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}}}}}}},async batch(statements){if(beforeBatch){const f=beforeBatch;beforeBatch=undefined;f();}sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}}};
 const bucket={async put(k,v){if(failPut)throw Error('R2 unavailable');files.set(k,v)},async get(k){return files.has(k)?{body:files.get(k)}:null},async delete(k){files.delete(k)}};
 globalThis.__proposalTest={db,bucket};
 return {sql,files,fail:v=>failPut=v,race:f=>beforeBatch=f};
}
async function seed(){const project=newProject('AI共同作業');const response=await projects.POST(req('/api/projects',{project,baseRevision:0,approvals:{implementation:true}}));assert.equal(response.status,200);return (await response.json()).project;}
function proposal(p,baseRevision=1){return {projectId:p.id,baseRevision,summary:'次の作業を整理',changes:{next:'検証する'},upserts:[{id:'task-1',kind:'作業',title:'API検証',body:'実際に確認する',status:'未着手',parentId:'',reason:'AI接続の検証'}]};}
const submit=(id,p,options)=>proposals.POST(req('/api/proposals',{id,proposal:p},options));
const apply=id=>projects.POST(req('/api/projects',{proposalId:id}));
const rpc=(name,args,options)=>mcp.POST(req('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},options));
test('dependency rejection through save and proposal leaves data, revision, history and R2 unchanged',async()=>{
 const h=setup(),p=await seed();
 const task=(id,deps=[])=>({id,kind:'作業',title:id,body:'',reason:'',parentId:'',status:'未着手',task:{workType:'DEVELOPMENT_ONLY',executionOrder:1,dependsOn:deps,acceptanceCriteria:['検証'],requiresHumanApproval:false,references:[]}});
 p.items=[task('before'),task('after',['before'])];
 const initial=await projects.POST(req('/api/projects',{project:p,baseRevision:1}));assert.equal(initial.status,200);
 const snapshot=h.sql.prepare('SELECT body,revision FROM projects').get(),files=[...h.files],count=h.sql.prepare('SELECT count(*) n FROM revisions').get().n;
 p.items[1].status='完了';
 const direct=await projects.POST(req('/api/projects',{project:p,baseRevision:2}));assert.equal(direct.status,400);assert.match((await direct.json()).error,/依存/);
 const id=crypto.randomUUID();const response=await submit(id,{projectId:p.id,baseRevision:2,summary:'不正完了の試験',changes:{},upserts:[p.items[1]]});assert.equal(response.status,400);
 assert.deepEqual(h.sql.prepare('SELECT body,revision FROM projects').get(),snapshot);
 assert.equal(h.sql.prepare('SELECT count(*) n FROM revisions').get().n,count);
 assert.deepEqual([...h.files],files);
 assert.equal(h.sql.prepare('SELECT count(*) n FROM proposals').get().n,0);
 p.items[0].status='完了';
 assert.equal((await projects.POST(req('/api/projects',{project:p,baseRevision:2}))).status,200);
 h.sql.close();
});
test('proposal round trip persists pending, applies once, and expires old approvals',async()=>{
 const h=setup(),p=await seed(),id=crypto.randomUUID(),change=proposal(p);
 assert.equal((await submit(id,change)).status,200);
 assert.equal(h.sql.prepare('SELECT revision FROM projects').get().revision,1);
 assert.equal(h.sql.prepare('SELECT status FROM proposals').get().status,'pending');
 assert.equal((await submit(id,change)).status,200);
 assert.equal(h.sql.prepare('SELECT count(*) n FROM proposals').get().n,1);
 const response=await apply(id);assert.equal(response.status,200);const saved=await response.json();
 assert.equal(saved.revision,2);assert.equal(saved.project.next,'検証する');assert.equal(saved.project.implementationApproved,false);
 assert.equal(saved.project.items[0].id,'task-1');
 assert.equal((await apply(id)).status,200);assert.equal((await submit(id,change)).status,200);
 assert.equal(h.sql.prepare('SELECT revision FROM projects').get().revision,2);
 const status=await (await rpc('get_proposal_status',{id})).json();assert.equal(status.result.structuredContent.status,'applied');assert.equal(status.result.structuredContent.appliedRevision,2);
 assert.equal(h.sql.prepare('SELECT count(*) n FROM revisions').get().n,2);
 h.sql.close();
});
test('owner isolation, identity, origin, unknown tools and proposal field restrictions',async()=>{
 const h=setup(),p=await seed(),id=crypto.randomUUID(),change=proposal(p);
 assert.equal((await submit(id,change,{anonymous:true})).status,401);
 assert.equal((await submit(id,change,{owner:'other'})).status,404);
 assert.equal((await submit(id,change,{headers:{origin:'https://evil.test'}})).status,403);
 assert.equal((await submit(id,{...change,changes:{stage:'完了'}})).status,400);
 assert.equal((await submit(id,{...change,implementationApproved:true})).status,400);
 assert.equal((await submit(id,{...change,upserts:[...change.upserts,...change.upserts]})).status,400);
 assert.equal((await submit(id,{...change,upserts:[{...change.upserts[0],status:'PASS'}]})).status,400);
 assert.equal((await submit(id,change)).status,200);
 assert.equal((await proposals.GET(req('/api/proposals?id='+id,null,{owner:'other'}))).status,404);
 assert.equal((await projects.POST(req('/api/projects',{proposalId:id},{owner:'other'}))).status,404);
 assert.equal((await rpc('get_project',{projectId:p.id},{anonymous:true})).status,401);
 assert.equal((await rpc('get_project',{projectId:p.id},{headers:{origin:'https://evil.test'}})).status,403);
 assert.equal((await (await rpc('get_project',{projectId:p.id},{owner:'other'})).json()).result.isError,true);
 assert.equal((await (await rpc('apply_proposal',{id})).json()).result.isError,true);
 assert.equal(h.sql.prepare('SELECT revision FROM projects').get().revision,1);
 h.sql.close();
});
test('stale proposals and a late save race cannot overwrite the project',async()=>{
 const h=setup(),p=await seed(),id=crypto.randomUUID(),change=proposal(p);
 await submit(id,change);
 assert.equal((await submit(id,{...change,summary:'different'})).status,409);
 h.race(()=>h.sql.prepare('UPDATE projects SET revision=2').run());
 assert.equal((await apply(id)).status,409);
 assert.equal(h.sql.prepare('SELECT status FROM proposals').get().status,'pending');
 assert.equal(h.sql.prepare('SELECT count(*) n FROM revisions').get().n,1);
 assert.equal(h.files.size,1);
 assert.equal((await apply(id)).status,409);
 assert.equal((await submit(crypto.randomUUID(),change)).status,409);
 const list=await (await proposals.GET(req('/api/proposals?projectId='+p.id))).json();assert.equal(list.items[0].status,'conflict');
 h.sql.close();
});
test('storage failure leaves a proposal retryable; deletion removes its stored contents',async(t)=>{
 t.mock.method(console,'error',()=>{});const h=setup(),p=await seed(),id=crypto.randomUUID();await submit(id,proposal(p));
 h.fail(true);assert.equal((await apply(id)).status,503);assert.equal(h.sql.prepare('SELECT status FROM proposals').get().status,'pending');
 h.fail(false);assert.equal((await apply(id)).status,200);
 const response=await projects.DELETE(new Request(origin+'/api/projects',{method:'DELETE',headers:{origin,'content-type':'application/json','oai-authenticated-user-id':'one'},body:JSON.stringify({projectId:p.id,baseRevision:2})}));
 assert.equal(response.status,200);assert.equal(h.sql.prepare('SELECT count(*) n FROM proposals').get().n,0);assert.equal(h.files.size,0);h.sql.close();
});
test('MCP initialize, tool list, read and submit expose no approvals or apply capability',async()=>{
 const h=setup(),p=await seed();
 const init=await mcp.POST(req('/mcp',{jsonrpc:'2.0',id:'init',method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}}));assert.equal((await init.json()).result.protocolVersion,'2025-11-25');
 const list=await mcp.POST(req('/mcp',{jsonrpc:'2.0',id:2,method:'tools/list'}));const names=(await list.json()).result.tools.map(t=>t.name);assert.deepEqual(names,['list_projects','get_project','get_items','get_task_pack','get_source_material','submit_proposal','get_proposal_status']);
 const record=(await (await rpc('get_project',{projectId:p.id})).json()).result.structuredContent;assert.equal(record.itemBodiesIncluded,false);assert.equal(record.revision,1);
 const submitted=await (await rpc('submit_proposal',{id:crypto.randomUUID(),proposal:proposal(p)})).json();assert.equal(submitted.result.structuredContent.status,'pending');
 assert.equal(h.sql.prepare('SELECT revision FROM projects').get().revision,1);
 const bad=await mcp.POST(new Request(origin+'/mcp',{method:'POST',headers:{'oai-authenticated-user-id':'one'},body:'{'}));assert.equal(bad.status,400);
 h.sql.close();
});

test('task context reads are owner/revision bound, paginated and never mutate records',async()=>{
 const h=setup(),p=await seed();
 p.sourceInfo={format:'development-project',projectId:'LEGACY',schemaVersion:'2.0',importedAt:'2026-09-08T00:00:00.000Z',counts:{},warnings:[]};
 const row={id:'TASK-1',title:'Original task',work_type:'SOURCE_UPDATE',execution_order:2,depends_on:[],acceptance_criteria:['条件'],requires_human_approval:true};
 const original={workspace:{id:'LEGACY',ai_attention:'Auto'},lifecycle:{status:'Active'},tasks:[row],records:Array.from({length:35},(_,i)=>({job_name:'剣士',level:i+1})),specifications:[{id:'SPEC-1',body:'全文'.repeat(10000)}]};
 p.items=[{id:'TASK-1',kind:'作業',title:'Edited task',body:'edited body',status:'未着手',parentId:'',reason:''}];
 h.sql.prepare('UPDATE projects SET body=? WHERE id=?').run(JSON.stringify(p),p.id);
 h.sql.prepare('INSERT INTO original_files(project_id,owner,object_key) VALUES(?,?,?)').run(p.id,'one','original');h.files.set('original',JSON.stringify(original));
 const path='/api/projects/task-context?projectId='+p.id+'&baseRevision=1';
 assert.equal((await context.GET(req(path+'&taskId=TASK-1',null,{anonymous:true}))).status,401);
 assert.equal((await context.GET(req(path+'&taskId=TASK-1',null,{owner:'other'}))).status,404);
 assert.equal((await context.GET(req(path.replace('baseRevision=1','baseRevision=2')+'&taskId=TASK-1'))).status,409);
 const metadata=await (await context.GET(req(path+'&kind=metadata&taskId=TASK-1'))).json();
 assert.equal(metadata.proposal.upserts[0].body,'edited body');assert.equal(metadata.proposal.upserts[0].task.executionOrder,2);
 const listed=await (await context.GET(req(path+'&kind=material&section=records'))).json();assert.equal(listed.entries.length,30);assert.equal(listed.entries[0].id,'@row:0');assert.equal(listed.nextOffset,30);
 const rowResult=await (await context.GET(req(path+'&kind=material&section=records&id=@row:1'))).json();assert.equal(JSON.parse(rowResult.text).level,2);
 const first=await (await context.GET(req(path+'&kind=material&section=specifications&id=SPEC-1'))).json();assert.equal(first.complete,false);assert.equal(first.nextOffset,16000);
 const second=await (await context.GET(req(path+'&kind=material&section=specifications&id=SPEC-1&offset='+first.nextOffset))).json();assert.equal(second.nextOffset,null);assert.equal(JSON.parse(first.text+second.text).body,original.specifications[0].body);
 assert.equal(h.sql.prepare('SELECT revision FROM projects WHERE id=?').get(p.id).revision,1);assert.equal(h.sql.prepare('SELECT count(*) n FROM proposals').get().n,0);
 const id=crypto.randomUUID();assert.equal((await submit(id,metadata.proposal)).status,200);assert.equal((await apply(id)).status,200);
 const pack=await (await context.GET(req(path.replace('baseRevision=1','baseRevision=2')+'&taskId=TASK-1'))).json();assert.equal(pack.packet.task.task.executionOrder,2);assert.equal(pack.packet.executionAuthorized,false);assert.equal(pack.packet.readyForHumanReview,false);
 const saved=JSON.parse(h.sql.prepare('SELECT body FROM projects WHERE id=?').get(p.id).body);
 delete saved.items[0].task;
 assert.equal((await projects.POST(req('/api/projects',{project:saved,baseRevision:2}))).status,400);
 assert.equal(h.sql.prepare('SELECT revision FROM projects WHERE id=?').get(p.id).revision,2);
 h.sql.close();
});

test('cross-project material references enforce ownership and exact revision',async()=>{
 const h=setup(),p=await seed(),q=await seed();
 q.sourceInfo={format:'development-project',projectId:'EVIDENCE',schemaVersion:'2.0',importedAt:'2026-09-08T00:00:00.000Z',counts:{},warnings:[]};
 h.sql.prepare('UPDATE projects SET body=? WHERE id=?').run(JSON.stringify(q),q.id);
 h.sql.prepare('INSERT INTO original_files(project_id,owner,object_key) VALUES(?,?,?)').run(q.id,'one','evidence');h.files.set('evidence',JSON.stringify({workspace:{id:'EVIDENCE'},records:[{level:1,hp:100}]}));
 p.items=[{id:'T',kind:'作業',title:'Task',body:'',status:'未着手',parentId:'',reason:'',task:{workType:'DEVELOPMENT_ONLY',executionOrder:1,dependsOn:[],acceptanceCriteria:['条件'],requiresHumanApproval:true,references:[{projectId:q.id,baseRevision:1,section:'records',id:'$'}]}}];
 h.sql.prepare('UPDATE projects SET body=? WHERE id=?').run(JSON.stringify(p),p.id);
 const path='/api/projects/task-context?projectId='+p.id+'&baseRevision=1&taskId=T';
 const result=await (await context.GET(req(path))).json();assert.equal(result.packet.materials[0].content[0].hp,100);assert.equal(result.packet.materials[0].projectId,q.id);assert.equal(result.packet.materials[0].baseRevision,1);assert.match(result.packet.materials[0].originalSha256,/^[a-f0-9]{64}$/);
 h.sql.prepare('UPDATE projects SET revision=2 WHERE id=?').run(q.id);assert.equal((await context.GET(req(path))).status,409);
 h.sql.prepare('UPDATE projects SET revision=1 WHERE id=?').run(q.id);
 const get=globalThis.__proposalTest.bucket.get;
 globalThis.__proposalTest.bucket.get=async key=>{const file=await get(key);h.sql.prepare('UPDATE projects SET revision=2 WHERE id=?').run(q.id);return file;};
 assert.equal((await context.GET(req(path))).status,409);
 globalThis.__proposalTest.bucket.get=get;
 h.sql.prepare('UPDATE projects SET revision=1,owner=? WHERE id=?').run('other',q.id);assert.equal((await context.GET(req(path))).status,404);
 h.sql.close();
});
