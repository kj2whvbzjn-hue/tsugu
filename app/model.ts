import { z } from 'zod';
import {taskContractSchema,sourceRefSchema} from './task-contract';
import {emptyCoreState,isCoreState,type CoreState} from './core-model';
export const stages=['検討','実装準備','実装','確認','完了'] as const;
export const kinds=['構成','作業','議論','決定','検証'] as const;
export const statusByKind={
  '構成':['未着手','進行中','完了','要確認'],
  '作業':['未着手','進行中','保留','完了','中止','要確認'],
  '議論':['未解決','解決','保留','要確認'],
  '決定':['提案中','確定','却下','廃止','要確認'],
  '検証':['未確認','PASS','FAIL','免除','要確認'],
} as const;
export type ItemKind=typeof kinds[number];
export type ItemStatus=typeof statusByKind[ItemKind][number];
const allStatuses=[...new Set(Object.values(statusByKind).flat())] as [ItemStatus,...ItemStatus[]];
export function isStatusForKind(kind:ItemKind,status:string):status is ItemStatus{
  return (statusByKind[kind] as readonly string[]).includes(status);
}
export const itemSchema=z.object({id:z.string().min(1),kind:z.enum(kinds),title:z.string().min(1).max(300),body:z.string().max(200000),status:z.enum(allStatuses),parentId:z.string(),reason:z.string().max(200000),task:taskContractSchema.optional()}).superRefine((item,ctx)=>{
  if(item.task&&item.kind!=='作業')ctx.addIssue({code:'custom',message:'作業条件は作業項目にだけ設定できます'});
  if(item.task?.dependsOn.includes(item.id))ctx.addIssue({code:'custom',message:'自分自身には依存できません'});
  if(!isStatusForKind(item.kind,item.status))ctx.addIssue({code:'custom',path:['status'],message:`${item.kind}「${item.title}」の状態「${item.status}」は使用できません。状態を選び直してください。`});
});
const approvalSchema=z.object({approvedRevision:z.number().int().positive(),approvedAt:z.string().datetime(),approvedBy:z.string().min(1)});
export const projectSchema=z.object({schemaVersion:z.literal(1),id:z.string().uuid(),name:z.string().trim().min(1).max(200),purpose:z.string().max(200000),rules:z.string().max(200000),focus:z.string().max(200000),baseline:z.string().max(200000),sourceRefs:z.array(sourceRefSchema).max(2).optional(),changeControlEnabled:z.boolean().optional(),next:z.string().max(200000),sourceInfo:z.object({format:z.literal('development-project'),originalMissing:z.boolean().optional(),projectId:z.string(),schemaVersion:z.string(),importedAt:z.string(),counts:z.record(z.number()),warnings:z.array(z.string())}).optional(),stage:z.enum(stages),implementationApproved:z.boolean(),completionApproved:z.boolean(),implementationApproval:approvalSchema.optional(),completionApproval:approvalSchema.optional(),core:z.custom<CoreState>(isCoreState,{message:'型付き業務モデルが不正です'}).optional(),items:z.array(itemSchema).max(1000)}).superRefine((p,ctx)=>{if(p.sourceRefs&&new Set(p.sourceRefs.map(r=>r.kind)).size!==p.sourceRefs.length)ctx.addIssue({code:'custom',message:'同じ種別のソース基準が複数あります'});const ids=new Set(p.items.map(i=>i.id));if(ids.size!==p.items.length)ctx.addIssue({code:'custom',message:'項目IDが重複しています'});for(const i of p.items){if(i.parentId&&(!ids.has(i.parentId)||i.parentId===i.id))ctx.addIssue({code:'custom',message:'関連先が不正です'});}});
export type Project=z.infer<typeof projectSchema>;
export type Item=z.infer<typeof itemSchema>;
export type RecordData={project:Project;revision:number;updatedAt:string};
export function newProject(name:string):Project{return {schemaVersion:1,id:crypto.randomUUID(),name,purpose:'',rules:'',focus:'',baseline:'',changeControlEnabled:true,next:'',stage:'検討',implementationApproved:false,completionApproved:false,core:emptyCoreState(),items:[]};}
export function handoff(r:RecordData){const p=r.project;return `# 開発引き継ぎ: ${p.name}\n案件ID: ${p.id}\n基準版: ${r.revision}\n更新: ${r.updatedAt}\n工程: ${p.stage}\n実装承認: ${p.implementationApproved&&p.implementationApproval?.approvedRevision===r.revision?'現在版を承認済み':'再承認が必要'} / 完了承認: ${p.completionApproved&&p.completionApproval?.approvedRevision===r.revision?'現在版を承認済み':'再承認が必要'}\n\n## 目的\n${p.purpose}\n\n## 守る方針\n${p.rules}\n\n## ソース基準\n${p.baseline}\n\n## 現在の焦点\n${p.focus}\n\n## 次にすること\n${p.next}\n\n${kinds.map(k=>`## ${k}\n`+p.items.filter(i=>i.kind===k).map(i=>`- [${i.status}] ${i.title} (ID: ${i.id}, 関連: ${i.parentId||'なし'})\n  ${i.body}\n  理由・根拠: ${i.reason}${i.task?'\n  作業条件: '+JSON.stringify(i.task):''}`).join('\n')).join('\n\n')}\n\n## 型付き業務中核\n${JSON.stringify(p.core??emptyCoreState(),null,2)}\n\n## AIへの指示\n目的・確定した決定・方針を尊重し、未解決事項を勝手に確定しないでください。実装済みと検証済みを区別し、次回への引き継ぎを更新してください。返却JSONは {"projectId":"${p.id}","baseRevision":${r.revision},"summary":"変更理由","changes":{"focus":"…","next":"…"},"upserts":[]} の形で返してください。changesにはpurpose,rules,focus,baseline,sourceRefs,nextのみ指定可能です。upsertsは追加または更新する項目の全フィールド(id,kind,title,body,status,parentId,reason)を含めてください。既存項目にtaskがあれば全フィールドを保持してください。元資料の全仕様はこの文書に含まれません。実装前に対象Taskの作業パックと必要な全文資料を取得してください。削除・工程移行・承認はこの返却では行いません。\n`;}
export const proposalSchema=z.object({projectId:z.string().uuid(),baseRevision:z.number().int().positive(),summary:z.string().min(1).max(2000),changes:z.object({purpose:z.string().max(200000).optional(),rules:z.string().max(200000).optional(),focus:z.string().max(200000).optional(),baseline:z.string().max(200000).optional(),sourceRefs:z.array(sourceRefSchema).max(2).optional(),next:z.string().max(200000).optional()}).strict(),upserts:z.array(itemSchema).max(1000)}).strict();
