import {identityFromHeaders} from '@/app/identity';
import {tools,callTool} from '@/app/mcp-tools';
import {ProposalError} from '@/app/proposals';
import {z} from 'zod';
export const dynamic='force-dynamic';
const versions=['2025-11-25','2025-06-18','2025-03-26'];
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const error=(id:unknown,code:number,message:string,status=200)=>json({jsonrpc:'2.0',id,error:{code,message}},status);

/** Stateless Streamable HTTP. Sites dispatch must authenticate before forwarding.
 * No app-issued tokens, arbitrary identity headers, browser cookies or secrets
 * are copied into agent configuration. Platform registration is a separate step.
 */
export async function POST(req:Request){
 const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return error(null,-32600,'許可されていない送信元です',403);
 const identity=await identityFromHeaders(req.headers);if(!identity)return error(null,-32001,'サインインが必要です',401);
 const version=req.headers.get('mcp-protocol-version');if(version&&!versions.includes(version))return error(null,-32600,'Unsupported protocol version',400);
 const text=await req.text();if(new TextEncoder().encode(text).length>132*1024)return error(null,-32600,'変更案は128KB以内に分けてください',413);
 let msg;try{msg=JSON.parse(text)}catch{return error(null,-32700,'Parse error',400)}
 if(!msg||Array.isArray(msg)||msg.jsonrpc!=='2.0'||typeof msg.method!=='string'||(msg.id!==undefined&&typeof msg.id!=='string'&&typeof msg.id!=='number'))return error(null,-32600,'Invalid Request',400);
 if(msg.id===undefined){
  if(!['notifications/initialized','notifications/cancelled'].includes(msg.method))return error(null,-32600,'Unsupported notification',400);
  return new Response(null,{status:202});
 }
 try{
  let result:unknown;
  switch(msg.method){
   case 'initialize':{
    const params=z.object({protocolVersion:z.string(),capabilities:z.object({}).passthrough(),clientInfo:z.object({name:z.string(),version:z.string()}).passthrough()}).passthrough().parse(msg.params);
    result={protocolVersion:versions.includes(params.protocolVersion)?params.protocolVersion:versions[0],capabilities:{tools:{listChanged:false}},serverInfo:{name:'tsugu',version:'0.1.0'},instructions:'案件は本人所有のものだけを扱います。変更は提案として保存され、本人が継ぐで反映するまで案件に反映されません。'};break;
   }
   case 'ping':result={};break;
   case 'tools/list':result={tools};break;
   case 'tools/call':{
    const params=z.object({name:z.string(),arguments:z.unknown().optional()}).passthrough().parse(msg.params);
    try{const data=await callTool(identity,params.name,params.arguments??{});result={content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};}
    catch(e){if(!(e instanceof ProposalError)&&!(e instanceof z.ZodError))console.error(e);result={isError:true,content:[{type:'text',text:e instanceof ProposalError?e.message:e instanceof z.ZodError?e.issues[0].message:'保存サービスを利用できません。同じ提案IDで再試行してください。'}]};}break;
   }
   default:return error(msg.id,-32601,'Method not found');
  }
  return json({jsonrpc:'2.0',id:msg.id,result});
 }catch(e){if(e instanceof z.ZodError)return error(msg.id,-32602,'Invalid params');console.error(e);return error(msg.id,-32603,'Internal error');}
}
// No sessions or server-initiated events are needed for these tools.
export function GET(){return new Response(null,{status:405,headers:{Allow:'POST'}})}
export function DELETE(){return new Response(null,{status:405,headers:{Allow:'POST'}})}
