'use client';
import {useEffect,useState} from 'react';
import type {RecordData} from './model';
import type {Proposal} from './proposals';

type Entry={id:string;status:string;createdAt:string;baseRevision:number;appliedRevision:number|null};
type Detail={id:string;status:string;proposal:Proposal;currentRevision:number};
const statusLabels:Record<string,string>={pending:'確認待ち',conflict:'最新版で作り直しが必要',applied:'反映済み'};
async function request(path:string,init:RequestInit={}){
 const response=await fetch(path,{credentials:'same-origin',...init});
 if(!response.headers.get('content-type')?.includes('application/json'))throw Error('応答を確認できません。サインイン状態を確認してください。');
 const data:any=await response.json();if(!response.ok)throw Error(data.error||'処理できませんでした');return data;
}
export default function ProposalInbox({record,disabled,onApplied,onBusy}:{record:RecordData;disabled:boolean;onApplied:(r:RecordData)=>void;onBusy:(v:boolean)=>void}){
 const [items,setItems]=useState<Entry[]>([]),[detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[loading,setLoading]=useState(true),[latest,setLatest]=useState(record.revision);
 useEffect(()=>{
  const controller=new AbortController();let working=false;
  async function poll(){if(working||document.visibilityState==='hidden')return;working=true;
   try{const data=await request('/api/proposals?projectId='+record.project.id,{signal:controller.signal});if(!controller.signal.aborted){setItems(data.items);setLatest(data.currentRevision);setError('');}}
   catch(e){if(!controller.signal.aborted)setError((e as Error).message)}finally{working=false;if(!controller.signal.aborted)setLoading(false);}
  }
  void poll();const timer=setInterval(poll,15000);document.addEventListener('visibilitychange',poll);
  return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',poll)};
 },[record.project.id,record.revision,refresh]);
 async function inspect(id:string){setError('');onBusy(true);try{setDetail(await request('/api/proposals?id='+id,{signal:AbortSignal.timeout(30000)}));}catch(e){setError((e as Error).message)}finally{onBusy(false)}}
 async function apply(){if(!detail||disabled)return;setError('');onBusy(true);
  try{const data=await request('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proposalId:detail.id}),signal:AbortSignal.timeout(30000)});onApplied(data);setDetail(null);setRefresh(n=>n+1);}
  catch(e){setError((e as Error).message)}finally{onBusy(false)}
 }
 async function reload(){if(disabled)return;onBusy(true);try{const rows:RecordData[]=await request('/api/projects',{signal:AbortSignal.timeout(30000)});const row=rows.find(r=>r.project.id===record.project.id);if(!row)throw Error('案件が見つかりません');onApplied(row);setDetail(null);setRefresh(n=>n+1);}catch(e){setError((e as Error).message)}finally{onBusy(false)}}
 return <section className="panel" aria-label="届いた変更案">
  <h2>届いた変更案</h2><p className="muted">接続したAIの提案をここで確認します。反映するまでは案件は変わりません。最新30件を表示します。</p>
  <button disabled={disabled} onClick={()=>setRefresh(n=>n+1)}>変更案を更新</button>
  {latest!==record.revision&&<p role="status">案件に新しい保存版があります。<button disabled={disabled} onClick={reload}>案件の最新版を読み直す</button></p>}
  {disabled&&<p className="muted">保存中、または未保存の入力があります。先に保存するか入力を閉じてください。</p>}
  {error&&<p className="error" role="alert">{error}</p>}
  {loading?<p>確認中…</p>:items.length===0?<p>変更案はまだ届いていません。</p>:<ul>{items.map(i=><li key={i.id}><button disabled={disabled} onClick={()=>inspect(i.id)}>{statusLabels[i.status]||i.status} · {new Date(i.createdAt).toLocaleString('ja-JP')} · 基準版 {i.baseRevision}</button></li>)}</ul>}
  {detail&&<div><h3>変更内容の確認</h3><p>{detail.proposal.summary}</p>
   {Object.entries(detail.proposal.changes).map(([key,value])=><div className="diff" key={key}><strong>{({purpose:'目的',rules:'方針',focus:'焦点',baseline:'ソース基準',sourceRefs:'Git基準版',next:'次の作業'} as Record<string,string>)[key]}</strong><del>{JSON.stringify(record.project[key as keyof typeof record.project]??'未記入',null,2)}</del><ins>{typeof value==='string'?value:JSON.stringify(value,null,2)}</ins></div>)}
   {detail.proposal.upserts.map(item=><div className="diff" key={item.id}><strong>{item.title}</strong><pre>{JSON.stringify(record.project.items.find(i=>i.id===item.id)||'新規追加',null,2)}</pre><pre>{JSON.stringify(item,null,2)}</pre></div>)}
   {detail.status==='pending'&&detail.proposal.baseRevision===record.revision&&latest===record.revision?<button className="primary" disabled={disabled} onClick={apply}>この変更案を反映して保存</button>:<p>{statusLabels[detail.status]||'最新版を確認してください'}。表示した差分は画面の版 {record.revision} との比較です。</p>}
   <button disabled={disabled} onClick={()=>setDetail(null)}>閉じる</button>
  </div>}
 </section>;
}
