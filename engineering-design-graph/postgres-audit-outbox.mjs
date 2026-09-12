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
  async markPublished(id){const r=await this.client.query(`update outbox_events set published_at=now(),last_error=null where id=$1 returning *`,[id]);return r.rows[0]||null}
  async markFailed(id,error,{maxAttempts=8,baseDelaySeconds=30}={}){
    const msg=String(error?.message||error||'publish failed');
    const r=await this.client.query(`update outbox_events set attempt_count=attempt_count+1,last_error=$2,next_attempt_at=now()+make_interval(secs => least($3 * power(2,greatest(attempt_count,0))::int,3600)),dead_lettered_at=case when attempt_count+1 >= $4 then now() else dead_lettered_at end where id=$1 returning *`,[id,msg,baseDelaySeconds,maxAttempts]);
    return r.rows[0]||null;
  }
  async pending(limit=100){const r=await this.client.query(`select * from outbox_events where published_at is null and dead_lettered_at is null and next_attempt_at<=now() order by created_at,id limit $1`,[limit]);return r.rows}
  async deadLetters(limit=100){const r=await this.client.query(`select * from outbox_events where dead_lettered_at is not null order by dead_lettered_at desc,id limit $1`,[limit]);return r.rows}
}
