'use client';
import {useMemo,useState} from 'react';
import {bulkWorkHeader,parseBulkWork} from './bulk-work';
import type {Item} from './model';
import {taskTransitionIssues} from './task-dependencies';
export default function BulkWorkDialog({existing,onApply,onDirty}:{existing:Item[];onApply:(items:Item[])=>void;onDirty:(dirty:boolean)=>void}){
 const [raw,setRaw]=useState(bulkWorkHeader+'\n');
 const result=useMemo(()=>{const parsed=parseBulkWork(raw,existing,()=>crypto.randomUUID());return {...parsed,errors:[...parsed.errors,...taskTransitionIssues({items:existing},{items:[...existing,...parsed.items]})]};},[raw,existing]);
 const hasRows=raw.split(/\r?\n/).slice(1).some(line=>line.trim());
 function update(value:string){setRaw(value);onDirty(value!==bulkWorkHeader+'\n')}
 return <div className="dialog-body bulk-work-dialog"><p>表計算ソフトから貼り付けられるタブ区切り形式です。関連先・依存先は項目IDまたは完全一致するタイトルで指定できます。</p><textarea aria-label="一括追加するタスク" rows={12} value={raw} onChange={e=>update(e.target.value)} spellCheck={false}/><p className="muted">状態: 未着手 / 進行中 / 保留 / 完了 / 中止 / 要確認　作業種別: 未確定 / 工程・仕様のみ / ソース変更 / ゲームデータ変更</p>{result.errors.length>0&&<div className="error" role="alert"><strong>反映前に修正してください</strong><ul>{result.errors.map((e,i)=><li key={i}>{e}</li>)}</ul></div>}{hasRows&&!result.errors.length&&<p role="status">{result.items.length}件を反映できます。反映後に案件の「変更を保存」を押してください。</p>}<button className="primary" disabled={!hasRows||!!result.errors.length} onClick={()=>onApply(result.items)}>一括で編集内容を反映</button></div>;
}
