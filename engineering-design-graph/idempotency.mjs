import {createHash} from 'node:crypto';

const targetPath=path=>/\/change-sets\/[^/]+\/apply$/.test(path)||/\/ai\/requests$/.test(path)||/\/implementation-packages$/.test(path);
const fingerprint=(method,path,body)=>createHash('sha256').update(`${method}\n${path}\n${JSON.stringify(body??{})}`).digest('hex');

export function createIdempotencyStore(){
  const records=new Map();
  return {
    appliesTo(method,path){return String(method).toUpperCase()==='POST'&&targetPath(path)},
    lookup({principal,method,path,key,body}){
      if(!key)return null;
      const scope=`${principal?.userId||'anonymous'}:${method}:${path}:${key}`,fp=fingerprint(method,path,body),existing=records.get(scope);
      if(!existing)return{scope,fingerprint:fp,hit:false};
      if(existing.fingerprint!==fp)throw Object.assign(new Error('Idempotency-Key reused with different request payload'),{status:409,code:'IDEMPOTENCY_CONFLICT'});
      return{...existing,scope,hit:true};
    },
    store({scope,fingerprint:fp,response}){records.set(scope,{fingerprint:fp,response:structuredClone(response),createdAt:new Date().toISOString()});return records.get(scope)},
    records
  };
}
