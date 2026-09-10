import {taskContractSchema,workTypes,emptyTask,type TaskContract} from './task-contract';
import type {Project,Item} from './model';

type Row=Record<string,unknown>;
export function legacyTask(row:Row):{task:TaskContract;warnings:string[]}{
 const task=emptyTask(),warnings:string[]=[];
 if(workTypes.includes(row.work_type as typeof workTypes[number]))task.workType=row.work_type as TaskContract['workType'];else warnings.push('作業種別を確認してください');
 if(Number.isSafeInteger(row.execution_order)&&Number(row.execution_order)>=0)task.executionOrder=Number(row.execution_order);else warnings.push('実行順序を確認してください');
 if(typeof row.requires_human_approval==='boolean')task.requiresHumanApproval=row.requires_human_approval;else warnings.push('承認要求を確認してください');
 if(Array.isArray(row.depends_on)&&row.depends_on.every(x=>typeof x==='string'&&x.length>0))task.dependsOn=row.depends_on;else warnings.push('依存する作業を確認してください');
 if(Array.isArray(row.acceptance_criteria)&&row.acceptance_criteria.every(x=>typeof x==='string'&&x.trim()))task.acceptanceCriteria=row.acceptance_criteria;
 else if(typeof row.acceptance_criteria==='string'&&row.acceptance_criteria.trim())task.acceptanceCriteria=[row.acceptance_criteria];
 else warnings.push('完了条件を確認してください');
 // References and historical approvals are never inferred or promoted.
 task.reviewRequired=warnings.length>0;
 const result=taskContractSchema.safeParse(task);
 if(!result.success)return {task:{...emptyTask(),reviewRequired:true},warnings:[...warnings,'作業条件の形式が不正です。元資料を確認してください']};
 return {task:result.data,warnings};
}
export function taskMetadataProposal(project:Project,original:Record<string,unknown>){
 if(!project.sourceInfo||!original.workspace||typeof original.workspace!=='object'||(original.workspace as Row).id!==project.sourceInfo.projectId)throw Error('元JSONと案件情報が一致しません');
 if(!Array.isArray(original.tasks))throw Error('元資料にタスク配列がありません');
 const rows=original.tasks as Row[],ids=rows.map(r=>r?.id);
 if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)throw Error('元タスクIDが欠落または重複しています。個別に確認してください');
 const warnings:string[]=[],upserts:Item[]=[];
 for(const row of rows){
  const existing=project.items.find(i=>i.id===row.id);
  if(!existing||existing.kind!=='作業'){warnings.push(`${row.id}: 編集項目との対応を確認してください`);continue;}
  if(existing.task)continue;
  const result=legacyTask(row);warnings.push(...result.warnings.map(w=>`${row.id}: ${w}`));
  upserts.push({...existing,task:result.task});
 }
 return {upserts,warnings};
}
