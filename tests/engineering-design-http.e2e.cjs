const {request}=require('playwright');
const {generateKeyPairSync,createSign}=require('node:crypto');
const assert=require('node:assert/strict');

(async()=>{
  const [{createOidcVerifier},{createHttpGateway},{createPersistentApiService},{MemoryProjectRepository},{EngineeringDesignApplicationService},{makeSampleProject}]=await Promise.all([
    import('../engineering-design-graph/security.mjs'),import('../engineering-design-graph/http-server.mjs'),import('../engineering-design-graph/persistent-api.mjs'),import('../engineering-design-graph/repository.mjs'),import('../engineering-design-graph/application-service.mjs'),import('../engineering-design-graph/core.mjs')
  ]);
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk=publicKey.export({format:'jwk'});jwk.kid='e2e-key';jwk.alg='RS256';jwk.use='sig';
  const issuer='https://e2e.issuer.test',audience='engineering-design-graph';
  const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
  const token=roles=>{const now=Math.floor(Date.now()/1000),h=b64({alg:'RS256',kid:'e2e-key',typ:'JWT'}),p=b64({iss:issuer,aud:audience,sub:'e2e-user',roles,iat:now,exp:now+300}),input=`${h}.${p}`,sig=createSign('RSA-SHA256').update(input).end().sign(privateKey).toString('base64url');return `${input}.${sig}`};
  const repo=new MemoryProjectRepository([makeSampleProject()]),txAudit=[],txEvents=[],txStore={async recordAudit(x){const row={id:`audit-${txAudit.length+1}`,...x};txAudit.push(row);return row},async enqueue(x){const row={id:`event-${txEvents.length+1}`,...x};txEvents.push(row);return row}};
  const applicationService=new EngineeringDesignApplicationService({repository:repo,auditOutbox:txStore}),persistentApi=await createPersistentApiService({repository:repo,applicationService});
  const gateway=createHttpGateway({api:persistentApi,verifyBearer:createOidcVerifier({issuer,audience,jwks:{keys:[jwk]}})}),server=await gateway.listen(0);
  const baseURL=`http://127.0.0.1:${server.address().port}`,ctx=await request.newContext({baseURL});
  try{
    let r=await ctx.get('/api/v1/projects/p1/summary',{headers:{authorization:`Bearer ${token(['viewer'])}`}});assert.equal(r.status(),200);
    r=await ctx.patch('/api/v1/artifacts/req1',{headers:{authorization:`Bearer ${token(['viewer'])}`},data:{title:'Forbidden'}});assert.equal(r.status(),403);
    r=await ctx.patch('/api/v1/artifacts/req1',{headers:{authorization:`Bearer ${token(['editor'])}`},data:{title:'HTTP E2E staged'}});assert.equal(r.status(),202);
    const staged=await r.json();assert.ok(staged.changeSet?.id);
    r=await ctx.post(`/api/v1/change-sets/${staged.changeSet.id}/apply`,{headers:{authorization:`Bearer ${token(['editor'])}`,'idempotency-key':'apply-e2e-1'},data:{}});assert.equal(r.status(),200);assert.equal(r.headers()['x-transactional-audit'],'true');
    const applied=await r.json();assert.equal(applied.revision,2);assert.equal(applied.changeSet.status,'applied');
    const saved=await repo.get('p1');assert.equal(saved.revision,2);assert.equal(saved.artifacts.find(a=>a.id==='req1').title,'HTTP E2E staged');assert.equal(txAudit.length,1);assert.equal(txEvents.length,1);assert.equal(txEvents[0].eventType,'changeset.applied');
    assert.equal(gateway.auditOutbox.outboxEvents.length,1);
    console.log('Engineering Design Graph HTTP Playwright E2E: PASS (OIDC + RBAC + persistence + transactional apply + Audit/Outbox)');
  }finally{await ctx.dispose();await new Promise(resolve=>server.close(resolve))}
})().catch(err=>{console.error(err);process.exitCode=1});
