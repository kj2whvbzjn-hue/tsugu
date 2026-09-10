import {itemSchema,type Item} from './model';
import {emptyTask,type TaskContract} from './task-contract';

const workTypeLabels:Record<string,TaskContract['workType']>={
  '未確定':null,'工程・仕様のみ':'DEVELOPMENT_ONLY','ソース変更':'SOURCE_UPDATE','ゲームデータ変更':'GAME_DATA',
  DEVELOPMENT_ONLY:'DEVELOPMENT_ONLY',SOURCE_UPDATE:'SOURCE_UPDATE',GAME_DATA:'GAME_DATA',
};
const approvalLabels:Record<string,boolean|null>={'未確認':null,'必要':true,'不要':false,'追加要求なし':false};
const split=(value:string,separator:RegExp)=>value.split(separator).map(v=>v.trim()).filter(Boolean);
export type BulkWorkResult={items:Item[];errors:string[]};
export const bulkWorkHeader='タイトル\t作業内容\t状態\t関連先\t作業種別\t順序\t依存先（カンマ区切り）\t完了条件（セミコロン区切り）\t人間承認';

export function parseBulkWork(raw:string,existing:Item[],makeId:()=>string=()=>crypto.randomUUID()):BulkWorkResult{
  const rows=raw.split(/\r?\n/).map((line,index)=>({line,index:index+1})).filter(r=>r.line.trim());
  if(rows[0]?.line.split('\t')[0].trim()==='タイトル')rows.shift();
  const errors:string[]=[];
  const parsed=rows.map(row=>({row,columns:row.line.split('\t').map(v=>v.trim())}));
  const batchTitles=new Set<string>();
  for(const {row,columns} of parsed){const title=columns[0];if(!title)errors.push(`${row.index}行目: タイトルが必要です`);else if(batchTitles.has(title))errors.push(`${row.index}行目: タイトル「${title}」が一括入力内で重複しています`);else batchTitles.add(title);if(columns.length>9)errors.push(`${row.index}行目: 列が多すぎます（9列まで）`);}
  const ids=new Map(parsed.filter(r=>r.columns[0]).map(r=>[r.columns[0],makeId()]));
  function resolve(value:string,row:number,label:string){if(!value)return '';if(existing.some(i=>i.id===value))return value;if(ids.has(value))return ids.get(value)!;const matches=existing.filter(i=>i.title===value);if(matches.length===1)return matches[0].id;errors.push(`${row}行目: ${label}「${value}」${matches.length>1?'が複数あり特定できません':'が見つかりません'}`);return value;}
  const items=parsed.flatMap(({row,columns})=>{const [title,body='',status='未着手',parent='',workType='未確定',order='',dependencies='',criteria='',approval='未確認']=columns;if(!title)return [];if(!(workType in workTypeLabels))errors.push(`${row.index}行目: 作業種別「${workType}」は使用できません`);if(!(approval in approvalLabels))errors.push(`${row.index}行目: 人間承認「${approval}」は使用できません`);if(order&&!/^\d+$/.test(order))errors.push(`${row.index}行目: 順序は0以上の整数で入力してください`);const item={id:ids.get(title)!,kind:'作業' as const,title,body,status:status||'未着手',parentId:resolve(parent,row.index,'関連先'),reason:'',task:{...emptyTask(),workType:workTypeLabels[workType],executionOrder:order===''?null:Number(order),dependsOn:split(dependencies,/[、,]/).map(v=>resolve(v,row.index,'依存先')),acceptanceCriteria:split(criteria,/[；;]/),requiresHumanApproval:approvalLabels[approval]}};const checked=itemSchema.safeParse(item);if(!checked.success)errors.push(`${row.index}行目: ${checked.error.issues[0].message}`);return checked.success?[checked.data]:[];});
  return {items,errors};
}
