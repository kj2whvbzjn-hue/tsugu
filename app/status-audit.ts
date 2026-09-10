import {isStatusForKind,type Project} from './model';
import {prepareImport} from './import-project';

export type StatusDifference={id:string;title:string;kind:string;current:string;expected:string;invalid:boolean};
/** Suggestions only: a difference can also be an intentional post-import edit. */
export function auditImportedStatuses(project:Project,original:unknown):StatusDifference[]{
  if(!original||typeof original!=='object'||!('workspace' in original))throw Error('元JSONの案件情報を確認できません');
  const workspace=(original as {workspace?:{id?:unknown}}).workspace;
  if(workspace?.id!==project.sourceInfo?.projectId)throw Error('元JSONと現在の案件の取込元IDが一致しません');
  const imported=prepareImport(original).project;
  const expected=new Map(imported.items.map(item=>[item.id,item]));
  return project.items.flatMap(item=>{
    const source=expected.get(item.id);
    const invalid=!isStatusForKind(item.kind,item.status);
    if(source&&source.kind===item.kind&&source.status!==item.status)return [{id:item.id,title:item.title,kind:item.kind,current:item.status,expected:source.status,invalid}];
    return [];
  });
}
