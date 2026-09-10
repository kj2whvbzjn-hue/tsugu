'use client';
import {useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
export type OutputFile={name:string;text:string;type?:string;url?:string;notice?:string};
export default function FileOutput({file,onClose}:{file:OutputFile|null;onClose:()=>void}){
 const [message,setMessage]=useState('');
 if(!file)return null;
 async function share(){try{const f=new File([file!.text],file!.name,{type:file!.type||'application/json'});if(!navigator.canShare?.({files:[f]})){setMessage('この環境ではファイル共有を利用できません。コピーまたは本文の選択を使ってください。');return;}await navigator.share({files:[f]});setMessage('共有先へ渡しました。保存先でファイルを確認してください。');}catch(e){setMessage((e as Error).name==='AbortError'?'共有をキャンセルしました。':'共有できませんでした。コピーまたは本文の選択を使ってください。');}}
 return <Dialog open onOpenChange={v=>{if(!v){setMessage('');onClose()}}}><DialogContent className="wide-dialog"><DialogTitle>ファイルを取得・退避</DialogTitle><DialogDescription>{file.notice||'保存先でファイルを確認してください。取得操作だけでは端末への保存完了を確認できません。'}</DialogDescription><p>{file.name}</p><div className="actions">{file.url&&<a className="button" href={file.url} target="_blank" rel="noreferrer">サーバーからファイルを取得</a>}<button onClick={share}>共有・ファイルに保存</button><button onClick={async()=>{try{await navigator.clipboard.writeText(file.text);setMessage('本文をコピーしました。ファイルへの保存はまだ行っていません。')}catch{setMessage('コピーできません。下の本文を長押しして選択してください。')}}}>本文をコピー</button></div><textarea readOnly rows={12} value={file.text} aria-label="退避するファイルの全文" onFocus={e=>e.target.select()}/><p role="status">{message}</p><button onClick={onClose}>閉じる</button></DialogContent></Dialog>;
}
