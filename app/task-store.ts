import {database,originalBucket} from '@/db/store';
import {getRecord,type Identity} from './proposal-store';
import {ProposalError} from './proposals';
import {materialSections,type MaterialRef} from './task-contract';
import {buildTaskPack,resolveMaterial,type MaterialEntry} from './task-pack';
import {taskMetadataProposal} from './task-import';
import {z} from 'zod';

export const taskRequest=z.object({projectId:z.string().uuid(),baseRevision:z.number().int().positive(),taskId:z.string().min(1).max(300)}).strict();
export async function currentRecord(identity:Identity,projectId:string,baseRevision:number){const record=await getRecord(identity,projectId);if(record.revision!==baseRevision)throw new ProposalError('案件が更新されています。最新版を取得してください。',409);return record;}
export async function readOriginal(identity:Identity,projectId:string){
 const ref=await database().prepare('SELECT object_key FROM original_files WHERE project_id=? AND owner IN (?,?)').bind(projectId,...identity.keys).first<{object_key:string}>();
 if(!ref)throw new ProposalError('元資料がありません。元JSON付きバックアップを確認してください。',404);
 const file=await originalBucket().get(ref.object_key);if(!file)throw new ProposalError('元資料を取得できません。再試行してください。',503);
 const text=await new Response(file.body).text(),data=JSON.parse(text) as Record<string,unknown>;
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)),sha256=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
 return {data,sha256};
}
async function originalForRecord(identity:Identity,record:Awaited<ReturnType<typeof getRecord>>){
 const original=await readOriginal(identity,record.project.id);
 if(!record.project.sourceInfo||(original.data.workspace as {id?:string})?.id!==record.project.sourceInfo.projectId)throw new ProposalError('元資料と案件情報が一致しません',409);
 return original;
}
export async function getTaskPack(identity:Identity,input:z.infer<typeof taskRequest>){
 const record=await currentRecord(identity,input.projectId,input.baseRevision);
 const original=record.project.sourceInfo?await originalForRecord(identity,record):undefined;
 const materials:MaterialEntry[]=[],errors:string[]=[],external=new Map<string,{record:Awaited<ReturnType<typeof getRecord>>;original:Awaited<ReturnType<typeof readOriginal>>}>();
 for(const reference of record.project.items.find(i=>i.id===input.taskId)?.task?.references||[]){
  let source=original,sourceId=input.projectId,revision=input.baseRevision;
  if(reference.projectId){
   const key=JSON.stringify([reference.projectId,reference.baseRevision]);
   let other=external.get(key);
   if(!other){const otherRecord=await currentRecord(identity,reference.projectId,reference.baseRevision!);other={record:otherRecord,original:await originalForRecord(identity,otherRecord)};external.set(key,other);}
   source=other.original;sourceId=other.record.project.id;revision=other.record.revision;
  }
  try{if(!source)throw Error('元資料がありません');materials.push({reference,content:resolveMaterial(source.data,reference),projectId:sourceId,baseRevision:revision,originalSha256:source.sha256});}catch(e){errors.push((e as Error).message);}
 }
 let result;try{result=buildTaskPack(record,input.taskId,original?.data,original?.sha256,materials,errors);}catch(e){throw new ProposalError((e as Error).message,422);}
 for(const other of external.values())await currentRecord(identity,other.record.project.id,other.record.revision);
 await currentRecord(identity,input.projectId,input.baseRevision);return result;
}
export async function getMetadataProposal(identity:Identity,projectId:string,baseRevision:number,taskId:string){
 const record=await currentRecord(identity,projectId,baseRevision),original=await originalForRecord(identity,record);
 let result;try{result=taskMetadataProposal(record.project,original.data);}catch(e){throw new ProposalError((e as Error).message,422);}
 await currentRecord(identity,projectId,baseRevision);
 result.upserts=result.upserts.filter(i=>i.id===taskId);
 result.warnings=result.warnings.filter(w=>w.startsWith(taskId+':'));
 if(!result.upserts.length)throw new ProposalError('この作業には補完できる元タスクがないか、作業条件が既に登録されています',422);
 return {proposal:{projectId,baseRevision,summary:'元資料から未登録の作業条件を補う（承認は引き継ぎません）',changes:{},upserts:result.upserts},warnings:result.warnings,originalSha256:original.sha256};
}
export async function getAllMetadataProposal(identity:Identity,projectId:string,baseRevision:number){
 const record=await currentRecord(identity,projectId,baseRevision),original=await originalForRecord(identity,record);
 let result;try{result=taskMetadataProposal(record.project,original.data);}catch(e){throw new ProposalError((e as Error).message,422);}
 await currentRecord(identity,projectId,baseRevision);
 if(!result.upserts.length)throw new ProposalError('補完できる未登録の作業条件はありません',422);
 return {proposal:{projectId,baseRevision,summary:`元資料から${result.upserts.length}件の作業条件を一括補完する（承認は引き継ぎません）`,changes:{},upserts:result.upserts},warnings:result.warnings,updatedTasks:result.upserts.length,originalSha256:original.sha256};
}
export const materialRequest=z.object({projectId:z.string().uuid(),baseRevision:z.number().int().positive(),section:z.enum(materialSections),id:z.string().min(1).max(300).optional(),offset:z.number().int().min(0).max(10000000).default(0)}).strict();
export async function getSourceMaterial(identity:Identity,input:z.infer<typeof materialRequest>){
 const record=await currentRecord(identity,input.projectId,input.baseRevision),original=await originalForRecord(identity,record);
 await currentRecord(identity,input.projectId,input.baseRevision);
 const common={projectId:input.projectId,baseRevision:input.baseRevision,originalSha256:original.sha256,sourceRole:'imported_snapshot',section:input.section};
 if(input.id){
  let data;try{data=resolveMaterial(original.data,{section:input.section,id:input.id} as MaterialRef);}catch(e){throw new ProposalError((e as Error).message,404);}
  const text=JSON.stringify(data,null,2),end=Math.min(input.offset+16000,text.length);
  if(input.offset>text.length)throw new ProposalError('本文の開始位置が範囲外です');
  return {...common,id:input.id,text:text.slice(input.offset,end),offset:input.offset,nextOffset:end<text.length?end:null,totalCharacters:text.length,complete:input.offset===0&&end===text.length};
 }
 const group=original.data[input.section],rows=Array.isArray(group)?group:group?[{id:'$',title:input.section}]:[];
 const entries=rows.slice(input.offset,input.offset+30).map((row,index)=>({id:typeof row?.id==='string'&&row.id?row.id:`@row:${input.offset+index}`,title:String(row?.title||row?.name||row?.id||(row?.job_name?`${row.job_name} Lv${row.level}`:`行 ${input.offset+index+1}`)).slice(0,300)}));
 return {...common,entries,nextOffset:input.offset+30<rows.length?input.offset+30:null,total:rows.length};
}
