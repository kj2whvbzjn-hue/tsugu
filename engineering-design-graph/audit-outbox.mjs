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
export function createAuditOutboxStore(){
  const auditLogs=[],outboxEvents=[];
  function record({principal,method,path,status,requestId,body}){
    const at=now(),actorUserId=principal?.userId||null;
    const audit={id:randomUUID(),actorUserId,action:`${method} ${path}`,status,requestId,metadata:{bodyKeys:body&&typeof body==='object'?Object.keys(body):[]},createdAt:at};
    auditLogs.push(audit);
    if(method!=='GET'&&method!=='HEAD'&&status>=200&&status<300){outboxEvents.push({id:randomUUID(),topic:classify(method,path),aggregateType:'http_request',aggregateId:requestId,payload:{actorUserId,method,path,status,auditLogId:audit.id},status:'pending',createdAt:at,publishedAt:null});}
    return audit;
  }
  function markPublished(id){const e=outboxEvents.find(x=>x.id===id);if(e){e.status='published';e.publishedAt=now()}return e}
  return {auditLogs,outboxEvents,record,markPublished};
}
