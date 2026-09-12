import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign} from 'node:crypto';
import {createOidcVerifier} from '../engineering-design-graph/security.mjs';
import {createHttpGateway} from '../engineering-design-graph/http-server.mjs';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk=publicKey.export({format:'jwk'});jwk.kid='test-key';jwk.alg='RS256';jwk.use='sig';
const issuer='https://issuer.example.test',audience='engineering-design-graph';
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function token(roles=['viewer']){const now=Math.floor(Date.now()/1000),h=b64({alg:'RS256',kid:'test-key',typ:'JWT'}),p=b64({iss:issuer,aud:audience,sub:'user-1',roles,iat:now,exp:now+300});const input=`${h}.${p}`,sig=createSign('RSA-SHA256').update(input).end().sign(privateKey).toString('base64url');return `${input}.${sig}`}
const verifier=createOidcVerifier({issuer,audience,jwks:{keys:[jwk]}});

test('OIDC verifier accepts valid RS256 token and rejects bad audience',async()=>{const p=await verifier(`Bearer ${token(['editor'])}`);assert.equal(p.userId,'user-1');assert.deepEqual(p.roles,['editor']);const bad=createOidcVerifier({issuer,audience:'other',jwks:{keys:[jwk]}});await assert.rejects(()=>bad(`Bearer ${token()}`),e=>e.code==='JWT_AUDIENCE_INVALID')});

test('HTTP gateway enforces viewer/editor RBAC and records audit/outbox',async()=>{const gateway=createHttpGateway({verifyBearer:verifier}),server=await gateway.listen(0);try{const port=server.address().port,base=`http://127.0.0.1:${port}`;let r=await fetch(`${base}/api/v1/projects/p1/summary`,{headers:{authorization:`Bearer ${token(['viewer'])}`}});assert.equal(r.status,200);r=await fetch(`${base}/api/v1/artifacts/req1`,{method:'PATCH',headers:{authorization:`Bearer ${token(['viewer'])}`,'content-type':'application/json'},body:JSON.stringify({title:'Denied'})});assert.equal(r.status,403);r=await fetch(`${base}/api/v1/artifacts/req1`,{method:'PATCH',headers:{authorization:`Bearer ${token(['editor'])}`,'content-type':'application/json'},body:JSON.stringify({title:'Allowed'})});assert.equal(r.status,202);assert.equal(gateway.auditOutbox.auditLogs.length,3);assert.equal(gateway.auditOutbox.outboxEvents.length,1);assert.equal(gateway.auditOutbox.outboxEvents[0].status,'pending')}finally{await new Promise(resolve=>server.close(resolve))}});

test('HTTP gateway rejects missing bearer token',async()=>{const gateway=createHttpGateway({verifyBearer:verifier}),server=await gateway.listen(0);try{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/projects/p1/summary`);assert.equal(r.status,401);const b=await r.json();assert.equal(b.code,'AUTH_REQUIRED')}finally{await new Promise(resolve=>server.close(resolve))}});
