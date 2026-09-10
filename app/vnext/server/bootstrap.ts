import type {Actor,AuthPrincipal,BootstrapReceipt,ProjectMembership,Role} from '../domain/identity';
import type {AuditEvent,AuditRuntime} from './audit';
import {createAuditEvent} from './audit';
import {A01SecurityError} from './auth-context';

export type BootstrapConfig={
  generation:string;
  projectId:string;
  allowedSubjectIds:readonly string[];
};

export type BootstrapCommit={actor:Actor;role:Role;membership:ProjectMembership;receipt:BootstrapReceipt;audit:AuditEvent};
export type BootstrapStore={
  getBootstrapReceipt:(generation:string)=>Promise<BootstrapReceipt|null>;
  getActorBySubject:(subjectId:string)=>Promise<Actor|null>;
  commitBootstrap:(candidate:BootstrapCommit)=>Promise<BootstrapReceipt>;
};

export type BootstrapResult={receiptId:string;actorId:string;membershipId:string;projectId:string;idempotent:boolean};

const defaultRuntime:AuditRuntime={now:()=>new Date(),randomId:(prefix)=>`${prefix}-${crypto.randomUUID()}`};
const toHex=(buffer:ArrayBuffer)=>Array.from(new Uint8Array(buffer)).map(byte=>byte.toString(16).padStart(2,'0')).join('');
const clean=(value:string,max:number)=>{const text=String(value??'').trim();return text&&text.length<=max?text:'';};

async function configFingerprint(config:BootstrapConfig){
  const canonical=JSON.stringify({generation:config.generation,projectId:config.projectId,allowedSubjectIds:[...new Set(config.allowedSubjectIds.map(String))].sort()});
  return toHex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)));
}

function validateConfig(config:BootstrapConfig|undefined,subjectId:string):BootstrapConfig{
  if(!config)throw new A01SecurityError('BOOTSTRAP_NOT_AUTHORIZED','Bootstrap configuration is not available');
  const generation=clean(config.generation,200),projectId=clean(config.projectId,200);
  const allowedSubjectIds=[...new Set(config.allowedSubjectIds.map(value=>clean(value,200)).filter(Boolean))];
  if(!generation||!projectId||allowedSubjectIds.length===0||!allowedSubjectIds.includes(subjectId)){
    throw new A01SecurityError('BOOTSTRAP_NOT_AUTHORIZED','Authenticated subject is not authorized for bootstrap');
  }
  return {generation,projectId,allowedSubjectIds};
}

export async function bootstrapInitialAdmin(store:BootstrapStore,principal:AuthPrincipal,providedConfig?:BootstrapConfig,runtime:AuditRuntime=defaultRuntime):Promise<BootstrapResult>{
  const subjectId=clean(principal?.subjectId,200);
  if(!subjectId)throw new A01SecurityError('UNAUTHENTICATED','Authenticated stable subject is required');
  const config=validateConfig(providedConfig,subjectId);
  const fingerprint=await configFingerprint(config);
  const existingReceipt=await store.getBootstrapReceipt(config.generation);
  if(existingReceipt){
    if(existingReceipt.subjectId!==subjectId||existingReceipt.projectId!==config.projectId||existingReceipt.configFingerprint!==fingerprint){
      throw new A01SecurityError('STALE_POLICY','Bootstrap generation is already bound to a different authority configuration');
    }
    return {receiptId:existingReceipt.id,actorId:existingReceipt.actorId,membershipId:existingReceipt.membershipId,projectId:existingReceipt.projectId,idempotent:true};
  }

  const now=runtime.now().toISOString();
  const existingActor=await store.getActorBySubject(subjectId);
  const actor:Actor=existingActor??{id:runtime.randomId('actor'),subjectId,emailHash:principal.emailHash||'',createdAt:now};
  const role:Role={
    id:runtime.randomId('role'),
    projectId:config.projectId,
    name:'bootstrap-admin',
    permissions:['project.read','project.write','membership.manage','policy.manage','audit.read'],
    createdAt:now,
  };
  const membership:ProjectMembership={id:runtime.randomId('membership'),projectId:config.projectId,actorId:actor.id,roleId:role.id,revision:1,createdAt:now};
  const receipt:BootstrapReceipt={id:runtime.randomId('receipt'),generation:config.generation,subjectId,actorId:actor.id,projectId:config.projectId,membershipId:membership.id,configFingerprint:fingerprint,createdAt:now};
  const audit=createAuditEvent({actorId:actor.id,subjectId,projectId:config.projectId,action:'bootstrap.initial-admin',policyVersion:1,resourceRevision:1,result:'ALLOW',reasonCode:'',details:{generation:config.generation,receiptId:receipt.id}},runtime);
  const committed=await store.commitBootstrap({actor,role,membership,receipt,audit});
  if(committed.subjectId!==subjectId||committed.projectId!==config.projectId||committed.configFingerprint!==fingerprint){
    throw new A01SecurityError('STALE_POLICY','Bootstrap was concurrently committed with a different authority configuration');
  }
  return {receiptId:committed.id,actorId:committed.actorId,membershipId:committed.membershipId,projectId:committed.projectId,idempotent:committed.id!==receipt.id};
}
