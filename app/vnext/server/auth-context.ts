import type {AuthPrincipal} from '../domain/identity';

export type A01SecurityCode='UNAUTHENTICATED'|'FORBIDDEN'|'CROSS_PROJECT'|'ACTOR_FORGERY'|'SELF_ELEVATION'|'BOOTSTRAP_NOT_AUTHORIZED'|'STALE_POLICY';

export class A01SecurityError extends Error{
  constructor(public readonly code:A01SecurityCode,message:string){super(message);}
}

const toHex=(buffer:ArrayBuffer)=>Array.from(new Uint8Array(buffer)).map(byte=>byte.toString(16).padStart(2,'0')).join('');

export async function requireAuthPrincipal(headers:Headers):Promise<AuthPrincipal>{
  const subjectId=headers.get('oai-authenticated-user-id')?.trim()||'';
  if(!subjectId)throw new A01SecurityError('UNAUTHENTICATED','Authenticated stable subject is required');
  const email=headers.get('oai-authenticated-user-email')?.trim().toLowerCase()||'';
  const digest=email?await crypto.subtle.digest('SHA-256',new TextEncoder().encode(email)):null;
  return {subjectId,emailHash:digest?`email:${toHex(digest)}`:''};
}
