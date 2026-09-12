const clone=x=>structuredClone(x);
const rowTime=x=>x instanceof Date?x.toISOString():x;

export class MemoryProjectRepository{
  constructor(projects=[]){this.projects=new Map(projects.map(p=>[p.id,clone(p)]))}
  async get(id){const p=this.projects.get(id);return p?clone(p):null}
  async list(){return [...this.projects.values()].map(clone)}
  async save(project){this.projects.set(project.id,clone(project));return clone(project)}
  async saveWithinTransaction(project){return this.save(project)}
  async transaction(fn){const snapshot=structuredClone([...this.projects.entries()]);try{return await fn(this)}catch(e){this.projects=new Map(snapshot);throw e}}
}

export class PostgresProjectRepository{
  constructor(client){if(!client?.query)throw new Error('Postgres client with query() is required');this.client=client}
  async get(id){
    const h=await this.client.query('select id,name,description,revision,settings,created_at,updated_at from projects where id=$1',[id]);
    if(!h.rows[0])return null;
    const r=h.rows[0],project={id:String(r.id),name:r.name,description:r.description||'',revision:Number(r.revision||1),settings:r.settings||{},createdAt:rowTime(r.created_at),updatedAt:rowTime(r.updated_at)};
    const [ar,vr,rr,cr,cir,air,rsr]=await Promise.all([
      this.client.query('select * from artifacts where project_id=$1 order by created_at,id',[id]),
      this.client.query('select av.* from artifact_versions av join artifacts a on a.id=av.artifact_id where a.project_id=$1 order by av.artifact_id,av.version',[id]),
      this.client.query('select * from relations where project_id=$1 order by created_at,id',[id]),
      this.client.query('select * from change_sets where project_id=$1 order by created_at,id',[id]),
      this.client.query('select csi.* from change_set_items csi join change_sets cs on cs.id=csi.change_set_id where cs.project_id=$1 order by csi.created_at,csi.id',[id]),
      this.client.query('select * from ai_candidates where project_id=$1 order by created_at,id',[id]),
      this.client.query('select * from readiness_snapshots where project_id=$1 order by created_at,id',[id])
    ]);
    const itemsByCs=new Map();for(const x of cir.rows){const k=String(x.change_set_id);if(!itemsByCs.has(k))itemsByCs.set(k,[]);itemsByCs.get(k).push({...(x.payload||{}),id:String(x.id),kind:x.operation,targetId:x.target_id?String(x.target_id):undefined})}
    project.artifacts=ar.rows.map(x=>({id:String(x.id),projectId:String(x.project_id),key:x.key,type:x.type,title:x.title,description:x.description||'',status:x.status,knowledgeState:x.knowledge_state,version:x.current_version,revision:Number(x.revision||1),currentVersionId:x.current_version_id?String(x.current_version_id):null,tags:x.tags||[],sourceIds:x.metadata?.sourceIds||[],metadata:x.metadata||{},reviewRequired:!!x.review_required,createdAt:rowTime(x.created_at),updatedAt:rowTime(x.updated_at),payload:{}}));
    project.artifactVersions=vr.rows.map(x=>({id:String(x.id),artifactId:String(x.artifact_id),version:x.version,schemaVersion:x.schema_version,title:x.title,description:x.description||'',payload:x.payload||{},knowledgeAnnotations:x.knowledge_annotations||[],changeSetId:x.change_set_id?String(x.change_set_id):undefined,createdBy:x.created_by?String(x.created_by):undefined,createdAt:rowTime(x.created_at)}));
    const versionById=new Map(project.artifactVersions.map(v=>[v.id,v]));for(const a of project.artifacts)a.payload=clone(versionById.get(a.currentVersionId)?.payload||{});
    project.relations=rr.rows.map(x=>({id:String(x.id),projectId:String(x.project_id),fromArtifactId:String(x.from_artifact_id),toArtifactId:String(x.to_artifact_id),type:x.type,status:x.status,source:x.source,confidence:x.confidence==null?undefined:Number(x.confidence),rationale:x.rationale||undefined,metadata:x.metadata||{},createdAt:rowTime(x.created_at),updatedAt:rowTime(x.updated_at)}));
    project.changeSets=cr.rows.map(x=>({id:String(x.id),projectId:String(x.project_id),title:x.title,description:x.description||'',status:x.status,baseRevision:Number(x.base_revision),actorUserId:x.actor_user_id?String(x.actor_user_id):undefined,createdAt:rowTime(x.created_at),updatedAt:rowTime(x.updated_at),items:itemsByCs.get(String(x.id))||[]}));
    project.aiCandidates=air.rows.map(x=>({id:String(x.id),projectId:String(x.project_id),requestId:x.request_id?String(x.request_id):undefined,operation:x.operation,targetArtifactId:x.target_artifact_id?String(x.target_artifact_id):null,proposedType:x.proposed_type,proposedPayload:x.proposed_payload||{},provenance:x.provenance||{},confidence:x.confidence==null?0:Number(x.confidence),status:x.status,createdAt:rowTime(x.created_at),resolvedAt:rowTime(x.resolved_at)}));
    project.readinessSnapshots=rsr.rows.map(x=>({id:String(x.id),projectId:String(x.project_id),gateId:x.stage,status:x.status,score:Number(x.score),...(x.result||{}),artifactVersionIds:(x.artifact_version_ids||[]).map(String),validationIssueIds:(x.validation_issue_ids||[]).map(String),createdAt:rowTime(x.created_at)}));
    return project;
  }
  async list(){const r=await this.client.query('select id from projects order by created_at');const out=[];for(const row of r.rows)out.push(await this.get(String(row.id)));return out}
  async saveProjectHeader(project){const r=await this.client.query(`insert into projects(id,name,description,revision,settings,created_at,updated_at) values($1,$2,$3,$4,$5::jsonb,coalesce($6::timestamptz,now()),now()) on conflict(id) do update set name=excluded.name,description=excluded.description,revision=excluded.revision,settings=excluded.settings,updated_at=now() returning *`,[project.id,project.name,project.description||null,project.revision||1,JSON.stringify(project.settings||{}),project.createdAt||null]);return r.rows[0]}
  async save(project){return this.transaction(()=>this.saveWithinTransaction(project))}
  async saveWithinTransaction(project){await this.saveProjectHeader(project);await this.replaceAggregate(project);return project}
  async replaceAggregate(project){
    const id=project.id;
    await this.client.query('delete from readiness_snapshots where project_id=$1',[id]);
    await this.client.query('delete from ai_candidates where project_id=$1',[id]);
    await this.client.query('update artifacts set current_version_id=null where project_id=$1',[id]);
    await this.client.query('delete from artifact_versions where artifact_id in (select id from artifacts where project_id=$1)',[id]);
    await this.client.query('delete from change_set_items where change_set_id in (select id from change_sets where project_id=$1)',[id]);
    await this.client.query('delete from change_sets where project_id=$1',[id]);
    await this.client.query('delete from relations where project_id=$1',[id]);
    await this.client.query('delete from artifacts where project_id=$1',[id]);
    for(const a of project.artifacts||[])await this.client.query(`insert into artifacts(id,project_id,key,type,title,description,status,knowledge_state,current_version,current_version_id,tags,metadata,revision,review_required,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,null,$10,$11::jsonb,$12,$13,coalesce($14::timestamptz,now()),coalesce($15::timestamptz,now()))`,[a.id,id,a.key,a.type,a.title,a.description||null,a.status,a.knowledgeState||'undefined',a.version||1,a.tags||[],JSON.stringify({...a.metadata,sourceIds:a.sourceIds||[]}),a.revision||1,!!a.reviewRequired,a.createdAt||null,a.updatedAt||null]);
    for(const cs of project.changeSets||[])await this.client.query(`insert into change_sets(id,project_id,title,description,status,base_revision,actor_user_id,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz,now()),coalesce($9::timestamptz,now()))`,[cs.id,id,cs.title,cs.description||null,cs.status||'open',cs.baseRevision||project.revision||1,cs.actorUserId||null,cs.createdAt||null,cs.updatedAt||cs.appliedAt||null]);
    for(const v of project.artifactVersions||[])await this.client.query(`insert into artifact_versions(id,artifact_id,version,schema_version,title,description,payload,knowledge_annotations,change_set_id,created_by,created_at) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,coalesce($11::timestamptz,now()))`,[v.id,v.artifactId,v.version,v.schemaVersion||1,v.title,v.description||null,JSON.stringify(v.payload||{}),JSON.stringify(v.knowledgeAnnotations||[]),v.changeSetId||null,v.createdBy||null,v.createdAt||null]);
    for(const a of project.artifacts||[])if(a.currentVersionId)await this.client.query('update artifacts set current_version_id=$1 where id=$2',[a.currentVersionId,a.id]);
    for(const r of project.relations||[])await this.client.query(`insert into relations(id,project_id,from_artifact_id,to_artifact_id,type,status,source,confidence,rationale,metadata,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,coalesce($11::timestamptz,now()),coalesce($12::timestamptz,now()))`,[r.id,id,r.fromArtifactId,r.toArtifactId,r.type,r.status||'active',r.source||'human',r.confidence??null,r.rationale||null,JSON.stringify(r.metadata||{}),r.createdAt||null,r.updatedAt||null]);
    for(const cs of project.changeSets||[])for(const item of cs.items||[])await this.client.query(`insert into change_set_items(id,change_set_id,operation,target_id,payload) values($1,$2,$3,$4,$5::jsonb)`,[item.id,cs.id,item.kind,item.artifactId||item.targetId||item.relationId||item.artifact?.id||null,JSON.stringify(item)]);
    for(const c of project.aiCandidates||[])await this.client.query(`insert into ai_candidates(id,project_id,request_id,operation,target_artifact_id,proposed_type,proposed_payload,provenance,confidence,status,created_at,resolved_at) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,coalesce($11::timestamptz,now()),$12)`,[c.id,id,c.requestId||null,c.operation,c.targetArtifactId||null,c.proposedType||null,JSON.stringify(c.proposedPayload||{}),JSON.stringify(c.provenance||{}),c.confidence??null,c.status||'pending',c.createdAt||null,c.resolvedAt||null]);
    for(const s of project.readinessSnapshots||[])await this.client.query(`insert into readiness_snapshots(id,project_id,stage,status,score,result,artifact_version_ids,validation_issue_ids,created_at) values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,coalesce($9::timestamptz,now()))`,[s.id,id,s.gateId||s.stage||'implementation',s.status,s.score,JSON.stringify(s),s.artifactVersionIds||[],s.validationIssueIds||[],s.createdAt||null]);
  }
  async transaction(fn){await this.client.query('begin');try{const value=await fn(this);await this.client.query('commit');return value}catch(e){await this.client.query('rollback');throw e}}
}
