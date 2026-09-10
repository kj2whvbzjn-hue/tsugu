'use client';
import {useMemo,useState} from 'react';
import {Table,TableHeader,TableBody,TableRow,TableHead,TableCell} from '@/components/ui/table';
import {auditImportedStatuses} from './status-audit';
import type {Project} from './model';

export default function StatusAuditView({project,onEdit}:{project:Project;onEdit:(id:string)=>void}){
  const [original,setOriginal]=useState<unknown>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const result=useMemo(()=>{
    if(!original)return null;
    try{return {differences:auditImportedStatuses(project,original),error:''};}
    catch(e){return {differences:[],error:e instanceof Error?e.message:'比較できませんでした'};}
  },[project,original]);
  async function check(){
    setBusy(true);setError('');
    try{
      const response=await fetch('/api/projects?original='+encodeURIComponent(project.id),{credentials:'same-origin',signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw Error('元JSONを読み込めません。サインイン状態を確認して再試行してください。');
      setOriginal(await response.json());
    }catch(e){setError(e instanceof Error?e.message:'比較できませんでした');}
    finally{setBusy(false);}
  }
  return <section className="panel"><h2>取込時の状態を確認</h2><p className="muted">元JSONを修正後のルールで読み直し、現在の状態との差を表示します。取込後に意図して変更した状態も含まれるため、自動で書き換えません。</p><button disabled={busy} onClick={check}>{busy?'比較中…':'元JSONと状態を比較'}</button>{(error||result?.error)&&<p className="error" role="alert">{error||result?.error}</p>}{result&&!result.error&&<><p role="status">状態の差分：{result.differences.length}件</p>{result.differences.length>0&&<Table><TableHeader><TableRow><TableHead>項目</TableHead><TableHead>現在</TableHead><TableHead>元JSONからの変換</TableHead><TableHead>確認</TableHead></TableRow></TableHeader><TableBody>{result.differences.map(d=><TableRow key={d.id}><TableCell><span>{d.title}</span><br/><small>{d.kind} / {d.id}</small></TableCell><TableCell>{d.current}{d.invalid?'（使用できない状態）':''}</TableCell><TableCell>{d.expected}</TableCell><TableCell><button onClick={()=>onEdit(d.id)}>内容を開く</button></TableCell></TableRow>)}</TableBody></Table>}</>}</section>;
}
