import {z} from 'zod';
import type {Item,Project} from './model';

const textList=z.array(z.string().trim().min(1).max(2000)).max(500);
export const changeControlSchema=z.object({
 baselineCommit:z.string().trim().max(64),
 baselineSiteVersion:z.number().int().positive().nullable(),
 baselineProjectRevision:z.number().int().positive().nullable(),
 plannedFiles:textList,
 dependencyNotes:textList,
 protectedAreas:textList,
 forbiddenAreas:textList,
 verificationPlan:textList,
 actualFiles:textList,
 deviations:textList,
 verificationEvidence:textList,
 rollbackPlan:z.string().trim().max(20000),
}).strict();
export type ChangeControl=z.infer<typeof changeControlSchema>;
export const emptyChangeControl=():ChangeControl=>({baselineCommit:'',baselineSiteVersion:null,baselineProjectRevision:null,plannedFiles:[],dependencyNotes:[],protectedAreas:[],forbiddenAreas:[],verificationPlan:[],actualFiles:[],deviations:[],verificationEvidence:[],rollbackPlan:''});

const unique=(values:string[])=>[...new Set(values.map(v=>v.trim()).filter(Boolean))];
const deviationPaths=(c:ChangeControl)=>new Set(c.deviations.map(v=>v.split(':',1)[0].trim()).filter(Boolean));
export function changePlanIssues(item:Item){
 const c=item.task?.changeControl;if(!c)return ['変更影響台帳が未登録です'];
 const issues:string[]=[];
 if(!/^[a-f0-9]{40,64}$/i.test(c.baselineCommit))issues.push('基準Gitコミットを省略しないSHAで登録してください');
 if(c.baselineSiteVersion===null)issues.push('基準公開版が未登録です');
 if(c.baselineProjectRevision===null)issues.push('基準案件版が未登録です');
 if(!unique(c.plannedFiles).length)issues.push('変更予定ファイルが未登録です');
 if(!unique(c.dependencyNotes).length)issues.push('依存関係が未登録です');
 if(!unique(c.protectedAreas).length)issues.push('保持を保証する領域が未登録です');
 if(!unique(c.verificationPlan).length)issues.push('保証テスト計画が未登録です');
 if(!c.rollbackPlan.trim())issues.push('復帰方法が未登録です');
 return issues;
}
export function changeCompletionIssues(item:Item){
 const plan=changePlanIssues(item),c=item.task?.changeControl;if(!c)return plan;
 const issues=[...plan],planned=new Set(unique(c.plannedFiles)),actual=new Set(unique(c.actualFiles)),documented=deviationPaths(c);
 if(!actual.size)issues.push('実際に変更したファイルが未登録です');
 if(!unique(c.verificationEvidence).length)issues.push('保証テストの結果・証跡が未登録です');
 for(const path of actual)if(!planned.has(path)&&!documented.has(path))issues.push(`計画外ファイルの理由が未登録です: ${path}`);
 for(const path of planned)if(!actual.has(path)&&!documented.has(path))issues.push(`変更しなかった予定ファイルの理由が未登録です: ${path}`);
 return [...new Set(issues)];
}
export function governedSourceTasks(project:Project){return project.items.filter(i=>i.kind==='作業'&&i.status!=='中止'&&i.task?.workType==='SOURCE_UPDATE'&&(project.changeControlEnabled===true||!!i.task.changeControl));}
