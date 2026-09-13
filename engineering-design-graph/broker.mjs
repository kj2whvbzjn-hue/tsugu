import {createHmac} from 'node:crypto';

export function createInMemoryBroker(){const messages=[];return{messages,async publish(event){messages.push(structuredClone(event));return{ok:true,id:event.id}}}}

export function createHttpBroker({url,secret=null,fetchImpl=globalThis.fetch,timeoutMs=5000,headers={}}={}){
  if(!url)throw new Error('Broker URL is required');if(!fetchImpl)throw new Error('fetch implementation is required');
  return{async publish(event){const envelope={specversion:'1.0',id:event.id,type:event.type,source:'engineering-design-graph',subject:`${event.aggregateType}/${event.aggregateId}`,time:event.createdAt||new Date().toISOString(),data:event.payload||{}};const body=JSON.stringify(envelope),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{const h={'content-type':'application/cloudevents+json',...headers};if(secret)h['x-edg-signature']=`sha256=${createHmac('sha256',secret).update(body).digest('hex')}`;const response=await fetchImpl(url,{method:'POST',headers:h,body,signal:controller.signal});if(!response.ok)throw Object.assign(new Error(`Broker publish failed: ${response.status}`),{status:response.status});return{ok:true,status:response.status,id:event.id}}finally{clearTimeout(timer)}}};
}
