import type {AuthorizationInput} from './authorization';
import {authorizeProjectAction} from './authorization';
import type {Deployment,Environment,Repository,RepositoryBaseline,RepositoryCommitRef,VerificationTarget} from '../domain/deployment-target';
import {isGitObjectId,isPositiveRevision,isSha256Digest} from '../domain/deployment-target';

export type A02ContractCode='CROSS_PROJECT'|'STALE_INPUT'|'IMMUTABLE_CONFLICT'|'COMMIT_MISMATCH'|'NOT_FOUND'|'INVALID_REFERENCE';

export class A02ContractError extends Error{
  constructor(public readonly code:A02ContractCode,message:string){super(message);}
}

export type A02Access=Omit<AuthorizationInput,'requiredPermission'>;
export type A02Runtime={now:()=>Date;randomId:(prefix:string)=>string};

export type DeploymentTargetStore={
  getRepositoryById:(id:string)=>Promise<Repository|null>;
  getRepositoryByIdentity:(projectId:string,provider:string,externalRef:string)=>Promise<Repository|null>;
  insertRepository:(value:Repository)=>Promise<Repository>;
  getEnvironmentById:(id:string)=>Promise<Environment|null>;
  getEnvironmentByKey:(projectId:string,key:string)=>Promise<Environment|null>;
  insertEnvironment:(value:Environment)=>Promise<Environment>;
  getCommitRefById:(id:string)=>Promise<RepositoryCommitRef|null>;
  getCommitRefByRepositorySha:(repositoryId:string,commitSha:string)=>Promise<RepositoryCommitRef|null>;
  insertCommitRef:(value:RepositoryCommitRef)=>Promise<RepositoryCommitRef>;
  getBaselineById:(id:string)=>Promise<RepositoryBaseline|null>;
  insertBaseline:(value:RepositoryBaseline)=>Promise<RepositoryBaseline>;
  getDeploymentById:(id:string)=>Promise<Deployment|null>;
  getDeploymentByProviderRef:(environmentId:string,providerDeploymentRef:string)=>Promise<Deployment|null>;
  insertDeployment:(value:Deployment)=>Promise<Deployment>;
};

const defaultRuntime:A02Runtime={now:()=>new Date(),randomId:prefix=>`${prefix}-${crypto.randomUUID()}`};
const clean=(value:unknown,max=300)=>{const text=String(value??'').trim();return text&&text.length<=max?text:'';};
const gitId=(value:unknown)=>clean(value,64).toLowerCase();
const digest=(value:unknown)=>clean(value,71).toLowerCase();

function fail(code:A02ContractCode,message:string):never{throw new A02ContractError(code,message);}
function assertProject(actual:string,expected:string){if(actual!==expected)fail('CROSS_PROJECT','A-02 record belongs to another Project');}
function assertRevision(actual:number,expected:number){if(!isPositiveRevision(expected)||actual!==expected)fail('STALE_INPUT','A-02 revision precondition does not match');}
function authorize(access:A02Access,permission:'project.read'|'project.write'){
  authorizeProjectAction({...access,requiredPermission:permission});
}
function sameRepository(a:Repository,b:Repository){return a.id===b.id&&a.projectId===b.projectId&&a.provider===b.provider&&a.externalRef===b.externalRef&&a.revision===b.revision;}
function sameEnvironment(a:Environment,b:Environment){return a.id===b.id&&a.projectId===b.projectId&&a.key===b.key&&a.providerRef===b.providerRef&&a.revision===b.revision;}
function sameCommit(a:RepositoryCommitRef,b:RepositoryCommitRef){return a.id===b.id&&a.projectId===b.projectId&&a.repositoryId===b.repositoryId&&a.repositoryRevision===b.repositoryRevision&&a.commitSha===b.commitSha&&a.treeSha===b.treeSha;}
function sameDeploymentValues(a:Deployment,b:Omit<Deployment,'id'|'createdAt'>){
  return a.projectId===b.projectId&&a.environmentId===b.environmentId&&a.environmentRevision===b.environmentRevision&&a.repositoryId===b.repositoryId&&a.repositoryRevision===b.repositoryRevision&&a.commitRefId===b.commitRefId&&a.commitSha===b.commitSha&&a.treeSha===b.treeSha&&a.artifactDigest===b.artifactDigest&&a.configVersion===b.configVersion&&a.schemaVersion===b.schemaVersion&&a.providerDeploymentRef===b.providerDeploymentRef;
}

export async function registerRepository(store:DeploymentTargetStore,access:A02Access,input:{projectId:string;provider:string;externalRef:string},runtime:A02Runtime=defaultRuntime):Promise<Repository>{
  authorize(access,'project.write');
  const projectId=clean(input.projectId),provider=clean(input.provider,80).toLowerCase(),externalRef=clean(input.externalRef,500);
  if(!projectId||!provider||!externalRef)fail('INVALID_REFERENCE','Repository identity is incomplete');
  assertProject(projectId,access.projectId);
  const existing=await store.getRepositoryByIdentity(projectId,provider,externalRef);
  if(existing){assertProject(existing.projectId,projectId);return existing;}
  const candidate:Repository={id:runtime.randomId('repository'),projectId,provider,externalRef,revision:1,createdAt:runtime.now().toISOString()};
  const persisted=await store.insertRepository(candidate);
  if(!sameRepository(persisted,candidate))fail('IMMUTABLE_CONFLICT','Repository identity was concurrently bound to different immutable values');
  return persisted;
}

export async function registerEnvironment(store:DeploymentTargetStore,access:A02Access,input:{projectId:string;key:string;providerRef?:string},runtime:A02Runtime=defaultRuntime):Promise<Environment>{
  authorize(access,'project.write');
  const projectId=clean(input.projectId),key=clean(input.key,120),providerRef=clean(input.providerRef??'',500);
  if(!projectId||!key)fail('INVALID_REFERENCE','Environment identity is incomplete');
  assertProject(projectId,access.projectId);
  const existing=await store.getEnvironmentByKey(projectId,key);
  if(existing){
    assertProject(existing.projectId,projectId);
    if(existing.providerRef!==providerRef)fail('IMMUTABLE_CONFLICT','Environment key is already bound to a different provider reference');
    return existing;
  }
  const candidate:Environment={id:runtime.randomId('environment'),projectId,key,providerRef,revision:1,createdAt:runtime.now().toISOString()};
  const persisted=await store.insertEnvironment(candidate);
  if(!sameEnvironment(persisted,candidate))fail('IMMUTABLE_CONFLICT','Environment identity was concurrently bound to different immutable values');
  return persisted;
}

export async function registerRepositoryCommitRef(store:DeploymentTargetStore,access:A02Access,input:{projectId:string;repositoryId:string;expectedRepositoryRevision:number;commitSha:string;treeSha:string},runtime:A02Runtime=defaultRuntime):Promise<RepositoryCommitRef>{
  authorize(access,'project.write');
  const projectId=clean(input.projectId),repositoryId=clean(input.repositoryId),commitSha=gitId(input.commitSha),treeSha=gitId(input.treeSha);
  if(!projectId||!repositoryId||!isGitObjectId(commitSha)||!isGitObjectId(treeSha))fail('INVALID_REFERENCE','RepositoryCommitRef contains an invalid repository, commit or tree reference');
  assertProject(projectId,access.projectId);
  const repository=await store.getRepositoryById(repositoryId);
  if(!repository)fail('NOT_FOUND','Repository does not exist');
  assertProject(repository.projectId,projectId);
  assertRevision(repository.revision,input.expectedRepositoryRevision);
  const existing=await store.getCommitRefByRepositorySha(repositoryId,commitSha);
  if(existing){
    if(existing.projectId!==projectId||existing.repositoryRevision!==repository.revision||existing.treeSha!==treeSha)fail('IMMUTABLE_CONFLICT','Repository+commit is already bound to different immutable values');
    return existing;
  }
  const candidate:RepositoryCommitRef={id:runtime.randomId('commit'),projectId,repositoryId,repositoryRevision:repository.revision,commitSha,treeSha,createdAt:runtime.now().toISOString()};
  const persisted=await store.insertCommitRef(candidate);
  if(!sameCommit(persisted,candidate))fail('IMMUTABLE_CONFLICT','RepositoryCommitRef was concurrently bound to different immutable values');
  return persisted;
}

export async function registerRepositoryBaseline(store:DeploymentTargetStore,access:A02Access,input:{projectId:string;repositoryId:string;expectedRepositoryRevision:number;commitRefId:string;commitSha:string;treeSha:string;manifestDigest:string},runtime:A02Runtime=defaultRuntime):Promise<RepositoryBaseline>{
  authorize(access,'project.write');
  const projectId=clean(input.projectId),repositoryId=clean(input.repositoryId),commitRefId=clean(input.commitRefId),commitSha=gitId(input.commitSha),treeSha=gitId(input.treeSha),manifestDigest=digest(input.manifestDigest);
  if(!projectId||!repositoryId||!commitRefId||!isGitObjectId(commitSha)||!isGitObjectId(treeSha)||!isSha256Digest(manifestDigest))fail('INVALID_REFERENCE','RepositoryBaseline contains an invalid immutable reference');
  assertProject(projectId,access.projectId);
  const [repository,commit]=await Promise.all([store.getRepositoryById(repositoryId),store.getCommitRefById(commitRefId)]);
  if(!repository||!commit)fail('NOT_FOUND','Repository or RepositoryCommitRef does not exist');
  assertProject(repository.projectId,projectId);assertProject(commit.projectId,projectId);
  assertRevision(repository.revision,input.expectedRepositoryRevision);
  if(commit.repositoryId!==repositoryId||commit.repositoryRevision!==repository.revision||commit.commitSha!==commitSha||commit.treeSha!==treeSha)fail('COMMIT_MISMATCH','RepositoryBaseline does not match the fixed RepositoryCommitRef');
  const candidate:RepositoryBaseline={id:runtime.randomId('baseline'),projectId,repositoryId,repositoryRevision:repository.revision,commitRefId,commitSha,treeSha,manifestDigest,createdAt:runtime.now().toISOString()};
  return store.insertBaseline(candidate);
}

export async function registerDeployment(store:DeploymentTargetStore,access:A02Access,input:{projectId:string;environmentId:string;expectedEnvironmentRevision:number;repositoryId:string;expectedRepositoryRevision:number;commitRefId:string;commitSha:string;treeSha:string;artifactDigest:string;configVersion:string;schemaVersion:string;providerDeploymentRef:string},runtime:A02Runtime=defaultRuntime):Promise<Deployment>{
  authorize(access,'project.write');
  const normalized={projectId:clean(input.projectId),environmentId:clean(input.environmentId),repositoryId:clean(input.repositoryId),commitRefId:clean(input.commitRefId),commitSha:gitId(input.commitSha),treeSha:gitId(input.treeSha),artifactDigest:digest(input.artifactDigest),configVersion:clean(input.configVersion,200),schemaVersion:clean(input.schemaVersion,200),providerDeploymentRef:clean(input.providerDeploymentRef,500)};
  if(!normalized.projectId||!normalized.environmentId||!normalized.repositoryId||!normalized.commitRefId||!isGitObjectId(normalized.commitSha)||!isGitObjectId(normalized.treeSha)||!isSha256Digest(normalized.artifactDigest)||!normalized.configVersion||!normalized.schemaVersion||!normalized.providerDeploymentRef)fail('INVALID_REFERENCE','Deployment contains an invalid immutable target reference');
  assertProject(normalized.projectId,access.projectId);
  const [environment,repository,commit]=await Promise.all([store.getEnvironmentById(normalized.environmentId),store.getRepositoryById(normalized.repositoryId),store.getCommitRefById(normalized.commitRefId)]);
  if(!environment||!repository||!commit)fail('NOT_FOUND','Environment, Repository or RepositoryCommitRef does not exist');
  assertProject(environment.projectId,normalized.projectId);assertProject(repository.projectId,normalized.projectId);assertProject(commit.projectId,normalized.projectId);
  assertRevision(environment.revision,input.expectedEnvironmentRevision);assertRevision(repository.revision,input.expectedRepositoryRevision);
  if(commit.repositoryId!==repository.id||commit.repositoryRevision!==repository.revision||commit.commitSha!==normalized.commitSha||commit.treeSha!==normalized.treeSha)fail('COMMIT_MISMATCH','Deployment commit does not match the fixed RepositoryCommitRef');
  const values:Omit<Deployment,'id'|'createdAt'>={projectId:normalized.projectId,environmentId:environment.id,environmentRevision:environment.revision,repositoryId:repository.id,repositoryRevision:repository.revision,commitRefId:commit.id,commitSha:commit.commitSha,treeSha:commit.treeSha,artifactDigest:normalized.artifactDigest,configVersion:normalized.configVersion,schemaVersion:normalized.schemaVersion,providerDeploymentRef:normalized.providerDeploymentRef};
  const existing=await store.getDeploymentByProviderRef(environment.id,normalized.providerDeploymentRef);
  if(existing){if(!sameDeploymentValues(existing,values))fail('IMMUTABLE_CONFLICT','Provider deployment identity is already bound to different immutable values');return existing;}
  const candidate:Deployment={id:runtime.randomId('deployment'),...values,createdAt:runtime.now().toISOString()};
  const persisted=await store.insertDeployment(candidate);
  if(!sameDeploymentValues(persisted,values))fail('IMMUTABLE_CONFLICT','Deployment was concurrently bound to different immutable values');
  return persisted;
}

export async function resolveVerificationTarget(store:DeploymentTargetStore,access:A02Access,input:{projectId:string;targetType:'COMMIT'|'DEPLOYMENT';targetId:string}):Promise<Readonly<VerificationTarget>>{
  authorize(access,'project.read');
  const projectId=clean(input.projectId),targetId=clean(input.targetId);
  if(!projectId||!targetId)fail('INVALID_REFERENCE','Verification target is incomplete');
  assertProject(projectId,access.projectId);
  if(input.targetType==='COMMIT'){
    const commit=await store.getCommitRefById(targetId);
    if(!commit)fail('NOT_FOUND','RepositoryCommitRef target does not exist');
    assertProject(commit.projectId,projectId);
    return Object.freeze({projectId,targetType:'COMMIT',targetId:commit.id,repositoryId:commit.repositoryId,commitRefId:commit.id,commitSha:commit.commitSha});
  }
  if(input.targetType==='DEPLOYMENT'){
    const deployment=await store.getDeploymentById(targetId);
    if(!deployment)fail('NOT_FOUND','Deployment target does not exist');
    assertProject(deployment.projectId,projectId);
    return Object.freeze({projectId,targetType:'DEPLOYMENT',targetId:deployment.id,repositoryId:deployment.repositoryId,commitRefId:deployment.commitRefId,commitSha:deployment.commitSha,environmentId:deployment.environmentId,artifactDigest:deployment.artifactDigest,configVersion:deployment.configVersion,schemaVersion:deployment.schemaVersion});
  }
  return fail('INVALID_REFERENCE','Unknown verification target type');
}
