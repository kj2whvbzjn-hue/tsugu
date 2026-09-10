import {projectSchema, proposalSchema, type RecordData} from './model';
import {taskTransitionIssues} from './task-dependencies';

export type Proposal = ReturnType<typeof proposalSchema.parse>;
export class ProposalError extends Error {
  constructor(message:string, public status=400) { super(message); }
}

/** Both manual JSON and connected agents use this exact validation path. */
export function prepareProposal(record:RecordData, input:unknown) {
  const proposal=proposalSchema.parse(input);
  if(proposal.projectId!==record.project.id || proposal.baseRevision!==record.revision)
    throw new ProposalError('案件または基準版が一致しません。最新版で変更案を作り直してください。',409);
  if(new Set(proposal.upserts.map(i=>i.id)).size!==proposal.upserts.length)
    throw new ProposalError('返却の項目IDが重複しています');
  for(const item of proposal.upserts){if(record.project.items.find(i=>i.id===item.id)?.task&&!item.task)throw new ProposalError('既存の作業条件を省略できません。対象項目の全文を取得してください。');}
  const ids=new Set(proposal.upserts.map(i=>i.id));
  const project=projectSchema.parse({...record.project,...proposal.changes,
    items:[...record.project.items.filter(i=>!ids.has(i.id)),...proposal.upserts]});
  const issues=taskTransitionIssues(record.project,project);
  if(issues.length)throw new ProposalError(issues.join(' / '));
  return {proposal,project};
}
