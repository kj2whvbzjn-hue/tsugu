import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createApiService} from './api-v1.mjs';
import {authorize,permissionForRequest} from './security.mjs';
import {createAuditOutboxStore} from './audit-outbox.mjs';

async function readJson(req){const chunks=[];for await(const c of req)chunks.push(c);if(!chunks.length)return{};const text=Buffer.concat(chunks).toString('utf8');return text?JSON.parse(text):{}}
function send(res,status,headers,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(body))}

export function createHttpGateway({api=createApiService(),verifyBearer,auditOutbox=createAuditOutboxStore()}={}){
  if(!verifyBearer)throw new Error('verifyBearer is required');
  const handler=async(req,res)=>{
    const requestId=req.headers['x-request-id']||randomUUID(),url=new URL(req.url,'http://local'),method=(req.method||'GET').toUpperCase();
    let principal=null,body={};
    try{
      principal=await verifyBearer(req.headers.authorization);
      authorize(principal,permissionForRequest(method,url.pathname));
      if(method!=='GET'&&method!=='HEAD')body=await readJson(req);
      const response=await api.handle({method,url:url.pathname+url.search,body,headers:{...req.headers,'x-user-id':principal.userId,'x-request-id':requestId}});
      await auditOutbox.record({principal,method,path:url.pathname,status:response.status,requestId,body});
      send(res,response.status,{'x-request-id':requestId,...response.headers},response.body);
    }catch(err){
      const status=err.status||500,code=err.code||'REQUEST_FAILED',problem={type:`https://errors.local/${String(code).toLowerCase().replaceAll('_','-')}`,title:err.message,status,code,traceId:requestId,errors:[]};
      try{await auditOutbox.record({principal,method,path:url.pathname,status,requestId,body})}catch{}
      send(res,status,{'x-request-id':requestId},problem);
    }
  };
  return {handler,api,auditOutbox,listen(port=4180,host='127.0.0.1'){const server=http.createServer(handler);return new Promise(resolve=>server.listen(port,host,()=>resolve(server)))}};
}
