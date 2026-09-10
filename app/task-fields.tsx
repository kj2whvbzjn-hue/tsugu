'use client';
import {useState} from 'react';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {Checkbox} from '@/components/ui/checkbox';
import {emptyTask,workTypes,materialSections,materialKey,type TaskContract} from './task-contract';
import {emptyChangeControl} from './change-control';
import type {Project} from './model';
import {sourceLabels} from './imported-source';
const lines=(v:string)=>v.split('\n').map(s=>s.trim()).filter(Boolean);
export function TaskFields({value,onChange}:{value?:TaskContract;onChange:(v:TaskContract)=>void}){
 const t=value||emptyTask();
 const [deps,setDeps]=useState(t.dependsOn.join('\n')),[criteria,setCriteria]=useState(t.acceptanceCriteria.join('\n'));
 const [section,setSection]=useState<string>('specifications'),[referenceId,setReferenceId]=useState('');
 const [referenceProject,setReferenceProject]=useState(''),[referenceRevision,setReferenceRevision]=useState('');
 function patch(p:Partial<TaskContract>){onChange({...t,...p})}
 return <section className="panel"><h3>作業条件</h3>{!value&&<p className="muted">作業箱には設定不要です。実行するタスクに作業条件を登録してください。</p>}
 <label className="field"><span>作業種別</span><Select value={t.workType||'unknown'} onValueChange={v=>patch({workType:v==='unknown'?null:v as TaskContract['workType']})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="unknown">未確定</SelectItem>{workTypes.map(v=><SelectItem key={v} value={v}>{{DEVELOPMENT_ONLY:'工程・仕様のみ',SOURCE_UPDATE:'ソース変更',GAME_DATA:'ゲームデータ変更'}[v]}</SelectItem>)}</SelectContent></Select></label>
 <label className="field"><span>実行順序</span><input type="number" min={0} step={1} value={t.executionOrder??''} onChange={e=>patch({executionOrder:e.target.value===''?null:Number(e.target.value)})}/></label>
 <label className="field"><span>依存するタスクID（1行に1件）</span><textarea value={deps} rows={3} onChange={e=>{setDeps(e.target.value);patch({dependsOn:lines(e.target.value)})}}/></label>
 <label className="field"><span>完了条件（1行に1件）</span><textarea value={criteria} rows={4} onChange={e=>{setCriteria(e.target.value);patch({acceptanceCriteria:lines(e.target.value)})}}/></label>
 <label className="field"><span>タスク固有の人間承認要求</span><Select value={t.requiresHumanApproval===null?'unknown':String(t.requiresHumanApproval)} onValueChange={v=>patch({requiresHumanApproval:v==='unknown'?null:v==='true'})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="unknown">未確認</SelectItem><SelectItem value="true">必要</SelectItem><SelectItem value="false">追加要求なし</SelectItem></SelectContent></Select></label><p className="muted">案件の版に対する実装承認は引き続き必要です。旧資料の承認を現在版へ引き継ぎません。</p>
 {t.reviewRequired&&<label className="check"><Checkbox checked={false} onCheckedChange={v=>{if(v===true)patch({reviewRequired:false})}}/>元資料と照合し、不足・不正な作業条件を修正しました</label>}
 {t.workType==='SOURCE_UPDATE'&&<section className="panel"><h4>変更影響・保持保証</h4><label className="check"><Checkbox checked={!!t.changeControl} onCheckedChange={v=>patch({changeControl:v===true?emptyChangeControl():undefined})}/>この作業の変更影響を管理する</label>{t.changeControl&&<ChangeControlFields value={t.changeControl} onChange={changeControl=>patch({changeControl})}/>}</section>}
 <h4>作業に必要な元資料</h4><p className="muted">「取込資料」で確認したIDを指定します。資料全体は「$」、IDのない数値表の行は「@row:0」から指定できます。取込後に変わった仕様は、元資料を現在の仕様とみなさず確認してください。</p>
 <div className="field"><span>資料の種類</span><Select value={section} onValueChange={setSection}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{materialSections.map(s=><SelectItem key={s} value={s}>{sourceLabels[s]||s}</SelectItem>)}</SelectContent></Select></div>
 <label className="field"><span>資料ID</span><input value={referenceId} onChange={e=>setReferenceId(e.target.value)}/></label>
 <label className="field"><span>別案件の案件ID（同じ案件なら空欄）</span><input value={referenceProject} onChange={e=>setReferenceProject(e.target.value)}/></label>
 {referenceProject&&<label className="field"><span>参照する案件の保存版</span><input type="number" min={1} step={1} value={referenceRevision} onChange={e=>setReferenceRevision(e.target.value)}/></label>}
 <button disabled={!referenceId.trim()||!!referenceProject&&(!Number.isSafeInteger(Number(referenceRevision))||Number(referenceRevision)<1)} onClick={()=>{const ref={section:section as typeof materialSections[number],id:referenceId.trim(),...(referenceProject.trim()?{projectId:referenceProject.trim(),baseRevision:Number(referenceRevision)}:{})};if(!t.references.some(r=>materialKey(r)===materialKey(ref)))patch({references:[...t.references,ref]});setReferenceId('')}}>資料を追加</button>
 <ul>{t.references.map((r,i)=><li key={materialKey(r)}>{sourceLabels[r.section]||r.section}: {r.id}{r.projectId&&`（${r.projectId} 版${r.baseRevision}）`} <button onClick={()=>patch({references:t.references.filter((_,n)=>n!==i)})}>参照を外す</button></li>)}</ul></section>;
}
function ChangeControlFields({value,onChange}:{value:NonNullable<TaskContract['changeControl']>;onChange:(v:NonNullable<TaskContract['changeControl']>)=>void}){
 const list=(key:'plannedFiles'|'dependencyNotes'|'protectedAreas'|'forbiddenAreas'|'verificationPlan'|'actualFiles'|'deviations'|'verificationEvidence',label:string,rows=3)=><label className="field"><span>{label}（1行に1件）</span><textarea rows={rows} value={value[key].join('\n')} onChange={e=>onChange({...value,[key]:lines(e.target.value)})}/></label>;
 return <div><div className="overview"><label className="field"><span>基準Gitコミット</span><input value={value.baselineCommit} onChange={e=>onChange({...value,baselineCommit:e.target.value.trim()})}/></label><label className="field"><span>基準公開版</span><input type="number" min={1} value={value.baselineSiteVersion??''} onChange={e=>onChange({...value,baselineSiteVersion:e.target.value?Number(e.target.value):null})}/></label><label className="field"><span>基準案件版</span><input type="number" min={1} value={value.baselineProjectRevision??''} onChange={e=>onChange({...value,baselineProjectRevision:e.target.value?Number(e.target.value):null})}/></label></div>{list('plannedFiles','変更予定ファイル')}{list('dependencyNotes','関係する機能・データ・依存関係')}{list('protectedAreas','保持を保証する領域')}{list('forbiddenAreas','変更禁止領域')}{list('verificationPlan','保証テスト計画')}{list('actualFiles','実際に変更したファイル')}{list('deviations','計画との差異と理由（パス: 理由）')}{list('verificationEvidence','テスト結果・証跡')}<label className="field"><span>中止・失敗時の復帰方法</span><textarea rows={4} value={value.rollbackPlan} onChange={e=>onChange({...value,rollbackPlan:e.target.value})}/></label></div>;
}
export function SourceBaselines({value,onChange}:{value:Project['sourceRefs'];onChange:(v:NonNullable<Project['sourceRefs']>)=>void}){
 return <section className="panel"><h2>作業のGit基準版</h2><p className="muted">実装に使う版を省略しないCommit SHAで記録します。Gitの現在版との一致は実行前に確認してください。</p>{(['source','game_data'] as const).map(kind=>{const ref=value?.find(r=>r.kind===kind);return <div key={kind}><label className="check"><Checkbox checked={!!ref} onCheckedChange={v=>onChange(v===true?[...(value||[]),{kind,repository:'',branch:'',commit:'',path:''}]:(value||[]).filter(r=>r.kind!==kind))}/>{kind==='source'?'ソース':'ゲームデータ'}の基準版を登録</label>{ref&&(['repository','branch','commit','path'] as const).map(field=><label className="field" key={field}><span>{{repository:'リポジトリURL',branch:'ブランチ',commit:'Commit SHA（省略しない）',path:'対象パス（任意）'}[field]}</span><input value={ref[field]} onChange={e=>onChange((value||[]).map(r=>r.kind===kind?{...r,[field]:e.target.value}:r))}/></label>)}</div>})}</section>;
}
