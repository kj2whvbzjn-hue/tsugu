import type {Item,RecordData} from './model';
import {materialRefSchema,materialKey,type MaterialRef} from './task-contract';
import {changePlanIssues} from './change-control';
import {dependencyIssues} from './task-dependencies';

export type MaterialEntry={reference:MaterialRef;content:unknown;projectId?:string;baseRevision?:number;originalSha256?:string};

export const taskPackLimit=128*1024;
export function resolveMaterial(original:Record<string,unknown>,ref:MaterialRef):unknown{
 materialRefSchema.parse(ref);
 const group=original[ref.section];
 if(ref.id==='$'&&group&&typeof group==='object')return group;
 if(!Array.isArray(group))throw Error(`資料が見つかりません: ${ref.section}:${ref.id}`);
 // Index selectors refer to an immutable imported snapshot; actual IDs take precedence.
 const matches=group.filter(row=>row&&typeof row==='object'&&row.id===ref.id);
 if(!matches.length&&/^@row:(0|[1-9]\d*)$/.test(ref.id)){
  const index=Number(ref.id.slice(5)),row=group[index];
  if(row&&typeof row==='object'&&!row.id)return row;
 }
 if(matches.length!==1)throw Error(`資料が欠落または重複しています: ${ref.section}:${ref.id}`);
 return matches[0];
}
export function taskReadiness(record:RecordData,item:Item){
 const reasons:string[]=[],p=record.project,t=item.task;
 if(item.kind!=='作業'||!t)return ['作業条件が未登録です'];
 if(!['未着手','進行中'].includes(item.status))reasons.push(`作業状態が「${item.status}」です`);
 if(!t.workType)reasons.push('作業種別が未確定です');
 if(t.executionOrder===null)reasons.push('実行順序が未確定です');
 if(t.requiresHumanApproval===null)reasons.push('承認要求が未確認です');
 if(t.reviewRequired)reasons.push('元資料の作業条件に確認事項があります');
 if(!t.acceptanceCriteria.length)reasons.push('完了条件が未登録です');
 if(!p.implementationApproved||p.implementationApproval?.approvedRevision!==record.revision)reasons.push('この版の実装承認がありません');
 if(!['実装準備','実装','確認'].includes(p.stage))reasons.push('工程が実行前の確認対象になっていません');
 reasons.push(...dependencyIssues(p.items,item));
 if(t.workType&&t.workType!=='DEVELOPMENT_ONLY'){
  const kind=t.workType==='GAME_DATA'?'game_data':'source';
  if(!p.sourceRefs?.some(r=>r.kind===kind))reasons.push(`${kind==='source'?'ソース':'ゲームデータ'}のGit基準版が未登録です`);
  if(!t.references.length)reasons.push('参照する仕様・資料が未選択です');
 }
 if(t.workType==='SOURCE_UPDATE'&&(p.changeControlEnabled===true||!!t.changeControl))reasons.push(...changePlanIssues(item));
 return [...new Set(reasons)];
}
export function buildTaskPack(record:RecordData,taskId:string,original?:Record<string,unknown>,originalSha256?:string,resolvedMaterials?:MaterialEntry[],materialErrors:string[]=[]){
 const task=record.project.items.find(i=>i.id===taskId);if(!task||task.kind!=='作業')throw Error('対象の作業が見つかりません');
 const blockers=[...taskReadiness(record,task),...materialErrors],materials:MaterialEntry[]=[];
 for(const reference of task.task?.references||[]){try{
  if(resolvedMaterials){const match=resolvedMaterials.find(m=>materialKey(m.reference)===materialKey(reference));if(!match)throw Error(`参照資料を取得できません: ${reference.section}:${reference.id}`);materials.push(match);}
  else {if(reference.projectId)throw Error('別案件の資料は所有者・版の検証が必要です');if(!original)throw Error('元資料を取得できません');materials.push({reference,content:resolveMaterial(original,reference)});}
 }catch(e){blockers.push((e as Error).message);}}
 if(original){
  const lifecycle=original.lifecycle as Record<string,unknown>|undefined,workspace=original.workspace as Record<string,unknown>|undefined;
  if(lifecycle?.status!=='Active')blockers.push('元資料のライフサイクルがActiveではないか未確認です');
  if(workspace?.ai_attention!=='Auto')blockers.push('元資料のAI対象設定を人間が確認してください');
 }
 const dependencies=(task.task?.dependsOn||[]).map(id=>record.project.items.find(i=>i.id===id)).filter(Boolean);
 const packet={format:'tsugu-task-pack-v1',projectId:record.project.id,baseRevision:record.revision,updatedAt:record.updatedAt,
  purpose:record.project.purpose,rules:record.project.rules,baseline:record.project.baseline,sourceRefs:record.project.sourceRefs||[],task,dependencies,
  original:original?{sha256:originalSha256,projectId:record.project.sourceInfo?.projectId,role:'imported_snapshot',workflow:original.workflow,lifecycle:original.lifecycle,authority:original.authority,projectRules:original.project_rules}:null,
  materials,blockers:[...new Set(blockers)],contentComplete:true,readyForHumanReview:false,executionAuthorized:false,
  externalBaselineVerified:false,notice:'これは人間の実行前レビュー用です。Gitの現在版・必須規約・必要資料の網羅性は実行前に照合してください。元資料は取込時点の記録であり、現在の正本切替や旧承認を証明しません。提案の反映と実装・公開の完了を区別してください。'};
 packet.contentComplete=materials.length===(task.task?.references.length||0);
 const bytes=new TextEncoder().encode(JSON.stringify(packet)).length;
 if(bytes>taskPackLimit){packet.materials=[];packet.contentComplete=false;packet.blockers.push('作業パックの容量を超えました。資料を版・ID指定で分割取得してください');}
 packet.readyForHumanReview=packet.contentComplete&&packet.blockers.length===0;
 const text='# 作業パック（実行前レビュー用）\n\n'+packet.notice+'\n\n```json\n'+JSON.stringify(packet,null,2)+'\n```\n';
 // Never label a clipped packet as complete or silently return partial source.
 if(new TextEncoder().encode(text).length>taskPackLimit)throw Error('作業本文が大きすぎます。対象を小さな作業に分けてください');
 return {packet,text};
}
