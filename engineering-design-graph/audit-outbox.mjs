import {randomUUID} from 'node:crypto';
const now=()=>new Date().toISOString();
export function createAuditOutboxStore(){
  const auditLogs=[],outboxEvents=[];
  function record({principal,method,path,status,requestId,body}){
    const at=now(),actorUserId=principal?.userId||null;
    const audit={id:randomUUID(),actorUserId,action:`${method} ${path}`,status,requestId,metadata:{bodyKeys:body&&typeof body==='object'?Object.keys(body):[]},createdAt:at};
    auditLogs.push(audit);
    if(method!=='GET'&&method!=='HEAD'&&status>=200&&status<300){outboxEvents.push({id:randomUUID(),topic:'engineering-design-graph.mutation',aggregateType:'http_request',aggregateId:requestId,payload:{actorUserId,method,path,status,auditLogId:audit.id},status:'pending',createdAt:at,publishedAt:null});}
    return audit;
  }
  function markPublished(id){const e=outboxEvents.find(x=>x.id===id);if(e){e.status='published';e.publishedAt=now()}return e}
  return {auditLogs,outboxEvents,record,markPublished};
}
