// G0-01 characterization tests only.
// These tests record current behavior for diagnosis; they do NOT approve it as the desired vNext contract.
// All D1/R2 state is isolated in-memory fixture data. No production DB, Sites API, or R2 is called.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

async function load(file,plugins=[]){
 const b=await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',write:false,plugins});
 return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
}

const identityModule=await load('app/identity.ts');
const evidenceService=await load('app/evidence-service.ts');
const {newProject}=await load('app/model.ts');
const storePlugin={name:'g0-test-store',setup(b){
 b.onResolve({filter:/^@\/db\/store$/},()=>({path:'store',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const database=()=>globalThis.__g0Store.db;export const originalBucket=()=>globalThis.__g0Store.bucket;',loader:'js'}));
}};
const projectsApi=await load('app/api/projects/route.ts',[storePlugin]);

function setup(){
 const sql=new DatabaseSync(':memory:');
 for(const name of ['0000_tiny_living_tribunal','0001_smooth_shotgun','0002_redundant_hiroim','0003_overjoyed_exiles','0004_blue_yellowjacket','0005_evidence_core']){
  sql.exec(readFileSync('drizzle/'+name+'.sql','utf8').replaceAll('--> statement-breakpoint',''));
 }
 const files=new Map();let getCalls=0;
 const db={
  prepare(query){return {bind(...args){return {query,args,async first(){return sql.prepare(query).get(...args)??null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}}}}}},
  async batch(statements){sql.exec('BEGIN');try{const out=[];for(const st of statements)out.push(await st.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}
 };
 const bucket={
  async put(key,value){files.set(key,Buffer.from(value))},
  async get(key){getCalls++;return files.has(key)?{body:files.get(key)}:null},
  async delete(key){files.delete(key)}
 };
 globalThis.__g0Store={db,bucket};
 return {sql,store:{db,bucket},files,getCalls:()=>getCalls};
}

const request=(path,{method='GET',body,email='one@example.test',userId='legacy-user-1'}={})=>new Request('https://example.test/api/projects'+path,{
 method,
 headers:{'oai-authenticated-user-email':email,'oai-authenticated-user-id':userId,origin:'https://example.test','content-type':'application/json'},
 ...(body?{body:JSON.stringify(body)}:{})
});

async function fixtureIdentity(email='one@example.test',userId='legacy-user-1'){
 return identityModule.identityFromHeaders(new Headers({'oai-authenticated-user-email':email,'oai-authenticated-user-id':userId}));
}

test('characterization: owner compatibility keys are normalized email hash plus authenticated user id only',async()=>{
 const identity=await fixtureIdentity('  One@Example.Test  ','legacy-user-1');
 const expected='email:'+createHash('sha256').update('one@example.test').digest('hex');
 assert.equal(identity.owner,expected);
 assert.deepEqual(identity.keys,[expected,'legacy-user-1']);

 const h=setup();
 const emailOwned=newProject('email-owned');
 const legacyOwned=newProject('legacy-owned');
 const unrelated=newProject('unrelated');
 const now=new Date().toISOString();
 h.sql.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?)').run(emailOwned.id,expected,emailOwned.name,JSON.stringify(emailOwned),1,now);
 h.sql.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?)').run(legacyOwned.id,'legacy-user-1',legacyOwned.name,JSON.stringify(legacyOwned),1,now);
 h.sql.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?)').run(unrelated.id,'email:unrelated',unrelated.name,JSON.stringify(unrelated),1,now);
 const response=await projectsApi.GET(request(''));
 assert.equal(response.status,200);
 const records=await response.json();
 assert.deepEqual(new Set(records.map(r=>r.project.id)),new Set([emailOwned.id,legacyOwned.id]));
 h.sql.close();
});

test('characterization: Evidence readback rejects an orphan before attempting R2 access',async()=>{
 const h=setup(),identity=await fixtureIdentity();
 const projectId='11111111-1111-4111-8111-111111111111';
 const evidenceId='22222222-2222-4222-8222-222222222222';
 const versionId='33333333-3333-4333-8333-333333333333';
 const operationId='44444444-4444-4444-8444-444444444444';
 const objectKey=`evidence/${projectId}/${evidenceId}/${versionId}`;
 const bytes=Buffer.from('orphan-evidence');
 const sha=createHash('sha256').update(bytes).digest('hex');
 const now=new Date().toISOString();
 h.sql.prepare('INSERT INTO evidences VALUES (?,?,?,?,?,?,?,?,?)').run(evidenceId,projectId,identity.owner,'orphan','file','diagnostic',versionId,now,now);
 h.sql.prepare('INSERT INTO evidence_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(versionId,evidenceId,projectId,identity.owner,1,'orphan.txt','text/plain',bytes.length,sha,objectKey,'available',operationId,now);
 h.files.set(objectKey,bytes);
 await assert.rejects(()=>evidenceService.readEvidenceVersion(h.store,identity,projectId,versionId),/案件が見つかりません/);
 assert.equal(h.getCalls(),0,'parent-project rejection occurs before R2 get');
 assert.equal(h.files.has(objectKey),true,'fixture R2 object still exists');
 h.sql.close();
});

test('characterization: current Project DELETE leaves Evidence metadata and Evidence R2 object behind',async()=>{
 const h=setup(),identity=await fixtureIdentity();
 const project=newProject('delete-characterization');
 const evidenceId='55555555-5555-4555-8555-555555555555';
 const versionId='66666666-6666-4666-8666-666666666666';
 const operationId='77777777-7777-4777-8777-777777777777';
 const objectKey=`evidence/${project.id}/${evidenceId}/${versionId}`;
 const bytes=Buffer.from('retained-after-project-delete');
 const sha=createHash('sha256').update(bytes).digest('hex');
 const now=new Date().toISOString();
 h.sql.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?)').run(project.id,identity.owner,project.name,JSON.stringify(project),1,now);
 h.sql.prepare('INSERT INTO revisions (key,project_id,owner,revision,body,summary,created_at,snapshot_object_key) VALUES (?,?,?,?,?,?,?,?)').run('rev-1',project.id,identity.owner,1,'','fixture',now,null);
 h.sql.prepare('INSERT INTO evidences VALUES (?,?,?,?,?,?,?,?,?)').run(evidenceId,project.id,identity.owner,'retained','file','diagnostic',versionId,now,now);
 h.sql.prepare('INSERT INTO evidence_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(versionId,evidenceId,project.id,identity.owner,1,'retained.txt','text/plain',bytes.length,sha,objectKey,'available',operationId,now);
 h.sql.prepare('INSERT INTO evidence_uploads VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(operationId,project.id,evidenceId,identity.owner,'committed',objectKey,sha,bytes.length,'',now,now);
 h.files.set(objectKey,bytes);

 const response=await projectsApi.DELETE(request('',{method:'DELETE',body:{projectId:project.id,baseRevision:1}}));
 assert.equal(response.status,200);
 assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM projects WHERE id=?').get(project.id).n,0);
 assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM revisions WHERE project_id=?').get(project.id).n,0);
 assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM evidences WHERE project_id=?').get(project.id).n,1);
 assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM evidence_versions WHERE project_id=?').get(project.id).n,1);
 assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM evidence_uploads WHERE project_id=?').get(project.id).n,1);
 assert.equal(h.files.has(objectKey),true);
 h.sql.close();
});
