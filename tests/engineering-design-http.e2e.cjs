const {request}=require('playwright');
const {generateKeyPairSync,createSign}=require('node:crypto');
const assert=require('node:assert/strict');

(async()=>{
  const [{createOidcVerifier},{createHttpGateway}]=await Promise.all([import('../engineering-design-graph/security.mjs'),import('../engineering-design-graph/http-server.mjs')]);
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk=publicKey.export({format:'jwk'});jwk.kid='e2e-key';jwk.alg='RS256';jwk.use='sig';
  const issuer='https://e2e.issuer.test',audience='engineering-design-graph';
  const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
  const token=roles=>{const now=Math.floor(Date.now()/1000),h=b64({alg:'RS256',kid:'e2e-key',typ:'JWT'}),p=b64({iss:issuer,aud:audience,sub:'e2e-user',roles,iat:now,exp:now+300}),input=`${h}.${p}`,sig=createSign('RSA-SHA256').update(input).end().sign(privateKey).toString('base64url');return `${input}.${sig}`};
  const gateway=createHttpGateway({verifyBearer:createOidcVerifier({issuer,audience,jwks:{keys:[jwk]}})}),server=await gateway.listen(0);
  const baseURL=`http://127.0.0.1:${server.address().port}`,ctx=await request.newContext({baseURL});
  try{
    let r=await ctx.get('/api/v1/projects/p1/summary',{headers:{authorization:`Bearer ${token(['viewer'])}`}});assert.equal(r.status(),200);
    r=await ctx.patch('/api/v1/artifacts/req1',{headers:{authorization:`Bearer ${token(['viewer'])}`},data:{title:'Forbidden'}});assert.equal(r.status(),403);
    r=await ctx.patch('/api/v1/artifacts/req1',{headers:{authorization:`Bearer ${token(['editor'])}`},data:{title:'HTTP E2E staged'}});assert.equal(r.status(),202);
    const body=await r.json();assert.ok(body.changeSet?.id);
    assert.equal(gateway.auditOutbox.auditLogs.length,3);assert.equal(gateway.auditOutbox.outboxEvents.length,1);
    console.log('Engineering Design Graph HTTP Playwright E2E: PASS (OIDC + RBAC + Audit/Outbox)');
  }finally{await ctx.dispose();await new Promise(resolve=>server.close(resolve))}
})().catch(err=>{console.error(err);process.exitCode=1});
