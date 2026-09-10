import type {Item,Project} from './model';

/** One dependency rule for task packs, editors, proposals and persisted transitions. */
export function dependencyIssues(items:Item[],item:Item):string[]{
 const byId=new Map(items.map(i=>[i.id,i])),issues:string[]=[],visited=new Set<string>(),path=new Set<string>();
 const visit=(id:string)=>{
  if(path.has(id)){issues.push(`依存が循環しています: ${id}`);return;}
  if(visited.has(id))return;
  visited.add(id);path.add(id);
  const node=byId.get(id);
  if(!node||node.kind!=='作業'||!node.task){issues.push(`依存先の作業条件が見つかりません: ${id}`);}
  else for(const dep of node.task.dependsOn)visit(dep);
  path.delete(id);
 };
 if(item.task){visit(item.id);for(const id of item.task.dependsOn)if(byId.get(id)?.status!=='完了')issues.push(`依存作業が完了していません: ${id}`);}
 return [...new Set(issues)];
}

const executing=(i:Item)=>i.kind==='作業'&&['進行中','完了'].includes(i.status);
/** Historical imports and unchanged legacy inconsistencies remain editable, never silently repaired. */
export function taskTransitionIssues(previous:Pick<Project,'items'>|undefined,next:Pick<Project,'items'>):string[]{
 if(!previous)return [];
 const oldById=new Map(previous.items.map(i=>[i.id,i])),issues:string[]=[];
 for(const item of next.items){
  if(!executing(item))continue;
  const old=oldById.get(item.id),before=old?dependencyIssues(previous.items,old):[];
  const after=dependencyIssues(next.items,item);
  const changed=!old||old.status!==item.status||old.kind!==item.kind||JSON.stringify(old.task?.dependsOn)!==JSON.stringify(item.task?.dependsOn);
  for(const issue of after)if(changed||!before.includes(issue))issues.push(`${item.title}: ${issue}`);
  // Removing an unfinished prerequisite in the same edit must not authorize execution.
  if(old?.task&&changed){
   const retained=new Set(item.task?.dependsOn??[]);
   for(const id of old.task.dependsOn)if(!retained.has(id)&&next.items.find(i=>i.id===id)?.status!=='完了')issues.push(`${item.title}: 未完了の依存を外して実行状態にできません: ${id}`);
  }
 }
 return [...new Set(issues)];
}
