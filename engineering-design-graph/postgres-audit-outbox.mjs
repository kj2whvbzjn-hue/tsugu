import {randomUUID} from 'node:crypto';

export class PostgresAuditOutboxStore{
  constructor(client){if(!client?.query)throw new Error('Postgres client with query() is required');this.client=client}
  async recordAudit({projectId=null,actorUserId=null,action,targetType='project',targetId=null,detail={},traceId=null}){
    const r=await this.client.query(`insert into audit_logs(project_id,actor_user_id,action,target_type,target_id,detail,trace_id) values($1,$2,$3,$4,$5,$6::jsonb,$7) returning *`,[projectId,actorUserId,action,targetType,targetId,JSON.stringify(detail||{}),traceId]);
    return r.rows[0];
  }
  async enqueue({id=randomUUID(),aggregateType,aggregateId,eventType,payload={}}){
    const r=await this.client.query(`insert into outbox_events(id,aggregate_type,aggregate_id,event_type,payload) values($1,$2,$3,$4,$5::jsonb) returning *`,[id,aggregateType,aggregateId,eventType,JSON.stringify(payload||{})]);
    return r.rows[0];
  }
  async markPublished(id){const r=await this.client.query('update outbox_events set published_at=now() where id=$1 returning *',[id]);return r.rows[0]||null}
  async pending(limit=100){const r=await this.client.query('select * from outbox_events where published_at is null order by created_at,id limit $1',[limit]);return r.rows}
}
