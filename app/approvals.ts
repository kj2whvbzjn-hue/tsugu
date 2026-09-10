import {stages,type Project} from './model';
import {changePlanIssues,changeCompletionIssues,governedSourceTasks} from './change-control';
export const approvalKinds=['implementation','completion'] as const;
export type ApprovalKind=typeof approvalKinds[number];
export type ApprovalRequests=Partial<Record<ApprovalKind,boolean>>;
const fields={implementation:['implementationApproved','implementationApproval'],completion:['completionApproved','completionApproval']} as const;
/** Boolean compatibility flags are derived from server-authored version stamps. */
export function readApprovals(project:Project,revision:number):Project{
  const p={...project};
  for(const kind of approvalKinds){const [flag,stamp]=fields[kind];p[flag]=p[flag]===true&&p[stamp]?.approvedRevision===revision;}
  return p;
}
export function invalidateApprovals(project:Project):Project{
  return {...project,implementationApproved:false,completionApproved:false};
}
/** A completed project becomes active again when new or reopened work appears. */
export function reopenForActiveWork(project:Project):Project{
  const legacyActive=project.items.some(i=>i.kind==='作業'&&!['完了','中止'].includes(i.status));
  const coreActive=project.core?.tasks.some(i=>!['完了','中止'].includes(i.status))??false;
  return project.stage==='完了'&&(legacyActive||coreActive)?{...project,stage:'実装準備'}:project;
}
export function resolveApprovals(project:Project,previous:Project|undefined,base:number,requests:ApprovalRequests,owner:string,at:string):Project{
  // Every new saved revision requires explicit approval; client-supplied stamps never confer authority.
  const p=invalidateApprovals({...project,implementationApproval:previous?.implementationApproval,completionApproval:previous?.completionApproval});
  for(const kind of approvalKinds){
    const [flag,stamp]=fields[kind];
    if(requests[kind]===true){p[flag]=true;p[stamp]={approvedRevision:base+1,approvedAt:at,approvedBy:owner};}
  }
  const governed=governedSourceTasks(p);
  if(p.implementationApproved){const issues=governed.flatMap(i=>changePlanIssues(i).map(issue=>`${i.title}: ${issue}`));if(issues.length)throw Error(`実装承認の前に変更計画を完成してください: ${issues.join(' / ')}`);}
  if(p.completionApproved){const issues=governed.flatMap(i=>changeCompletionIssues(i).map(issue=>`${i.title}: ${issue}`));if(issues.length)throw Error(`完了承認の前に変更実績と保持保証を完成してください: ${issues.join(' / ')}`);}
  const unresolvedLegacyChecks=p.items.some(i=>i.kind==='検証'&&!['PASS','免除'].includes(i.status));
  const unfinishedLegacyTasks=p.items.some(i=>i.kind==='作業'&&!['完了','中止'].includes(i.status));
  const unresolvedCoreChecks=p.core?.checks.some(i=>!['PASS','免除'].includes(i.status))??false;
  const unfinishedCoreTasks=p.core?.tasks.some(i=>!['完了','中止'].includes(i.status))??false;
  if(p.completionApproved&&(!p.implementationApproved||unresolvedLegacyChecks||unfinishedLegacyTasks||unresolvedCoreChecks||unfinishedCoreTasks))throw Error('完了承認には実装の再承認、すべての作業の完了または中止、すべての検証のPASSまたは免除が必要です');
  // Keep the historical stage when editing, but gate forward transitions on current approval.
  const advancing=previous&&stages.indexOf(p.stage)>stages.indexOf(previous.stage);
  if(advancing&&stages.indexOf(p.stage)>=2&&!p.implementationApproved)throw Error('工程を進めるには、この保存内容の実装承認が必要です');
  if(advancing&&p.stage==='完了'&&!p.completionApproved)throw Error('完了へ進めるには、この保存内容の完了承認が必要です');
  return p;
}
