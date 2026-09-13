import {createPublicKey,verify as verifySignature} from 'node:crypto';

const decode=x=>JSON.parse(Buffer.from(x.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(x.length/4)*4,'='),'base64').toString('utf8'));
const audienceMatches=(claim,aud)=>Array.isArray(claim)?claim.includes(aud):claim===aud;

export const ROLE_PERMISSIONS={
  viewer:new Set(['read']),
  editor:new Set(['read','write','ai_request','ai_review','package_generate']),
  reviewer:new Set(['read','write','review_approve','ai_request','ai_review','package_generate']),
  architect:new Set(['read','write','review_approve','decision_approve','system_lock','ai_request','ai_review','package_generate','readiness_override']),
  admin:new Set(['read','write','review_approve','decision_approve','system_lock','ai_request','ai_review','package_generate','readiness_override','admin'])
};

export function createOidcVerifier({issuer,audience,jwks,clock=()=>Date.now()}={}){
  if(!issuer||!audience)throw new Error('OIDC issuer and audience are required');
  const keys=new Map((jwks?.keys||[]).map(k=>[k.kid,k]));
  return async function verifyBearer(value){
    if(!value?.startsWith('Bearer '))throw Object.assign(new Error('Bearer token required'),{status:401,code:'AUTH_REQUIRED'});
    const token=value.slice(7),parts=token.split('.');
    if(parts.length!==3)throw Object.assign(new Error('Malformed JWT'),{status:401,code:'JWT_INVALID'});
    const [h,p,s]=parts,header=decode(h),claims=decode(p);
    if(header.alg!=='RS256'||!header.kid)throw Object.assign(new Error('Only RS256 JWTs with kid are accepted'),{status:401,code:'JWT_ALG_INVALID'});
    const jwk=keys.get(header.kid);if(!jwk)throw Object.assign(new Error('JWT signing key not found'),{status:401,code:'JWT_KEY_UNKNOWN'});
    const key=createPublicKey({key:jwk,format:'jwk'}),sig=Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'='),'base64');
    if(!verifySignature('RSA-SHA256',Buffer.from(`${h}.${p}`),key,sig))throw Object.assign(new Error('JWT signature invalid'),{status:401,code:'JWT_SIGNATURE_INVALID'});
    const now=Math.floor(clock()/1000);
    if(claims.iss!==issuer)throw Object.assign(new Error('JWT issuer invalid'),{status:401,code:'JWT_ISSUER_INVALID'});
    if(!audienceMatches(claims.aud,audience))throw Object.assign(new Error('JWT audience invalid'),{status:401,code:'JWT_AUDIENCE_INVALID'});
    if(claims.exp!=null&&now>=claims.exp)throw Object.assign(new Error('JWT expired'),{status:401,code:'JWT_EXPIRED'});
    if(claims.nbf!=null&&now<claims.nbf)throw Object.assign(new Error('JWT not active'),{status:401,code:'JWT_NOT_ACTIVE'});
    if(!claims.sub)throw Object.assign(new Error('JWT subject missing'),{status:401,code:'JWT_SUBJECT_MISSING'});
    const roles=[...(claims.roles||[]),...(claims.realm_access?.roles||[])].map(r=>String(r).toLowerCase());
    return {userId:claims.sub,email:claims.email||null,name:claims.name||null,roles:[...new Set(roles)],claims};
  };
}

export function createRefreshingOidcVerifier({issuer,audience,jwksUrl,fetchImpl=globalThis.fetch,cacheTtlMs=300_000,clock=()=>Date.now()}={}){
  if(!issuer||!audience||!jwksUrl)throw new Error('OIDC issuer, audience and jwksUrl are required');if(!fetchImpl)throw new Error('fetch implementation is required');if(!Number.isInteger(cacheTtlMs)||cacheTtlMs<=0)throw new Error('cacheTtlMs must be positive');
  let verifier=null,expiresAt=0,inflight=null;
  const refresh=async(force=false)=>{if(!force&&verifier&&clock()<expiresAt)return verifier;if(inflight)return inflight;inflight=(async()=>{const response=await fetchImpl(jwksUrl,{headers:{accept:'application/json'}});if(!response.ok)throw Object.assign(new Error(`OIDC JWKS request failed: ${response.status}`),{status:503,code:'OIDC_JWKS_UNAVAILABLE'});const jwks=await response.json();if(!Array.isArray(jwks?.keys)||!jwks.keys.length)throw Object.assign(new Error('OIDC JWKS contains no keys'),{status:503,code:'OIDC_JWKS_INVALID'});verifier=createOidcVerifier({issuer,audience,jwks,clock});expiresAt=clock()+cacheTtlMs;return verifier})();try{return await inflight}finally{inflight=null}};
  const verifyBearer=async value=>{let current=await refresh(false);try{return await current(value)}catch(error){if(error?.code!=='JWT_KEY_UNKNOWN')throw error;current=await refresh(true);return current(value)}};
  verifyBearer.refresh=()=>refresh(true);verifyBearer.cacheState=()=>({expiresAt,loaded:!!verifier});return verifyBearer;
}

export function authorize(principal,permission){
  const roles=principal?.roles||[];
  if(!roles.some(role=>ROLE_PERMISSIONS[role]?.has(permission)))throw Object.assign(new Error(`Permission denied: ${permission}`),{status:403,code:'FORBIDDEN'});
  return true;
}

export function permissionForRequest(method,path){
  if(method==='GET'||method==='HEAD')return 'read';
  if(/\/ai\/requests(?:\/|$)/.test(path))return 'ai_request';
  if(/\/ai\/candidates\/.+\/(accept|reject)$/.test(path))return 'ai_review';
  if(/\/implementation-packages(?:\/|$)/.test(path))return 'package_generate';
  if(/readiness.*override/.test(path))return 'readiness_override';
  if(/\/reviews\/.+\/approve$/.test(path))return 'review_approve';
  if(/\/decisions\/.+\/approve$/.test(path))return 'decision_approve';
  if(/\/systems\/.+\/lock$/.test(path))return 'system_lock';
  return 'write';
}
