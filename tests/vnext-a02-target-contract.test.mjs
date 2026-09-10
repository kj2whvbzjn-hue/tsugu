import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

async function load(file){
  const b=await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',write:false});
  return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
}

const service=await load('app/vnext/server/deployment-target-service.ts');

const actor={id:'actor-1',subjectId:'subject-1',emailHash:'',createdAt:'2026-09-11T00:00:00.000Z'};
const role={id:'role-writer',projectId:'project-1',name:'writer',permissions:['project.read','project.write'],createdAt:actor.createdAt};
const membership={id:'membership-1',projectId:'project-1',actorId:actor.id,roleId:role.id,revision:1,createdAt:actor.createdAt};
const access={principal:{subjectId:'subject-1',emailHash:''},actor,membership,role,projectId:'project-1',policyVersion:1,expectedPolicyVersion:1};

function fakeStore(){
  const maps={repositories:new Map(),environments:new Map(),commits:new Map(),baselines:new Map(),deployments:new Map()};
  return {
    maps,
    async getRepositoryById(id){return maps.repositories.get(id)||null;},
    async getRepositoryByIdentity(projectId,provider,externalRef){return [...maps.repositories.values()].find(x=>x.projectId===projectId&&x.provider===provider&&x.externalRef===externalRef)||null;},
    async insertRepository(value){maps.repositories.set(value.id,value);return value;},
    async getEnvironmentById(id){return maps.environments.get(id)||null;},
    async getEnvironmentByKey(projectId,key){return [...maps.environments.values()].find(x=>x.projectId===projectId&&x.key===key)||null;},
    async insertEnvironment(value){maps.environments.set(value.id,value);return value;},
    async getCommitRefById(id){return maps.commits.get(id)||null;},
    async getCommitRefByRepositorySha(repositoryId,commitSha){return [...maps.commits.values()].find(x=>x.repositoryId===repositoryId&&x.commitSha===commitSha)||null;},
    async insertCommitRef(value){maps.commits.set(value.id,value);return value;},
    async getBaselineById(id){return maps.baselines.get(id)||null;},
    async insertBaseline(value){maps.baselines.set(value.id,value);return value;},
    async getDeploymentById(id){return maps.deployments.get(id)||null;},
    async getDeploymentByProviderRef(environmentId,providerDeploymentRef){return [...maps.deployments.values()].find(x=>x.environmentId===environmentId&&x.providerDeploymentRef===providerDeploymentRef)||null;},
    async insertDeployment(value){maps.deployments.set(value.id,value);return value;},
  };
}

const runtime=(()=>{let n=0;return {now:()=>new Date('2026-09-11T00:00:00.000Z'),randomId:prefix=>`${prefix}-${++n}`};})();

async function expectCode(promise,code){await assert.rejects(promise,e=>e&&e.code===code);}

test('A-02 repository+SHA identity is scoped, stable, and does not conflate equal SHA across repositories',async()=>{
  const store=fakeStore();
  const repo1=await service.registerRepository(store,access,{projectId:'project-1',provider:'github',externalRef:'repo-one'},runtime);
  const repo2=await service.registerRepository(store,access,{projectId:'project-1',provider:'github',externalRef:'repo-two'},runtime);
  const sha='a'.repeat(40),tree='b'.repeat(40);
  const c1=await service.registerRepositoryCommitRef(store,access,{projectId:'project-1',repositoryId:repo1.id,expectedRepositoryRevision:1,commitSha:sha,treeSha:tree},runtime);
  const c1again=await service.registerRepositoryCommitRef(store,access,{projectId:'project-1',repositoryId:repo1.id,expectedRepositoryRevision:1,commitSha:sha,treeSha:tree},runtime);
  const c2=await service.registerRepositoryCommitRef(store,access,{projectId:'project-1',repositoryId:repo2.id,expectedRepositoryRevision:1,commitSha:sha,treeSha:tree},runtime);
  assert.equal(c1again.id,c1.id);
  assert.notEqual(c2.id,c1.id);
  await expectCode(service.registerRepositoryCommitRef(store,access,{projectId:'project-1',repositoryId:repo1.id,expectedRepositoryRevision:1,commitSha:sha,treeSha:'c'.repeat(40)},runtime),'IMMUTABLE_CONFLICT');
});

test('A-02 rejects cross-project, stale revision and commit/tree mismatches fail closed',async()=>{
  const store=fakeStore();
  const repo=await service.registerRepository(store,access,{projectId:'project-1',provider:'github',externalRef:'repo-one'},runtime);
  const env=await service.registerEnvironment(store,access,{projectId:'project-1',key:'production'},runtime);
  const commit=await service.registerRepositoryCommitRef(store,access,{projectId:'project-1',repositoryId:repo.id,expectedRepositoryRevision:1,commitSha:'1'.repeat(40),treeSha:'2'.repeat(40)},runtime);
  await expectCode(service.registerRepositoryCommitRef(store,access,{projectId:'project-2',repositoryId:repo.id,expectedRepositoryRevision:1,commitSha:'3'.repeat(40),treeSha:'4'.repeat(40)},runtime),'CROSS_PROJECT');
  await expectCode(service.registerRepositoryCommitRef(store,access,{projectId:'project-1',repositoryId:repo.id,expectedRepositoryRevision:2,commitSha:'3'.repeat(40),treeSha:'4'.repeat(40)},runtime),'STALE_INPUT');
  await expectCode(service.registerRepositoryBaseline(store,access,{projectId:'project-1',repositoryId:repo.id,expectedRepositoryRevision:1,commitRefId:commit.id,commitSha:commit.commitSha,treeSha:'f'.repeat(40),manifestDigest:`sha256:${'5'.repeat(64)}`},runtime),'COMMIT_MISMATCH');
  await expectCode(service.registerDeployment(store,access,{projectId:'project-1',environmentId:env.id,expectedEnvironmentRevision:2,repositoryId:repo.id,expectedRepositoryRevision:1,commitRefId:commit.id,commitSha:commit.commitSha,treeSha:commit.treeSha,artifactDigest:`sha256:${'6'.repeat(64)}`,configVersion:'cfg-1',schemaVersion:'0007',providerDeploymentRef:'deployment-1'},runtime),'STALE_INPUT');
});

test('A-02 deployments and verification targets are immutable while same commit may be redeployed separately',async()=>{
  const store=fakeStore();
  const repo=await service.registerRepository(store,access,{projectId:'project-1',provider:'github',externalRef:'repo-one'},runtime);
  const env=await service.registerEnvironment(store,access,{projectId:'project-1',key:'production'},runtime);
  const commit=await service.registerRepositoryCommitRef(store,access,{projectId:'project-1',repositoryId:repo.id,expectedRepositoryRevision:1,commitSha:'7'.repeat(40),treeSha:'8'.repeat(40)},runtime);
  const base={projectId:'project-1',environmentId:env.id,expectedEnvironmentRevision:1,repositoryId:repo.id,expectedRepositoryRevision:1,commitRefId:commit.id,commitSha:commit.commitSha,treeSha:commit.treeSha,artifactDigest:`sha256:${'9'.repeat(64)}`,configVersion:'cfg-1',schemaVersion:'0007'};
  const d1=await service.registerDeployment(store,access,{...base,providerDeploymentRef:'deployment-1'},runtime);
  const d1again=await service.registerDeployment(store,access,{...base,providerDeploymentRef:'deployment-1'},runtime);
  const d2=await service.registerDeployment(store,access,{...base,providerDeploymentRef:'deployment-2'},runtime);
  assert.equal(d1again.id,d1.id);
  assert.notEqual(d2.id,d1.id);
  await expectCode(service.registerDeployment(store,access,{...base,providerDeploymentRef:'deployment-1',artifactDigest:`sha256:${'a'.repeat(64)}`},runtime),'IMMUTABLE_CONFLICT');
  const target=await service.resolveVerificationTarget(store,access,{projectId:'project-1',targetType:'DEPLOYMENT',targetId:d1.id});
  assert.equal(Object.isFrozen(target),true);
  assert.deepEqual(target,{projectId:'project-1',targetType:'DEPLOYMENT',targetId:d1.id,repositoryId:repo.id,commitRefId:commit.id,commitSha:commit.commitSha,environmentId:env.id,artifactDigest:base.artifactDigest,configVersion:'cfg-1',schemaVersion:'0007'});
  assert.throws(()=>{target.targetId=d2.id;},TypeError);
  await expectCode(service.resolveVerificationTarget(store,{...access,projectId:'project-2',role:{...role,projectId:'project-2'},membership:{...membership,projectId:'project-2'}},{projectId:'project-2',targetType:'DEPLOYMENT',targetId:d1.id}),'CROSS_PROJECT');
});
