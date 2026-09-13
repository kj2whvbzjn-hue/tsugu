import {randomUUID} from 'node:crypto';
const now=()=>new Date().toISOString();
function classify(method,path){
  if(/\/artifacts\//.test(path)&&method==='PATCH')return'artifact.updated';
  if(/\/artifacts$/.test(path)&&method==='POST')return'artifact.created';
  if(/\/relations$/.test(path)&&method==='POST')return'relation.created';
  if(/\/change-sets\/.+\/apply$/.test(path))return'changeset.applied';
  if(/\/ai\/candidates\/.+\/accept$/.test(path))return'ai.candidate.accepted';
  if(/\/ai\/candidates\/.+\/reject$/.test(path))return'ai.candidate.rejected';
  if(/\/ai\/requests$/.test(path))return'ai.requested';
  if(/\/readiness\/(evaluate|snapshot)$/.test(path))return'readiness.changed';
  if(/\/implementation-packages$/.test(path))return'export.package.generated';
  if(/\/validations\/.+/.test(path))return'validation.completed';
  return'engineering-design-graph.mutation';
}
function target(path){const m=path.match(/\/api\/v1\/(projects|artifacts|change-sets|ai\/candidates)\/([^/]+)/);return m?{type:m[1],id:m[2]}:{type:'http_request',id:null}}
export function createAuditOutboxStore(){
  const auditLogs=[],outboxEvents=[];
  function record({principal,method,path,status,requestId,body,replayed=false,projectId=null}){
    const at=now(),actorUserId=principal?.userId||null,t=target(path);
    const audit={id:randomUUID(),projectId,actorUserId,action:`${method} ${path}`,targetType:t.type,targetId:t.id,status,requestId,replayed,metadata:{bodyKeys:body&&typeof body==='object'?Object.keys(body):[]},createdAt:at};
    auditLogs.push(audit);
    if(!replayed&&method!=='GET'&&method!=='HEAD'&&status>=200&&status<300){outboxEvents.push({id:randomUUID(),topic:classify(method,path),aggregateType:t.type,aggregateId:t.id||requestId,payload:{projectId,actorUserId,method,path,status,auditLogId:audit.id},status:'pending',createdAt:at,publishedAt:null});}
    return audit;
  }
  function markPublished(id){const e=outboxEvents.find(x=>x.id===id);if(e){e.status='published';e.publishedAt=now()}return e}
  return {auditLogs,outboxEvents,record,markPublished};
}

export class PostgresAuditOutboxStore{
  constructor(client){if(!client?.query)throw new Error('Postgres client with query() is required');this.client=client}
  async record({principal,method,path,status,requestId,body,replayed=false,projectId=null}){
    const actorUserId=principal?.userId||null,t=target(path),detail={status,replayed,bodyKeys:body&&typeof body==='object'?Object.keys(body):[]};
    const a=await this.client.query(`insert into audit_logs(project_id,actor_user_id,action,target_type,target_id,detail,trace_id) values($1,$2,$3,$4,$5,$6::jsonb,$7) returning id,created_at`,[projectId,actorUserId,`${method} ${path}`,t.type,t.id,JSON.stringify(detail),requestId]);
    if(!replayed&&method!=='GET'&&method!=='HEAD'&&status>=200&&status<300){
      const eventId=randomUUID(),aggregateId=t.id||requestId,payload={projectId,actorUserId,method,path,status,auditLogId:a.rows[0]?.id||null};
      await this.client.query(`insert into outbox_events(id,aggregate_type,aggregate_id,event_type,payload) values($1,$2,$3,$4,$5::jsonb)`,[eventId,t.type,aggregateId,classify(method,path),JSON.stringify(payload)]);
    }
    return {id:a.rows[0]?.id,projectId,actorUserId,action:`${method} ${path}`,targetType:t.type,targetId:t.id,status,requestId,replayed,metadata:detail,createdAt:a.rows[0]?.created_at||now()};
  }
  async markPublished(id){const r=await this.client.query('update outbox_events set published_at=now() where id=$1 returning *',[id]);return r.rows[0]||null}
}
