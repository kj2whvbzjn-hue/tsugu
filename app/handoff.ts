import {handoff as fullHandoff,kinds,type RecordData,type Item} from './model';

export const handoffLimits={field:1200,body:260,reason:180,itemsPerKind:8,maxCharacters:22000} as const;
export type HandoffMode='簡潔版'|'完全版';
const clip=(text:string,max:number)=>text.length>max?text.slice(0,max)+'…［省略］':text;
function relevant(i:Item){
  switch(i.kind){
    case '議論':return i.status!=='解決';
    case '決定':return ['提案中','確定','要確認'].includes(i.status);
    case '検証':return !['PASS','免除'].includes(i.status);
    default:return i.status!=='完了';
  }
}
export function buildHandoff(r:RecordData,mode:HandoffMode='簡潔版'){
  if(mode==='完全版')return fullHandoff(r);
  const p=r.project,L=handoffLimits;
  const lines=[`# 開発引き継ぎ（簡潔版）: ${p.name}`,`案件ID: ${p.id}`,`基準版: ${r.revision}`,`工程: ${p.stage}`,`更新: ${r.updatedAt}`,
    `実装承認: ${p.implementationApproved&&p.implementationApproval?.approvedRevision===r.revision?'現在版を承認済み':'再承認が必要'} / 完了承認: ${p.completionApproved&&p.completionApproval?.approvedRevision===r.revision?'現在版を承認済み':'再承認が必要'}`,
    'この文書は抜粋です。省略された項目・条件・根拠が存在します。不足情報は確認し、推測で変更しないでください。'];
  for(const [label,value] of [['目的',p.purpose],['守る方針',p.rules],['ソース基準',p.baseline],['現在の焦点',p.focus],['次にすること',p.next]])lines.push(`\n## ${label}\n${clip(value,L.field)}`);
  const core=p.core;
  if(core){
    const activeTasks=core.tasks.filter(i=>!['完了','中止'].includes(i.status));
    const failedChecks=core.checks.filter(i=>['FAIL','要確認','未確認'].includes(i.status));
    lines.push(`\n## 型付き業務中核（抜粋）\nArchitecture ${core.architectureNodes.length} / WorkBox ${core.workBoxes.length} / Task ${core.tasks.length} / Decision ${core.decisions.length} / Issue ${core.issues.length} / Check ${core.checks.length} / Evidence ${core.evidences.length} / Repository ${core.repositories.length} / Path ${core.pathEntries.length}`);
    for(const task of activeTasks.slice(0,L.itemsPerKind))lines.push(`- Task [${task.status}] ${clip(task.title,200)} (ID: ${clip(task.id,120)}, WorkBox: ${clip(task.workBoxId,120)})`);
    for(const check of failedChecks.slice(0,L.itemsPerKind))lines.push(`- Check [${check.status}] ${clip(check.title,200)} (ID: ${clip(check.id,120)}, 対象: ${check.targetType}:${clip(check.targetId,120)}, resolves: ${check.resolvesCheckIds.join(', ')||'なし'})`);
  }
  for(const kind of kinds){
    const all=p.items.filter(i=>i.kind===kind),selected=all.filter(relevant);
    // Failed checks and uncertain/proposed decisions must not be hidden behind settled items.
    const priority=(i:Item)=>['FAIL','要確認','提案中'].includes(i.status)?0:1;
    const shown=selected.toSorted((a,b)=>priority(a)-priority(b)).slice(0,L.itemsPerKind);
    lines.push(`\n## ${kind}（全${all.length}件 / 抜粋${shown.length}件）`);
    for(const i of shown)lines.push(`- [${i.status}] ${clip(i.title,200)} (ID: ${clip(i.id,120)}, 関連: ${clip(i.parentId||'なし',120)})\n  ${clip(i.body,L.body)}\n  理由・根拠: ${clip(i.reason,L.reason)}`);
    if(all.length>shown.length)lines.push(`［${all.length-shown.length}件を省略。必要な項目は案件画面または完全版で確認してください。］`);
  }
  const instructions=`\n\n## AIへの指示\n未確定事項を勝手に確定せず、実装済みと検証済みを区別してください。省略された項目を削除・置換しないでください。返却JSON: {"projectId":"${p.id}","baseRevision":${r.revision},"summary":"変更理由","changes":{},"upserts":[]}。changesはpurpose,rules,focus,baseline,sourceRefs,nextのみ。upsertsは対象項目の全フィールド(id,kind,title,body,status,parentId,reason)が必要です。抜粋だけでは全文が分からない項目は更新案を作る前に全文を要求してください。既存項目にtaskがあれば全フィールドを保持してください。実装前に対象作業の作業パックと必要資料の全文を取得してください。工程・承認・削除は返却で変更しません。`;
  return clip(lines.join('\n'),L.maxCharacters-instructions.length-20)+instructions;
}
