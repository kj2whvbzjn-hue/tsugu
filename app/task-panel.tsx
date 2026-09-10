'use client';
import {useState} from 'react';
import type {RecordData} from './model';
import {taskReadiness} from './task-pack';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';

export default function TaskPanel({record,disabled,onOutput,onProposal,onBusy}:{record:RecordData;disabled:boolean;onOutput:(text:string)=>void;onProposal:(text:string)=>void;onBusy:(v:boolean)=>void}){
 const tasks=record.project.items.filter(i=>i.kind==='作業').toSorted((a,b)=>(a.task?.executionOrder??Infinity)-(b.task?.executionOrder??Infinity)||a.id.localeCompare(b.id));
 const missingTaskConditions=tasks.filter(t=>!t.task).length;
 const hasImportedTaskConditions=tasks.some(t=>t.task);
 const [taskId,setTaskId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const selected=tasks.find(t=>t.id===taskId),reasons=selected?taskReadiness(record,selected):[];
 async function load(kind:string){setBusy(true);onBusy(true);setError('');try{
  const query=new URLSearchParams({projectId:record.project.id,baseRevision:String(record.revision),taskId,kind});
  const response=await fetch('/api/projects/task-context?'+query,{credentials:'same-origin',signal:AbortSignal.timeout(30000)});const data:any=await response.json();if(!response.ok)throw Error(data.error||'作業資料を取得できません');
  if(kind.startsWith('metadata')){onProposal(JSON.stringify(data.proposal,null,2));if(data.warnings.length)setError(data.warnings.join(' / '));}else onOutput(data.text);
 }catch(e){setError((e as Error).message)}finally{setBusy(false);onBusy(false)}}
 return <section className="panel"><h2>1作業をAIへ引き継ぐ</h2><p className="muted">作業条件・依存・選択した仕様全文をまとめます。不足情報と実行前の確認事項も含みます。</p>
 {record.project.sourceInfo&&missingTaskConditions>0&&!hasImportedTaskConditions&&<div className="task-migration"><p>取込元のタスクIDで照合し、登録されている全タスクの作業条件を一括補完できます。</p><button className="primary" disabled={disabled||busy} onClick={()=>load('metadata-all')}>{busy?'作成中…':'取込資料から全作業条件を補完'}</button></div>}
 {!tasks.length?<p>「構成・作業」でタスクを追加してください。</p>:<Select value={taskId||'none'} onValueChange={v=>{setTaskId(v==='none'?'':v);setError('')}}><SelectTrigger aria-label="引き継ぐ作業"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="none">作業を選択</SelectItem>{tasks.map(t=><SelectItem key={t.id} value={t.id}>{t.id} · {t.title}{t.task?'':'（作業条件なし）'}</SelectItem>)}</SelectContent></Select>}
 {selected&&<><p>{selected.task?.workType||'作業種別未確定'} · {selected.status}</p>{reasons.length?<ul>{reasons.map(r=><li key={r}>{r}</li>)}</ul>:<p>登録条件は揃っています。資料取得後に欠落と現在のGit版を確認してください。</p>}<div className="actions"><button disabled={disabled||busy} onClick={()=>load('pack')}>{busy?'取得中…':'作業パックを取得'}</button>{record.project.sourceInfo&&!selected.task&&<button disabled={disabled||busy} onClick={()=>load('metadata')}>元資料から作業条件の補完案を作る</button>}</div></>}
 {disabled&&<p role="status">未保存の変更を保存してから取得してください。</p>}{error&&<p className="error" role="alert">{error}</p>}</section>;
}
