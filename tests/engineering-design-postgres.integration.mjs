import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,createSign} from 'node:crypto';
import pg from 'pg';
import {makeSampleProject} from '../engineering-design-graph/core.mjs';
import {createOidcVerifier} from '../engineering-design-graph/security.mjs';
import {createEngineeringDesignRuntime} from '../engineering-design-graph/runtime.mjs';
import {PostgresRateLimiter} from '../engineering-design-graph/postgres-rate-limit.mjs';

function uuidProject(){
  const source=structuredClone(makeSampleProject()),projectId=randomUUID(),artifactIds=new Map(source.artifacts.map(a=>[a.id,randomUUID()])),versionIds=new Map(source.artifactVersions.map(v=>[v.id,randomUUID()])),relationIds=new Map(source.relations.map(r=>[r.id,randomUUID()]));
  const replace=value=>{if(typeof value==='string')return artifactIds.get(value)||value;if(Array.isArray(value))return value.map(replace);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replace(v)]));return value};
  source.id=projectId;source.artifacts=source.artifacts.map(a=>({...replace(a),id:artifactIds.get(a.id),projectId,currentVersionId:versionIds.get(a.currentVersionId),sourceIds:(a.sourceIds||[]).map(x=>artifactIds.get(x)||x)}));
  source.artifactVersions=source.artifactVersions.map(v=>({...replace(v),id:versionIds.get(v.id),artifactId:artifactIds.get(v.artifactId)}));
  source.relations=source.relations.map(r=>({...r,id:relationIds.get(r.id),projectId,fromArtifactId:artifactIds.get(r.fromArtifactId),toArtifactId:artifactIds.get(r.toArtifactId)}));
  source.changeSets=[];source.readinessSnapshots=[];source.aiCandidates=[];source.aiRequests=[];
  return source;
}

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk=publicKey.export({format:'jwk'});jwk.kid='pg-int';jwk.alg='RS256';jwk.use='sig';
const issuer='https://pg.integration.test',audience='engineering-design-graph',b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function token(){const now=Math.floor(Date.now()/1000),h=b64({alg:'RS256',kid:'pg-int'}),p=b64({iss:issuer,aud:audience,sub:'pg-user',roles:['viewer'],iat:now,exp:now+300}),input=`${h}.${p}`,sig=createSign('RSA-SHA256').update(input).end().sign(privateKey).toString('base64url');return`${input}.${sig}`}

const pool=new pg.Pool({host:process.env.PGHOST||'127.0.0.1',port:Number(process.env.PGPORT||5432),user:process.env.PGUSER||'postgres',password:process.env.PGPASSWORD||'postgres',database:process.env.PGDATABASE||'edg',max:4});
try{
  const sharedLimiter=new PostgresRateLimiter({pool,limit:2,windowMs:60000});
  let limitResult=await sharedLimiter.check('pg-shared-user');assert.equal(limitResult.allowed,true);limitResult=await sharedLimiter.check('pg-shared-user');assert.equal(limitResult.allowed,true);limitResult=await sharedLimiter.check('pg-shared-user');assert.equal(limitResult.allowed,false);assert.equal(limitResult.remaining,0);await sharedLimiter.reset('pg-shared-user');
  const project=uuidProject(),verifyBearer=createOidcVerifier({issuer,audience,jwks:{keys:[jwk]}}),runtime=await createEngineeringDesignRuntime({pool,verifyBearer});
  await pool.query('delete from outbox_events');const leaseIds=[randomUUID(),randomUUID()];for(const id of leaseIds)await pool.query(`insert into outbox_events(id,aggregate_type,aggregate_id,event_type,payload) values($1,'artifact',$2,'artifact.updated','{}'::jsonb)`,[id,`lease-${id}`]);const claimedA=await runtime.outbox.claimPending('worker-a',1,60000),claimedB=await runtime.outbox.claimPending('worker-b',10,60000);assert.equal(claimedA.length,1);assert.equal(claimedB.length,1);assert.notEqual(claimedA[0].id,claimedB[0].id);await runtime.outbox.markPublished(claimedA[0].id);await runtime.outbox.markPublished(claimedB[0].id);
  await runtime.repository.save(project);await runtime.projectAccessRepository.upsertMember(project.id,'pg-user','editor');await runtime.api.reload();
  const req=[...runtime.api.projects.get(project.id).artifacts].find(a=>a.type==='requirement');assert.ok(req);
  const server=await runtime.gateway.listen(0),base=`http://127.0.0.1:${server.address().port}`,headers={authorization:`Bearer ${token()}`,'content-type':'application/json'};let changeSetId=null,appliedRevision=null;
  try{
    let r=await fetch(`${base}/health/ready`);assert.equal(r.status,200);
    const migration=(await pool.query('select filename,checksum from schema_migrations order by filename limit 1')).rows[0];await pool.query('update schema_migrations set checksum=$2 where filename=$1',[migration.filename,'checksum-drift']);r=await fetch(`${base}/health/ready`);assert.equal(r.status,503);await pool.query('update schema_migrations set checksum=$2 where filename=$1',[migration.filename,migration.checksum]);r=await fetch(`${base}/health/ready`);assert.equal(r.status,200);
    r=await fetch(`${base}/api/v1/artifacts/${req.id}`,{method:'PATCH',headers,body:JSON.stringify({title:'PostgreSQL round-trip title'})});assert.equal(r.status,202);const staged=await r.json();changeSetId=staged.changeSet.id;
    r=await fetch(`${base}/api/v1/change-sets/${changeSetId}/apply`,{method:'POST',headers:{...headers,'idempotency-key':'pg-apply-1'},body:'{}'});assert.equal(r.status,200);const applied=await r.json();appliedRevision=applied.revision;assert.equal(appliedRevision,project.revision+1);
  }finally{await new Promise(resolve=>server.close(resolve))}
  const runtime2=await createEngineeringDesignRuntime({pool,verifyBearer}),server2=await runtime2.gateway.listen(0);try{const r=await fetch(`http://127.0.0.1:${server2.address().port}/api/v1/change-sets/${changeSetId}/apply`,{method:'POST',headers:{...headers,'idempotency-key':'pg-apply-1'},body:'{}'});assert.equal(r.status,200);assert.equal(r.headers.get('idempotency-replayed'),'true');assert.equal((await r.json()).revision,appliedRevision)}finally{await new Promise(resolve=>server2.close(resolve))}
  const reloaded=await runtime.repository.get(project.id),updated=reloaded.artifacts.find(a=>a.id===req.id);assert.equal(updated.title,'PostgreSQL round-trip title');assert.equal(updated.version,req.version+1);assert.equal(reloaded.artifactVersions.filter(v=>v.artifactId===req.id).length,2);
  const client=await pool.connect();try{const audit=await client.query(`select count(*)::int as n from audit_logs where project_id=$1 and action='changeset.apply'`,[project.id]),outbox=await client.query(`select count(*)::int as n from outbox_events where aggregate_id=$1 and event_type='changeset.applied'`,[project.id]),bucket=await client.query(`select count(*)::int as n from rate_limit_buckets where bucket_key='pg-shared-user'`),idem=await client.query(`select state from idempotency_records where scope like $1`,[`pg-user:POST:/api/v1/change-sets/${changeSetId}/apply:%`]);assert.equal(audit.rows[0].n,1);assert.equal(outbox.rows[0].n,1);assert.equal(bucket.rows[0].n,0);assert.equal(idem.rows[0].state,'completed')}finally{client.release()}
  console.log('Engineering Design Graph PostgreSQL runtime integration: PASS');
}finally{await pool.end()}
