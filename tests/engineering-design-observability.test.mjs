import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign} from 'node:crypto';
import {createHttpGateway} from '../engineering-design-graph/http-server.mjs';
import {createOidcVerifier} from '../engineering-design-graph/security.mjs';
import {createMetrics,createRateLimiter,createStructuredLogger} from '../engineering-design-graph/observability.mjs';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk=publicKey.export({format:'jwk'});jwk.kid='obs';jwk.alg='RS256';
const issuer='https://obs.test',audience='engineering-design-graph',b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function token(){const now=Math.floor(Date.now()/1000),h=b64({alg:'RS256',kid:'obs'}),p=b64({iss:issuer,aud:audience,sub:'obs-user',roles:['viewer'],iat:now,exp:now+300}),input=`${h}.${p}`,sig=createSign('RSA-SHA256').update(input).end().sign(privateKey).toString('base64url');return`${input}.${sig}`}
const verifier=createOidcVerifier({issuer,audience,jwks:{keys:[jwk]}});

test('HTTP gateway records normalized metrics and structured request log',async()=>{const metrics=createMetrics(),logger=createStructuredLogger({sink:null}),gateway=createHttpGateway({verifyBearer:verifier,metrics,logger}),server=await gateway.listen(0);try{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/projects/p1/summary`,{headers:{authorization:`Bearer ${token()}`}});assert.equal(r.status,200);const snap=metrics.snapshot(),key=Object.keys(snap.counters).find(k=>k.includes('http_requests_total')&&k.includes('/api/v1/projects/:id/summary'));assert.ok(key);assert.equal(snap.counters[key],1);assert.equal(logger.entries.length,1);assert.equal(logger.entries[0].event,'http.request');assert.equal(logger.entries[0].route,'/api/v1/projects/:id/summary');assert.equal(logger.entries[0].userId,'obs-user');assert.equal('body' in logger.entries[0],false)}finally{await new Promise(resolve=>server.close(resolve))}});

test('HTTP gateway returns 429 after principal rate limit is exceeded',async()=>{let now=1_000;const limiter=createRateLimiter({limit:1,windowMs:60_000,clock:()=>now}),gateway=createHttpGateway({verifyBearer:verifier,rateLimiter:limiter}),server=await gateway.listen(0);try{const url=`http://127.0.0.1:${server.address().port}/api/v1/projects/p1/summary`,headers={authorization:`Bearer ${token()}`};let r=await fetch(url,{headers});assert.equal(r.status,200);r=await fetch(url,{headers});assert.equal(r.status,429);assert.equal((await r.json()).code,'RATE_LIMITED');assert.equal(r.headers.get('x-ratelimit-remaining'),'0')}finally{await new Promise(resolve=>server.close(resolve))}});

test('health endpoints bypass OIDC and readiness reports dependency failure',async()=>{let ready=true;const gateway=createHttpGateway({verifyBearer:verifier,readinessCheck:async()=>{if(!ready)throw new Error('db down')}}),server=await gateway.listen(0);try{const base=`http://127.0.0.1:${server.address().port}`;let r=await fetch(`${base}/health/live`);assert.equal(r.status,200);assert.equal((await r.json()).status,'ok');r=await fetch(`${base}/health/ready`);assert.equal(r.status,200);ready=false;r=await fetch(`${base}/health/ready`);assert.equal(r.status,503);assert.equal((await r.json()).code,'DEPENDENCY_UNAVAILABLE')}finally{await new Promise(resolve=>server.close(resolve))}});
