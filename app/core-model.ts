export const coreEntityTypes=['architectureNode','workBox','task','decision','issue','check','approval','evidence','evidenceVersion','repository','repositoryBaseline','pathEntry','plannedChange','actualChange'] as const;
export type CoreEntityType=typeof coreEntityTypes[number];

export const taskStatuses=['未着手','進行中','保留','完了','中止','要確認'] as const;
export const decisionStatuses=['提案中','確定','却下','廃止','要確認'] as const;
export const issueStatuses=['未解決','解決','保留','要確認'] as const;
export const checkStatuses=['未確認','PASS','FAIL','免除','要確認'] as const;
export const approvalStatuses=['Pending','Approved','Rejected'] as const;
export const pathEntryTypes=['directory','file'] as const;
export const pathProtectionStates=['normal','protected'] as const;
export const plannedChangeActions=['add','modify','move','delete'] as const;
export const evidenceKinds=['file','image','video','log','test_result','screenshot','other'] as const;

export type ArchitectureNode={id:string;name:string;parentId:string;description:string};
export type WorkBox={id:string;architectureNodeId:string;title:string;body:string};
export type CoreTask={id:string;workBoxId:string;title:string;body:string;status:typeof taskStatuses[number];dependsOnTaskIds:string[];acceptanceCriteria:string[];requiresHumanApproval:boolean};
export type Decision={id:string;title:string;body:string;rationale:string;status:typeof decisionStatuses[number]};
export type Issue={id:string;title:string;body:string;status:typeof issueStatuses[number]};
export type Check={id:string;title:string;status:typeof checkStatuses[number];targetType:'task'|'decision'|'pathEntry';targetId:string;result:string;evidenceText:string;resolvesCheckIds:string[]};
export type Approval={id:string;status:typeof approvalStatuses[number];kind:'implementation'|'completion'|'protected_change';approvedBy:string;approvedAt:string};
export type Evidence={id:string;title:string;kind:typeof evidenceKinds[number];currentVersionId:string;description:string};
export type EvidenceVersionRef={id:string;evidenceId:string;versionNo:number;originalFilename:string;mimeType:string;byteSize:number;sha256:string};
export type Repository={id:string;provider:string;owner:string;name:string;defaultBranch:string};
export type RepositoryBaseline={id:string;repositoryId:string;commitSha:string;recordedAt:string};
export type PathEntry={id:string;repositoryId:string;baselineId:string;parentId:string;path:string;entryType:typeof pathEntryTypes[number];baselineHash:string;protection:typeof pathProtectionStates[number];protectionReason:string};
export type PlannedChange={id:string;pathEntryId:string;action:typeof plannedChangeActions[number];beforePath:string;afterPath:string;reason:string;requiresHumanApproval:boolean};
export type ActualChange={id:string;plannedChangeId:string;commitSha:string;beforeHash:string;afterHash:string;diffSummary:string};

export const relationTypes=['contains','depends_on','implements','blocks','resolves_issue','created_from','supports_decision','supports_check','documents_path','produces_evidence','verifies','resolves_check','authorizes_execution_of','accepts_completion_of','authorizes_change_of','changes','based_on'] as const;
export type RelationType=typeof relationTypes[number];
export type TypedRelation={id:string;type:RelationType;fromType:CoreEntityType;fromId:string;toType:CoreEntityType;toId:string};

export type CoreState={
 architectureNodes:ArchitectureNode[];
 workBoxes:WorkBox[];
 tasks:CoreTask[];
 decisions:Decision[];
 issues:Issue[];
 checks:Check[];
 approvals:Approval[];
 evidences:Evidence[];
 evidenceVersions:EvidenceVersionRef[];
 repositories:Repository[];
 repositoryBaselines:RepositoryBaseline[];
 pathEntries:PathEntry[];
 plannedChanges:PlannedChange[];
 actualChanges:ActualChange[];
 relations:TypedRelation[];
};

export const emptyCoreState=():CoreState=>({architectureNodes:[],workBoxes:[],tasks:[],decisions:[],issues:[],checks:[],approvals:[],evidences:[],evidenceVersions:[],repositories:[],repositoryBaselines:[],pathEntries:[],plannedChanges:[],actualChanges:[],relations:[]});

const relationRules:Record<RelationType,readonly [CoreEntityType,CoreEntityType][]>={
 contains:[['architectureNode','workBox'],['workBox','task']],
 depends_on:[['task','task']],
 implements:[['task','decision']],
 blocks:[['issue','task']],
 resolves_issue:[['decision','issue']],
 created_from:[['task','issue']],
 supports_decision:[['evidenceVersion','decision']],
 supports_check:[['evidenceVersion','check']],
 documents_path:[['evidenceVersion','pathEntry']],
 produces_evidence:[['task','evidence']],
 verifies:[['check','task']],
 resolves_check:[['check','check']],
 authorizes_execution_of:[['approval','task']],
 accepts_completion_of:[['approval','task']],
 authorizes_change_of:[['approval','plannedChange']],
 changes:[['task','pathEntry']],
 based_on:[['pathEntry','repositoryBaseline']],
};

const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const nonEmpty=(value:unknown)=>typeof value==='string'&&value.trim().length>0;
const enumHas=(values:readonly string[],value:unknown)=>typeof value==='string'&&values.includes(value);
const sha256Pattern=/^[a-f0-9]{64}$/i;
const idSet=(rows:unknown[])=>new Set(rows.filter(isObject).map(row=>String(row.id??'')).filter(Boolean));
const duplicates=(rows:unknown[])=>{const seen=new Set<string>(),dupes=new Set<string>();for(const row of rows){if(!isObject(row)||!nonEmpty(row.id))continue;const id=String(row.id);if(seen.has(id))dupes.add(id);seen.add(id);}return [...dupes];};
const coreCollections:Record<CoreEntityType,keyof CoreState>={architectureNode:'architectureNodes',workBox:'workBoxes',task:'tasks',decision:'decisions',issue:'issues',check:'checks',approval:'approvals',evidence:'evidences',evidenceVersion:'evidenceVersions',repository:'repositories',repositoryBaseline:'repositoryBaselines',pathEntry:'pathEntries',plannedChange:'plannedChanges',actualChange:'actualChanges'};

function parentCycleIssues(rows:Array<{id:string;parentId:string}>,label:string){
 const byId=new Map(rows.map(row=>[row.id,row])),issues:string[]=[];
 for(const row of rows){const seen=new Set<string>(),path:string[]=[];let current:typeof row|undefined=row;while(current?.parentId){if(seen.has(current.id)){issues.push(`${label}の循環参照: ${[...path,current.id].join(' -> ')}`);break;}seen.add(current.id);path.push(current.id);current=byId.get(current.parentId);}}
 return issues;
}
function dependencyCycleIssues(rows:CoreTask[]){
 const byId=new Map(rows.map(row=>[row.id,row])),done=new Set<string>(),active=new Set<string>(),issues:string[]=[];
 const visit=(id:string,path:string[])=>{if(active.has(id)){issues.push(`Task依存の循環参照: ${[...path,id].join(' -> ')}`);return;}if(done.has(id))return;const row=byId.get(id);if(!row)return;active.add(id);for(const dep of row.dependsOnTaskIds)visit(dep,[...path,id]);active.delete(id);done.add(id);};
 for(const row of rows)visit(row.id,[]);return issues;
}

export function coreStateIssues(value:unknown):string[]{
 if(!isObject(value))return ['型付き業務モデルがオブジェクトではありません'];
 const required=Object.values(coreCollections).concat('relations') as (keyof CoreState)[];
 const issues:string[]=[];
 for(const key of required){const rows=value[key];if(!Array.isArray(rows)){issues.push(`${String(key)}が配列ではありません`);continue;}if(rows.some(row=>!isObject(row)))issues.push(`${String(key)}にオブジェクト以外の値があります`);}
 if(issues.length)return issues;
 const core=value as unknown as CoreState;
 for(const key of required){for(const id of duplicates(core[key] as unknown[]))issues.push(`${String(key)}のIDが重複しています: ${id}`);}
 const ids=Object.fromEntries((Object.entries(coreCollections) as [CoreEntityType,keyof CoreState][]).map(([type,key])=>[type,idSet(core[key] as unknown[])])) as Record<CoreEntityType,Set<string>>;
 const requireRef=(type:unknown,id:unknown,label:string)=>{if(!enumHas(coreEntityTypes,type)){issues.push(`${label}の型が不正です: ${String(type)}`);return;}if(!nonEmpty(id)||!ids[type as CoreEntityType].has(String(id)))issues.push(`${label}が見つかりません: ${String(type)}:${String(id)}`);};
 const requireStrings=(values:unknown,label:string)=>{if(!Array.isArray(values)||values.some(v=>typeof v!=='string')){issues.push(`${label}が文字列配列ではありません`);return [];}return values as string[];};

 for(const row of core.architectureNodes){if(!nonEmpty(row.id)||!nonEmpty(row.name)||typeof row.parentId!=='string'||typeof row.description!=='string'){issues.push('ArchitectureNodeの形式が不正です');continue;}if(row.parentId){requireRef('architectureNode',row.parentId,`${row.id}の親ArchitectureNode`);if(row.parentId===row.id)issues.push(`ArchitectureNodeは自分自身を親にできません: ${row.id}`);}}
 issues.push(...parentCycleIssues(core.architectureNodes.filter(r=>nonEmpty(r.id)&&typeof r.parentId==='string'),'ArchitectureNode'));
 for(const row of core.workBoxes){if(!nonEmpty(row.id)||!nonEmpty(row.title)||typeof row.architectureNodeId!=='string'||typeof row.body!=='string'){issues.push('WorkBoxの形式が不正です');continue;}requireRef('architectureNode',row.architectureNodeId,`${row.id}のArchitectureNode`);}
 for(const row of core.tasks){if(!nonEmpty(row.id)||!nonEmpty(row.title)||typeof row.workBoxId!=='string'||typeof row.body!=='string'||!enumHas(taskStatuses,row.status)||typeof row.requiresHumanApproval!=='boolean'){issues.push(`Taskの形式が不正です: ${String(row.id)}`);continue;}const deps=requireStrings(row.dependsOnTaskIds,`${row.id}の依存Task`),criteria=requireStrings(row.acceptanceCriteria,`${row.id}の完了条件`);if(!criteria.length)issues.push(`Taskの完了条件が未登録です: ${row.id}`);requireRef('workBox',row.workBoxId,`${row.id}のWorkBox`);for(const id of deps){requireRef('task',id,`${row.id}の依存Task`);if(id===row.id)issues.push(`Taskは自分自身に依存できません: ${row.id}`);}}
 if(core.tasks.every(row=>Array.isArray(row.dependsOnTaskIds)))issues.push(...dependencyCycleIssues(core.tasks));
 for(const row of core.decisions)if(!nonEmpty(row.id)||!nonEmpty(row.title)||typeof row.body!=='string'||typeof row.rationale!=='string'||!enumHas(decisionStatuses,row.status))issues.push(`Decisionの形式が不正です: ${String(row.id)}`);
 for(const row of core.issues)if(!nonEmpty(row.id)||!nonEmpty(row.title)||typeof row.body!=='string'||!enumHas(issueStatuses,row.status))issues.push(`Issueの形式が不正です: ${String(row.id)}`);
 for(const row of core.checks){if(!nonEmpty(row.id)||!nonEmpty(row.title)||!enumHas(checkStatuses,row.status)||!enumHas(['task','decision','pathEntry'],row.targetType)||typeof row.result!=='string'||typeof row.evidenceText!=='string'){issues.push(`Checkの形式が不正です: ${String(row.id)}`);continue;}requireRef(row.targetType,row.targetId,`${row.id}の検証対象`);for(const id of requireStrings(row.resolvesCheckIds,`${row.id}の解決元Check`)){requireRef('check',id,`${row.id}の解決元Check`);if(id===row.id)issues.push(`Checkは自分自身を解決できません: ${row.id}`);}}
 for(const row of core.approvals)if(!nonEmpty(row.id)||!enumHas(approvalStatuses,row.status)||!enumHas(['implementation','completion','protected_change'],row.kind)||typeof row.approvedBy!=='string'||typeof row.approvedAt!=='string')issues.push(`Approvalの形式が不正です: ${String(row.id)}`);
 for(const row of core.evidences){if(!nonEmpty(row.id)||!nonEmpty(row.title)||!enumHas(evidenceKinds,row.kind)||typeof row.currentVersionId!=='string'||typeof row.description!=='string'){issues.push(`Evidenceの形式が不正です: ${String(row.id)}`);continue;}if(row.currentVersionId){requireRef('evidenceVersion',row.currentVersionId,`${row.id}のcurrent EvidenceVersion`);const v=core.evidenceVersions.find(x=>x.id===row.currentVersionId);if(v&&v.evidenceId!==row.id)issues.push(`Evidence currentVersionが別Evidenceを参照しています: ${row.id}`);}}
 for(const row of core.evidenceVersions){if(!nonEmpty(row.id)||typeof row.evidenceId!=='string'||!Number.isInteger(row.versionNo)||row.versionNo<1||!nonEmpty(row.originalFilename)||!nonEmpty(row.mimeType)||!Number.isInteger(row.byteSize)||row.byteSize<1||!sha256Pattern.test(row.sha256)){issues.push(`EvidenceVersionの形式が不正です: ${String(row.id)}`);continue;}requireRef('evidence',row.evidenceId,`${row.id}のEvidence`);}
 for(const row of core.repositories)if(!nonEmpty(row.id)||!nonEmpty(row.provider)||!nonEmpty(row.owner)||!nonEmpty(row.name)||!nonEmpty(row.defaultBranch))issues.push(`Repositoryの形式が不正です: ${String(row.id)}`);
 for(const row of core.repositoryBaselines){if(!nonEmpty(row.id)||typeof row.repositoryId!=='string'||typeof row.recordedAt!=='string'){issues.push(`RepositoryBaselineの形式が不正です: ${String(row.id)}`);continue;}requireRef('repository',row.repositoryId,`${row.id}のRepository`);if(!/^[a-f0-9]{40,64}$/i.test(row.commitSha))issues.push(`RepositoryBaselineのcommit SHAが不正です: ${row.id}`);}
 for(const row of core.pathEntries){if(!nonEmpty(row.id)||typeof row.repositoryId!=='string'||typeof row.baselineId!=='string'||typeof row.parentId!=='string'||!nonEmpty(row.path)||!enumHas(pathEntryTypes,row.entryType)||typeof row.baselineHash!=='string'||!enumHas(pathProtectionStates,row.protection)||typeof row.protectionReason!=='string'){issues.push(`PathEntryの形式が不正です: ${String(row.id)}`);continue;}requireRef('repository',row.repositoryId,`${row.id}のRepository`);requireRef('repositoryBaseline',row.baselineId,`${row.id}のBaseline`);if(row.parentId){requireRef('pathEntry',row.parentId,`${row.id}の親PathEntry`);if(row.parentId===row.id)issues.push(`PathEntryは自分自身を親にできません: ${row.id}`);const parent=core.pathEntries.find(x=>x.id===row.parentId);if(parent&&parent.repositoryId!==row.repositoryId)issues.push(`PathEntryの親は同じRepositoryでなければなりません: ${row.id}`);if(parent&&parent.baselineId!==row.baselineId)issues.push(`PathEntryの親は同じBaselineでなければなりません: ${row.id}`);if(parent&&parent.entryType!=='directory')issues.push(`PathEntryの親はdirectoryでなければなりません: ${row.id}`);if(parent&&!row.path.startsWith(parent.path+'/'))issues.push(`PathEntryのpathは親path配下でなければなりません: ${row.id}`);}if(row.baselineHash&&!sha256Pattern.test(row.baselineHash))issues.push(`PathEntryのbaselineHashが不正です: ${row.id}`);}
 issues.push(...parentCycleIssues(core.pathEntries.filter(r=>nonEmpty(r.id)&&typeof r.parentId==='string'),'PathEntry'));
 const pathKeys=new Set<string>();for(const row of core.pathEntries){if(!nonEmpty(row.repositoryId)||!nonEmpty(row.baselineId)||!nonEmpty(row.path))continue;const key=`${row.repositoryId}\u0000${row.baselineId}\u0000${row.path}`;if(pathKeys.has(key))issues.push(`同一Baseline内でPathが重複しています: ${row.path}`);pathKeys.add(key);}
 for(const row of core.plannedChanges){if(!nonEmpty(row.id)||typeof row.pathEntryId!=='string'||!enumHas(plannedChangeActions,row.action)||typeof row.beforePath!=='string'||typeof row.afterPath!=='string'||typeof row.reason!=='string'||typeof row.requiresHumanApproval!=='boolean'){issues.push(`PlannedChangeの形式が不正です: ${String(row.id)}`);continue;}requireRef('pathEntry',row.pathEntryId,`${row.id}のPathEntry`);if(row.action==='move'&&!nonEmpty(row.afterPath))issues.push(`moveにはafterPathが必要です: ${row.id}`);if(row.action==='delete'&&row.afterPath)issues.push(`deleteではafterPathを指定できません: ${row.id}`);}
 for(const row of core.actualChanges){if(!nonEmpty(row.id)||typeof row.plannedChangeId!=='string'||typeof row.beforeHash!=='string'||typeof row.afterHash!=='string'||typeof row.diffSummary!=='string'){issues.push(`ActualChangeの形式が不正です: ${String(row.id)}`);continue;}requireRef('plannedChange',row.plannedChangeId,`${row.id}のPlannedChange`);if(!/^[a-f0-9]{40,64}$/i.test(row.commitSha))issues.push(`ActualChangeのcommit SHAが不正です: ${row.id}`);if(row.beforeHash&&!sha256Pattern.test(row.beforeHash))issues.push(`ActualChangeのbeforeHashが不正です: ${row.id}`);if(row.afterHash&&!sha256Pattern.test(row.afterHash))issues.push(`ActualChangeのafterHashが不正です: ${row.id}`);}
 for(const row of core.relations){if(!nonEmpty(row.id)||!enumHas(relationTypes,row.type)||!enumHas(coreEntityTypes,row.fromType)||!enumHas(coreEntityTypes,row.toType)||!nonEmpty(row.fromId)||!nonEmpty(row.toId)){issues.push(`Relationの形式が不正です: ${String(row.id)}`);continue;}const type=row.type as RelationType,from=row.fromType as CoreEntityType,to=row.toType as CoreEntityType;const allowed=relationRules[type];if(!allowed.some(([a,b])=>a===from&&b===to))issues.push(`Relationの型組合せが不正です: ${row.id} ${from} -${type}-> ${to}`);requireRef(from,row.fromId,`${row.id}のfrom`);requireRef(to,row.toId,`${row.id}のto`);if(type==='resolves_check'&&row.fromId===row.toId)issues.push(`Checkは自分自身を解決できません: ${row.id}`);}
 return [...new Set(issues)];
}

export function isCoreState(value:unknown):value is CoreState{return coreStateIssues(value).length===0;}

function sameRecord(a:unknown,b:unknown){return JSON.stringify(a)===JSON.stringify(b);}
function byId<T extends {id:string}>(rows:T[]){return new Map(rows.map(row=>[row.id,row]));}
/** Existing typed records are history-bearing. New records may be appended, but fixed evidence/version/baseline/change records are not rewritten or removed. */
export function coreTransitionIssues(previous:CoreState|undefined,next:CoreState|undefined):string[]{
 if(!previous)return [];
 if(!next)return ['型付き業務中核を保存後に削除することはできません'];
 const issues:string[]=[];
 const immutable=<T extends {id:string}>(label:string,oldRows:T[],newRows:T[])=>{const current=byId(newRows);for(const old of oldRows){const row=current.get(old.id);if(!row)issues.push(`${label}を削除できません: ${old.id}`);else if(!sameRecord(old,row))issues.push(`${label}を上書きできません: ${old.id}`);}};
 immutable('EvidenceVersion',previous.evidenceVersions,next.evidenceVersions);
 immutable('RepositoryBaseline',previous.repositoryBaselines,next.repositoryBaselines);
 immutable('PlannedChange',previous.plannedChanges,next.plannedChanges);
 immutable('ActualChange',previous.actualChanges,next.actualChanges);
 immutable('Relation',previous.relations,next.relations);
 const nextEvidence=byId(next.evidences),versions=byId(next.evidenceVersions);
 for(const old of previous.evidences){const row=nextEvidence.get(old.id);if(!row){issues.push(`Evidenceを削除できません: ${old.id}`);continue;}if(old.title!==row.title||old.kind!==row.kind||old.description!==row.description)issues.push(`Evidenceの既存メタデータを上書きできません: ${old.id}`);if(old.currentVersionId&&row.currentVersionId!==old.currentVersionId){const before=versions.get(old.currentVersionId),after=versions.get(row.currentVersionId);if(!after||after.evidenceId!==old.id)issues.push(`Evidence currentVersionが不正です: ${old.id}`);else if(before&&after.versionNo<before.versionNo)issues.push(`Evidence currentVersionを古い版へ戻せません: ${old.id}`);}}
 const nextPaths=byId(next.pathEntries);
 for(const old of previous.pathEntries){const row=nextPaths.get(old.id);if(!row){issues.push(`PathEntryを削除できません: ${old.id}`);continue;}if(old.repositoryId!==row.repositoryId||old.baselineId!==row.baselineId||old.entryType!==row.entryType||old.baselineHash!==row.baselineHash)issues.push(`PathEntryの安定属性を変更できません: ${old.id}`);if(old.protection==='protected'&&row.protection!=='protected')issues.push(`保護Pathを通常扱いへ戻せません: ${old.id}`);}
 const nextChecks=byId(next.checks);for(const old of previous.checks){const row=nextChecks.get(old.id);if(!row){issues.push(`Check履歴を削除できません: ${old.id}`);continue;}if(old.status==='FAIL'&&!sameRecord(old,row))issues.push(`過去FAIL Checkを上書きできません: ${old.id}`);}
 return [...new Set(issues)];
}
