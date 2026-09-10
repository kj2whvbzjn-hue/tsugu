export type AuditResult='ALLOW'|'DENY';

export type AuditEvent={
  readonly id:string;
  readonly actorId:string;
  readonly subjectId:string;
  readonly projectId:string;
  readonly action:string;
  readonly policyVersion:number|null;
  readonly resourceRevision:number|null;
  readonly result:AuditResult;
  readonly reasonCode:string;
  readonly detailsJson:string;
  readonly createdAt:string;
};

export type AuditInput={
  actorId?:string;
  subjectId:string;
  projectId?:string;
  action:string;
  policyVersion?:number|null;
  resourceRevision?:number|null;
  result:AuditResult;
  reasonCode?:string;
  details?:Record<string,unknown>;
};

export type AuditRuntime={now:()=>Date;randomId:(prefix:string)=>string};
export type AuditStore={appendAudit:(event:AuditEvent)=>Promise<void>};

const defaultRuntime:AuditRuntime={
  now:()=>new Date(),
  randomId:(prefix)=>`${prefix}-${crypto.randomUUID()}`,
};

function bounded(value:string,max:number,label:string){
  const text=String(value??'').trim();
  if(!text||text.length>max)throw new Error(`${label} is invalid`);
  return text;
}

export function createAuditEvent(input:AuditInput,runtime:AuditRuntime=defaultRuntime):AuditEvent{
  const subjectId=bounded(input.subjectId,200,'subjectId');
  const action=bounded(input.action,200,'action');
  const reasonCode=String(input.reasonCode??'').trim().slice(0,100);
  const detailsJson=JSON.stringify(input.details??{});
  if(detailsJson.length>20000)throw new Error('audit details are too large');
  const event:AuditEvent={
    id:runtime.randomId('audit'),
    actorId:String(input.actorId??'').trim(),
    subjectId,
    projectId:String(input.projectId??'').trim(),
    action,
    policyVersion:input.policyVersion??null,
    resourceRevision:input.resourceRevision??null,
    result:input.result,
    reasonCode,
    detailsJson,
    createdAt:runtime.now().toISOString(),
  };
  return Object.freeze(event);
}

export async function appendAudit(store:AuditStore,input:AuditInput,runtime:AuditRuntime=defaultRuntime){
  const event=createAuditEvent(input,runtime);
  await store.appendAudit(event);
  return event;
}
