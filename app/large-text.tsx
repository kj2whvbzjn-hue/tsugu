'use client';
import {useRef,useState} from 'react';
import {Maximize2,Pencil,ArrowLeft} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
export function ExpandedTextDialog({open,onOpenChange,label,value,onChange}:{open:boolean;onOpenChange:(open:boolean)=>void;label:string;value:string;onChange?:(value:string)=>void}){
 const [editing,setEditing]=useState(false);const title=useRef<HTMLHeadingElement>(null);
 return <Dialog open={open} onOpenChange={v=>{if(!v)setEditing(false);onOpenChange(v)}}><DialogContent className="expanded-text-dialog" onOpenAutoFocus={e=>{e.preventDefault();setEditing(false);title.current?.focus()}}><div className="expanded-text-heading"><DialogTitle ref={title} tabIndex={-1}>{label}</DialogTitle><DialogDescription>{editing?'編集内容は元のフォームにも反映されます。':'全文をスクロールして確認できます。'}</DialogDescription></div>{editing&&onChange?<textarea autoFocus className="expanded-text-editor" aria-label={label} value={value} onChange={e=>onChange(e.target.value)}/>:<div className="expanded-text-reading" tabIndex={0} aria-label={label}>{value||'まだ内容がありません。'}</div>}<div className="expanded-text-actions">{onChange&&<button onClick={()=>setEditing(!editing)}>{editing?<ArrowLeft size={17}/>:<Pencil size={17}/>} {editing?'閲覧に戻る':'編集する'}</button>}<button className="primary" onClick={()=>{setEditing(false);onOpenChange(false)}}>閉じて戻る</button></div></DialogContent></Dialog>;
}
export default function LargeTextField({label,value,onChange}:{label:string;value:string;onChange?:(value:string)=>void}){
 const [open,setOpen]=useState(false);
 return <div className="field large-text-field"><span>{label}</span><button className="text-preview" type="button" onClick={()=>setOpen(true)} aria-label={`${label}を大きく表示`}><span className="text-preview-content">{value||'タップして内容を入力'}</span><span className="text-preview-action"><Maximize2 size={16}/>タップして大きく表示</span></button><ExpandedTextDialog open={open} onOpenChange={setOpen} label={label} value={value} onChange={onChange}/></div>;
}
