import {createHash} from 'node:crypto';

export const idempotencyTargetPath=path=>/\/change-sets\/[^/]+\/apply$/.test(path)||/\/ai\/requests$/.test(path)||/\/implementation-packages$/.test(path);
export const idempotencyFingerprint=(method,path,body)=>createHash('sha256').update(`${method}\n${path}\n${JSON.stringify(body??{})}`).digest('hex');
export const idempotencyScope=({principal,method,path,key})=>`${principal?.userId||'anonymous'}:${method}:${path}:${key}`;
const inProgress=()=>Object.assign(new Error('Idempotency-Key request is already in progress'),{status:409,code:'IDEMPOTENCY_IN_PROGRESS'});

export function createIdempotencyStore(){
  const records=new Map();
  return {
    appliesTo(method,path){return String(method).toUpperCase()==='POST'&&idempotencyTargetPath(path)},
    lookup({principal,method,path,key,body}){
      if(!key)return null;
      const scope=idempotencyScope({principal,method,path,key}),fp=idempotencyFingerprint(method,path,body),existing=records.get(scope);
      if(!existing){records.set(scope,{fingerprint:fp,state:'pending',response:null,createdAt:new Date().toISOString()});return{scope,fingerprint:fp,hit:false,reserved:true}}
      if(existing.fingerprint!==fp)throw Object.assign(new Error('Idempotency-Key reused with different request payload'),{status:409,code:'IDEMPOTENCY_CONFLICT'});
      if(existing.state==='pending')throw inProgress();
      return{...existing,scope,hit:true,reserved:false};
    },
    store({scope,fingerprint:fp,response}){records.set(scope,{fingerprint:fp,state:'completed',response:structuredClone(response),createdAt:records.get(scope)?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()});return records.get(scope)},
    release(scope){const existing=records.get(scope);if(existing?.state==='pending')records.delete(scope)},
    records
  };
}
