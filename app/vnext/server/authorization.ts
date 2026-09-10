import type {Actor,AuthPrincipal,Permission,ProjectMembership,Role} from '../domain/identity';
import {A01SecurityError} from './auth-context';

export type AuthorizationInput={
  principal:AuthPrincipal;
  actor:Actor;
  membership:ProjectMembership;
  role:Role;
  projectId:string;
  requiredPermission:Permission;
  policyVersion:number;
  expectedPolicyVersion:number;
};

export type AuthorizationResult={allowed:true;actorId:string;projectId:string;permission:Permission;policyVersion:number};

export function authorizeProjectAction(input:AuthorizationInput):AuthorizationResult{
  if(!input.principal?.subjectId)throw new A01SecurityError('UNAUTHENTICATED','Authenticated principal is required');
  if(input.actor.subjectId!==input.principal.subjectId)throw new A01SecurityError('ACTOR_FORGERY','Authenticated subject does not match the Actor');
  if(input.membership.projectId!==input.projectId||input.role.projectId!==input.projectId)throw new A01SecurityError('CROSS_PROJECT','Project scope does not match');
  if(input.membership.actorId!==input.actor.id||input.membership.roleId!==input.role.id)throw new A01SecurityError('FORBIDDEN','Membership does not authorize this Actor and Role');
  if(!Number.isSafeInteger(input.policyVersion)||!Number.isSafeInteger(input.expectedPolicyVersion)||input.policyVersion<1||input.expectedPolicyVersion<1||input.policyVersion!==input.expectedPolicyVersion){
    throw new A01SecurityError('STALE_POLICY','Policy precondition does not match');
  }
  if(!input.role.permissions.includes(input.requiredPermission))throw new A01SecurityError('FORBIDDEN','Required permission is not granted');
  return {allowed:true,actorId:input.actor.id,projectId:input.projectId,permission:input.requiredPermission,policyVersion:input.policyVersion};
}

export type RoleAssignmentInput=Omit<AuthorizationInput,'requiredPermission'> & {
  targetActorId:string;
  targetRole:Role;
};

export function authorizeRoleAssignment(input:RoleAssignmentInput):AuthorizationResult{
  const result=authorizeProjectAction({...input,requiredPermission:'membership.manage'});
  if(input.targetRole.projectId!==input.projectId)throw new A01SecurityError('CROSS_PROJECT','Target Role belongs to another Project');
  if(input.targetActorId===input.actor.id){
    const current=new Set(input.role.permissions);
    if(input.targetRole.permissions.some(permission=>!current.has(permission))){
      throw new A01SecurityError('SELF_ELEVATION','Actor cannot grant itself additional permissions');
    }
  }
  return result;
}
