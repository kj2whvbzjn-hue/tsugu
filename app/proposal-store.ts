import {database} from '@/db/store';
import {readApprovals} from '@/app/approvals';
import {prepareProposal,ProposalError} from '@/app/proposals';
import type {RecordData} from '@/app/model';
import type {identityFromHeaders} from '@/app/identity';
import {z} from 'zod';

export type Identity=NonNullable<Awaited<ReturnType<typeof identityFromHeaders>>>;
export type ProposalRow={id:string;project_id:string;owner:string;base_revision:number;body:string;status:string;created_at:string;applied_revision:number|null;applied_at:string|null};
export async function getRecord(identity:Identity,id:string):Promise<RecordData>{
 const row=await database().prepare('SELECT body,revision,updated_at FROM projects WHERE id=? AND owner IN (?,?)').bind(id,...identity.keys).first<{body:string;revision:number;updated_at:string}>();
 if(!row)throw new ProposalError('案件が見つかりません',404);
 return {project:readApprovals(JSON.parse(row.body),row.revision),revision:row.revision,updatedAt:row.updated_at};
}
export async function getProposal(identity:Identity,id:string){
 const row=await database().prepare('SELECT q.* FROM proposals q JOIN projects p ON p.id=q.project_id WHERE q.id=? AND q.owner IN (?,?) AND p.owner IN (?,?)').bind(id,...identity.keys,...identity.keys).first<ProposalRow>();
 if(!row)throw new ProposalError('変更案が見つかりません',404);
 return row;
}
export async function describeProposal(identity:Identity,row:ProposalRow){
 const current=await getRecord(identity,row.project_id);
 return {id:row.id,proposal:JSON.parse(row.body),status:row.status==='pending'&&row.base_revision!==current.revision?'conflict':row.status,
  createdAt:row.created_at,appliedRevision:row.applied_revision,appliedAt:row.applied_at,currentRevision:current.revision};
}
export async function submitProposal(identity:Identity,id:string,input:unknown){
 z.string().uuid().parse(id);
 // Bound the stored proposal independently from the total project size.
 if(new TextEncoder().encode(JSON.stringify(input)).length>128*1024)throw new ProposalError('変更案は128KB以内に分けてください',413);
 const record=await getRecord(identity,z.object({projectId:z.string().uuid()}).parse(input).projectId);
 // Retried submissions remain identifiable even after the project has advanced.
 let existing:ProposalRow|undefined;
 try{existing=await getProposal(identity,id)}catch(e){if(!(e instanceof ProposalError)||e.status!==404)throw e;}
 const {proposalSchema}=await import('@/app/model');
 const parsed=proposalSchema.parse(input),body=JSON.stringify(parsed);
 if(existing){if(existing.body!==body)throw new ProposalError('同じ提案IDで異なる内容は送信できません',409);return describeProposal(identity,existing);}
 prepareProposal(record,parsed);
 await database().prepare('INSERT INTO proposals (id,project_id,owner,base_revision,body,status,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM projects WHERE id=? AND owner IN (?,?) AND revision=?) ON CONFLICT(id) DO NOTHING')
  .bind(id,parsed.projectId,identity.owner,parsed.baseRevision,body,'pending',new Date().toISOString(),parsed.projectId,...identity.keys,parsed.baseRevision).run();
 const saved=await getProposal(identity,id).catch(e=>{if(e instanceof ProposalError&&e.status===404)throw new ProposalError('案件が更新されています。最新版を確認してください。',409);throw e;});
 if(saved.body!==body)throw new ProposalError('同じ提案IDで異なる内容は送信できません',409);
 return describeProposal(identity,saved);
}
