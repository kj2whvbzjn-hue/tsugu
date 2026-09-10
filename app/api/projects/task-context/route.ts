import {identityFromHeaders} from '@/app/identity';
import {getTaskPack,getMetadataProposal,getAllMetadataProposal,getSourceMaterial,taskRequest,materialRequest} from '@/app/task-store';
import {ProposalError} from '@/app/proposals';
import {z} from 'zod';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const identity=await identityFromHeaders(req.headers);if(!identity)return Response.json({error:'サインインが必要です'},{status:401});
 try{
  const params=new URL(req.url).searchParams,common={projectId:params.get('projectId'),baseRevision:Number(params.get('baseRevision'))};
  const base=z.object({projectId:z.string().uuid(),baseRevision:z.number().int().positive()}).parse(common);
  let result;
  switch(params.get('kind')){
   case 'metadata':result=await getMetadataProposal(identity,base.projectId,base.baseRevision,z.string().min(1).max(300).parse(params.get('taskId')));break;
   case 'metadata-all':result=await getAllMetadataProposal(identity,base.projectId,base.baseRevision);break;
   case 'material':result=await getSourceMaterial(identity,materialRequest.parse({...base,section:params.get('section'),...(params.has('id')?{id:params.get('id')}:{}),offset:Number(params.get('offset')||0)}));break;
   default:result=await getTaskPack(identity,taskRequest.parse({...base,taskId:params.get('taskId')}));
  }
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){if(!(e instanceof ProposalError)&&!(e instanceof z.ZodError))console.error(e);return Response.json({error:e instanceof ProposalError?e.message:e instanceof z.ZodError?'取得対象・版・資料IDを確認してください':'作業資料を取得できません。再試行してください。'},{status:e instanceof ProposalError?e.status:e instanceof z.ZodError?400:503});}
}
