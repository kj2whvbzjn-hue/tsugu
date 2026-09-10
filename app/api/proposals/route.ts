import {database} from '@/db/store';
import {identityFromHeaders} from '@/app/identity';
import {getRecord,getProposal,describeProposal,submitProposal,type ProposalRow} from '@/app/proposal-store';
import {ProposalError} from '@/app/proposals';
import {z} from 'zod';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
function failure(e:unknown){
 if(e instanceof ProposalError)return json({error:e.message},e.status);
 if(e instanceof z.ZodError)return json({error:e.issues[0].message},400);
 console.error(e);return json({error:'変更案を取得・保存できません。再試行してください。'},503);
}
export async function GET(req:Request){
 const identity=await identityFromHeaders(req.headers);if(!identity)return json({error:'サインインが必要です'},401);
 try{
  const params=new URL(req.url).searchParams,id=params.get('id');
  if(id)return json(await describeProposal(identity,await getProposal(identity,id)));
  const projectId=z.string().uuid().parse(params.get('projectId'));
  const current=await getRecord(identity,projectId);
  const offset=z.number().int().min(0).max(100000).parse(Number(params.get('offset')||0));
  type SummaryRow=Pick<ProposalRow,'id'|'base_revision'|'status'|'created_at'|'applied_revision'>;
  const rows=await database().prepare("SELECT id,base_revision,status,created_at,applied_revision FROM proposals WHERE project_id=? AND owner IN (?,?) ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET ?").bind(projectId,...identity.keys,offset).all<SummaryRow>();
  const items=rows.results.slice(0,30).map((row:SummaryRow)=>({id:row.id,baseRevision:row.base_revision,status:row.status==='pending'&&row.base_revision!==current.revision?'conflict':row.status,createdAt:row.created_at,appliedRevision:row.applied_revision}));
  return json({items,currentRevision:current.revision,nextOffset:rows.results.length>30?offset+30:null});
 }catch(e){return failure(e)}
}
export async function POST(req:Request){
 const identity=await identityFromHeaders(req.headers);if(!identity)return json({error:'サインインが必要です'},401);
 // This is the human/browser entry point. Agent tools use the server service directly.
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'許可されていない操作です'},403);
 try{
  const text=await req.text();if(new TextEncoder().encode(text).length>132*1024)return json({error:'変更案は128KB以内に分けてください'},413);
  let input;try{input=JSON.parse(text)}catch{return json({error:'JSONの形式が不正です'},400)}
  const parsed=z.object({id:z.string().uuid(),proposal:z.unknown()}).strict().parse(input);
  return json(await submitProposal(identity,parsed.id,parsed.proposal));
 }catch(e){return failure(e)}
}
