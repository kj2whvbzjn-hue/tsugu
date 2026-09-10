import {Project,Item,newProject,projectSchema,itemSchema} from './model';
import {importStatus} from './import-status';
import {legacyTask} from './task-import';
type Obj=Record<string,any>;
const str=(v:unknown):string=>v==null?'':typeof v==='string'?v:JSON.stringify(v,null,2);
function section(label:string,v:unknown){const s=str(v);return s?`${label}\n${s}`:'';}
const joined=(...v:string[])=>v.filter(Boolean).join('\n\n');
export type ImportResult={project:Project;originalText?:string;draftItem?:Item;proposalText?:string};
export function prepareImport(input:unknown,originalText?:string):ImportResult{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('案件JSONの形式ではありません');
 const raw=input as Obj;
 if(raw.schemaVersion===1||raw.project?.schemaVersion===1){
  const p=projectSchema.parse(raw.project||raw);p.id=crypto.randomUUID();p.name+='（取込）';
  const original=typeof raw.originalText==='string'?raw.originalText:undefined;
  if(p.sourceInfo){p.sourceInfo.originalMissing=!original;if(!original)p.sourceInfo.warnings=[...p.sourceInfo.warnings,'元JSONを含まない案件本体のみの復元です。取込資料は利用できません。'];}
  if(original){const data=JSON.parse(original);if(data?.workspace?.id!==p.sourceInfo?.projectId)throw Error('元JSONと案件情報が一致しません');}
  let draftItem:Item|undefined;
  if(raw.draftState?.item){const draft=raw.draftState.item;draftItem=itemSchema.parse({...draft,title:draft.title||'未入力'});draftItem.title=typeof draft.title==='string'?draft.title:'';}
  const proposalText=typeof raw.draftState?.proposalText==='string'?raw.draftState.proposalText:undefined;
  return {project:p,originalText:original,draftItem,proposalText};
 }
 if(!raw.workspace||typeof raw.workspace!=='object'||typeof raw.workspace.id!=='string'||!raw.workspace.id)throw Error('対応形式は継ぐのバックアップ、またはDevelopment Project JSONです');
 const p=newProject(str(raw.workspace.name||raw.workspace.title||raw.workspace.id));p.changeControlEnabled=false;
 p.purpose=joined(str(raw.project_context?.purpose),section('概要',raw.project_context?.summary));
 p.focus=joined(str(raw.current_focus?.theme),section('目標',raw.current_focus?.goal),section('対象構成',raw.current_focus?.architecture_id),section('対象作業箱',raw.current_focus?.work_box_id));
 p.rules=(raw.project_rules||[]).map((r:Obj)=>`[${str(r.status||'Active')}] ${str(r.id)}\n${str(r.text)}`).join('\n\n');
 p.baseline=str(raw.source_baseline);
 p.implementationApproved=raw.workflow?.implementation_approval?.status==='Approved';
 p.completionApproved=raw.workflow?.completion_approval?.status==='Approved';
 const stageMap:Record<string,Project['stage']>={Discussing:'検討',Planning:'検討',Ready:'実装準備',ReadyForImplementation:'実装準備',Implementing:'実装',Reviewing:'確認',Verifying:'確認',Completed:'完了',Done:'完了'};
 const stage=str(raw.workflow?.stage||raw.workspace.status);p.stage=stageMap[stage]||(['検討','実装準備','実装','確認','完了'].includes(stage)?stage as Project['stage']:'検討');
 const warnings:string[]=[];
 const groups:[string,Item['kind']][]=[['architecture_nodes','構成'],['work_boxes','作業'],['tasks','作業'],['discussions','議論'],['decisions','決定'],['checks','検証']];
 const used=new Set<string>(),refs=new Map<string,string>(),parents=new Map<string,string>();
 for(const [key,kind] of groups){
  const rows=raw[key]??[];if(!Array.isArray(rows))throw Error(`${key}が配列ではありません`);
  for(const [index,r] of rows.entries()){
   if(!r||typeof r!=='object')throw Error(`${key}の項目が不正です`);
   const oldId=str(r.id),candidate=oldId||`${key}-${index+1}`;let id=candidate;if(used.has(id)){id=`${key}:${candidate}:${index}`;warnings.push(`重複IDを変換: ${candidate} → ${id}`);}used.add(id);if(oldId&&!refs.has(oldId))refs.set(oldId,id);
   const convertedStatus=importStatus(kind,r.status,id,key==='architecture_nodes'||key==='work_boxes');
   const status=convertedStatus.status;
   if(convertedStatus.warning)warnings.push(convertedStatus.warning);
   const body=key==='architecture_nodes'?str(r.description):key==='work_boxes'?str(r.body):key==='tasks'?joined(str(r.body),section('完了条件',r.acceptance_criteria),section('依存する作業',r.depends_on),section('人の承認',r.approval)):key==='discussions'?joined(section('概要',r.summary),str(r.body),section('未解決の問い',r.open_questions),section('結論',r.conclusion),section('関連議論',r.related_discussion_ids),section('資料メモ',r.artifact_note)):key==='decisions'?str(r.text):joined(section('結果',r.result),section('対象',`${str(r.target_type)} ${str(r.target_id)}`),section('ゲート',r.gate),section('解決情報',r.resolution));
   const reason=key==='decisions'?joined(str(r.rationale),section('関連議論',r.source_discussion_ids),section('承認者',r.approved_by),section('承認日時',r.approved_at)):key==='checks'?joined(str(r.evidence),section('確認者',r.checked_by),section('確認日時',r.checked_at)):'';
   const metadata=key==='tasks'?legacyTask(r):undefined;
   if(metadata)warnings.push(...metadata.warnings.map(w=>`${id}: ${w}`));
   p.items.push({id,kind,title:str(r.title||r.name||id),body,status,parentId:'',reason,...(metadata?{task:metadata.task}:{})});
   parents.set(id,str(key==='architecture_nodes'?r.parent_id:key==='work_boxes'?r.node_id:key==='tasks'?r.box_id:key==='checks'?r.target_id:''));
  }
 }
 for(const i of p.items){const target=parents.get(i.id);if(target&&refs.has(target)&&refs.get(target)!==i.id)i.parentId=refs.get(target)!;else if(target&&target!==raw.workspace.id)warnings.push(`関連先は元JSONで保持: ${i.id} → ${target}`);}
 if(['実装','確認','完了'].includes(p.stage)&&!p.implementationApproved){p.stage='実装準備';warnings.push('実装承認がないため実装準備として取り込みました');}
 if(p.stage==='完了'&&(!p.completionApproved||p.items.some(i=>i.kind==='検証'&&!['PASS','免除'].includes(i.status)))){p.stage='確認';warnings.push('完了承認または検証が未解決のため確認として取り込みました');}
 p.sourceInfo={format:'development-project',projectId:raw.workspace.id,schemaVersion:str(raw.schema_version),importedAt:new Date().toISOString(),counts:Object.fromEntries(Object.entries(raw).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,(v as any[]).length])),warnings};
 return {project:projectSchema.parse(p),originalText:originalText||JSON.stringify(raw)};
}
