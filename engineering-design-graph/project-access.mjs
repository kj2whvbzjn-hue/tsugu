import {ROLE_PERMISSIONS} from './security.mjs';

export class ProjectAccessRepository{
  constructor(client){if(!client?.query)throw new Error('Postgres client with query() is required');this.client=client}
  async roleFor(projectId,userSubject){const r=await this.client.query('select role from project_members where project_id=$1 and user_subject=$2',[projectId,userSubject]);return r.rows[0]?.role||null}
  async upsertMember(projectId,userSubject,role){if(!ROLE_PERMISSIONS[role])throw new Error(`Unknown project role: ${role}`);const r=await this.client.query(`insert into project_members(project_id,user_subject,role) values($1,$2,$3) on conflict(project_id,user_subject) do update set role=excluded.role,updated_at=now() returning *`,[projectId,userSubject,role]);return r.rows[0]}
  async removeMember(projectId,userSubject){await this.client.query('delete from project_members where project_id=$1 and user_subject=$2',[projectId,userSubject])}
  async getPolicy(projectId){const r=await this.client.query('select policy from project_policies where project_id=$1',[projectId]);return r.rows[0]?.policy||{}}
  async setPolicy(projectId,policy,updatedBy){const r=await this.client.query(`insert into project_policies(project_id,policy,updated_by) values($1,$2::jsonb,$3) on conflict(project_id) do update set policy=excluded.policy,updated_by=excluded.updated_by,updated_at=now() returning *`,[projectId,JSON.stringify(policy||{}),updatedBy||null]);return r.rows[0]}
}

export async function authorizeProject({principal,projectId,permission,accessRepository}){
  if(principal?.roles?.includes('admin'))return true;
  const role=await accessRepository.roleFor(projectId,principal?.userId);if(!role)throw Object.assign(new Error('Project membership required'),{status:403,code:'PROJECT_FORBIDDEN'});
  if(!ROLE_PERMISSIONS[role]?.has(permission))throw Object.assign(new Error(`Project permission denied: ${permission}`),{status:403,code:'PROJECT_FORBIDDEN'});
  return true;
}
