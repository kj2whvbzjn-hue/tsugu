import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

async function load(file){
  const b=await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',write:false});
  return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
}

const auth=await load('app/vnext/server/auth-context.ts');
const authz=await load('app/vnext/server/authorization.ts');

const actor={id:'actor-1',subjectId:'subject-1',emailHash:'email:hash',createdAt:'2026-09-10T00:00:00.000Z'};
const role={id:'role-editor',projectId:'project-1',name:'editor',permissions:['project.read','project.write'],createdAt:'2026-09-10T00:00:00.000Z'};
const membership={id:'membership-1',projectId:'project-1',actorId:'actor-1',roleId:'role-editor',revision:3,createdAt:'2026-09-10T00:00:00.000Z'};
const principal={subjectId:'subject-1',emailHash:'email:hash'};

function expectCode(fn,code){assert.throws(fn,e=>e&&e.code===code);}

test('A-01 authentication fails closed and body actor or role claims cannot create authority',async()=>{
  await assert.rejects(()=>auth.requireAuthPrincipal(new Headers()),e=>e&&e.code==='UNAUTHENTICATED');
  const headers=new Headers({'oai-authenticated-user-id':' subject-1 ','oai-authenticated-user-email':'User@Example.COM'});
  const trusted=await auth.requireAuthPrincipal(headers);
  assert.equal(trusted.subjectId,'subject-1');
  assert.match(trusted.emailHash,/^email:[a-f0-9]{64}$/);
  const forgedBody={actor_id:'actor-admin',role:'admin',subjectId:'subject-attacker'};
  assert.equal(trusted.subjectId,'subject-1');
  assert.equal('role' in trusted,false);
  assert.equal('actor_id' in trusted,false);
  assert.equal(forgedBody.subjectId===trusted.subjectId,false);
});

test('A-01 project authorization rejects forged actor, cross-project access, stale policy and missing permission',()=>{
  expectCode(()=>authz.authorizeProjectAction({principal:{...principal,subjectId:'subject-attacker'},actor,membership,role,projectId:'project-1',requiredPermission:'project.read',policyVersion:4,expectedPolicyVersion:4}),'ACTOR_FORGERY');
  expectCode(()=>authz.authorizeProjectAction({principal,actor,membership,role,projectId:'project-2',requiredPermission:'project.read',policyVersion:4,expectedPolicyVersion:4}),'CROSS_PROJECT');
  expectCode(()=>authz.authorizeProjectAction({principal,actor,membership,role,projectId:'project-1',requiredPermission:'project.read',policyVersion:5,expectedPolicyVersion:4}),'STALE_POLICY');
  expectCode(()=>authz.authorizeProjectAction({principal,actor,membership,role,projectId:'project-1',requiredPermission:'membership.manage',policyVersion:4,expectedPolicyVersion:4}),'FORBIDDEN');
  const result=authz.authorizeProjectAction({principal,actor,membership,role,projectId:'project-1',requiredPermission:'project.write',policyVersion:4,expectedPolicyVersion:4});
  assert.deepEqual(result,{allowed:true,actorId:'actor-1',projectId:'project-1',permission:'project.write',policyVersion:4});
});

test('A-01 role assignment rejects self elevation even when request body asks for admin',()=>{
  const managerRole={...role,id:'role-manager',permissions:['project.read','project.write','membership.manage']};
  const managerMembership={...membership,roleId:'role-manager'};
  const adminRole={id:'role-admin',projectId:'project-1',name:'admin',permissions:['project.read','project.write','membership.manage','policy.manage','audit.read'],createdAt:role.createdAt};
  expectCode(()=>authz.authorizeRoleAssignment({principal,actor,membership:managerMembership,role:managerRole,projectId:'project-1',targetActorId:'actor-1',targetRole:adminRole,policyVersion:4,expectedPolicyVersion:4}),'SELF_ELEVATION');
});
