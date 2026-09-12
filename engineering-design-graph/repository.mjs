const clone=x=>structuredClone(x);
const rowTime=x=>x instanceof Date?x.toISOString():x;

export class MemoryProjectRepository{
  constructor(projects=[]){this.projects=new Map(projects.map(p=>[p.id,clone(p)]))}
  async get(id){const p=this.projects.get(id);return p?clone(p):null}
  async list(){return [...this.projects.values()].map(clone)}
  async save(project){this.projects.set(project.id,clone(project));return clone(project)}
  async transaction(fn){const snapshot=structuredClone([...this.projects.entries()]);try{return await fn(this)}catch(e){this.projects=new Map(snapshot);throw e}}
}

export class PostgresProjectRepository{
  constructor(client){if(!client?.query)throw new Error('Postgres client with query() is required');this.client=client}
  async get(id){
    const h=await this.client.query('select id,name,description,revision,settings,created_at,updated_at from projects where id=$1',[id]);
    if(!h.rows[0])return null;
    const project={id:String(h.rows[0].id),name:h.rows[0].name,description:h.rows[0].description||'',revision:Number(h.rows[0].revision||1),settings:h.rows[0].settings||{},createdAt:rowTime(h.rows[0].created_at),updatedAt:rowTime(h.rows[0].updated_at)};
    const [ar,vr,rr,cr,cir,air,rsr]=await Promise.all([
      this.client.query('select * from artifacts where project_id=$1 order by created_at,id',[id]),
      this.client.query('select av.* from artifact_versions av join artifacts a on a.id=av.artifact_id where a.project_id=$1 order by av.artifact_id,av.version',[id]),
      this.client.query('select * from relations where project_id=$1 order by created_at,id',[id]),
      this.client.query('select * from change_sets where project_id=$1 order by created_at,id',[id]),
      this.client.query('select csi.* from change_set_items csi join change_sets cs on cs.id=csi.change_set_id where cs.project_id=$1 order by csi.created_at,csi.id',[id]),
      this.client.query('select * from ai_candidates where project_id=$1 order by created_at,id',[id]),
      this.client.query('select * from readiness_snapshots where project_id=$1 order by created_at,id',[id])
    ]);
    const itemsByCs=new Map();for(const r of cir.rows){if(!itemsByCs.has(String(r.change_set_id)))itemsByCs.set(String(r.change_set_id),[]);itemsByCs.get(String(r.change_set_id)).push({id:String(r.id),...(r.payload||{}),kind:r.operation,targetId:r.target_id?String(r.target_id):undefined})}
    project.artifacts=ar.rows.map(r=>({id:String(r.id),projectId:String(r.project_id),key:r.key,type:r.type,title:r.title,description:r.description||'',status:r.status,knowledgeState:r.knowledge_state,version:r.current_version,revision:Number(r.revision||1),currentVersionId:r.current_version_id?String(r.current_version_id):null,tags:r.tags||[],sourceIds:r.metadata?.sourceIds||[],metadata:r.metadata||{},reviewRequired:!!r.review_required,createdAt:rowTime(r.created_at),updatedAt:rowTime(r.updated_at),payload:{}}));
    const versions=vr.rows.map(r=>({id:String(r.id),artifactId:String(r.artifact_id),version:r.version,schemaVersion:r.schema_version,title:r.title,description:r.description||'',payload:r.payload||{},knowledgeAnnotations:r.knowledge_annotations||[],changeSetId:r.change_set_id?String(r.change_set_id):undefined,createdBy:r.created_by?String(r.created_by):undefined,createdAt:rowTime(r.created_at)}));
    project.artifactVersions=versions;const latest=new Map(versions.map(v=>[v.id,v]));for(const a of project.artifacts)a.payload=clone(latest.get(a.currentVersionId)?.payload||{});
    project.relations=rr.rows.map(r=>({id:String(r.id),projectId:String(r.project_id),fromArtifactId:String(r.from_artifact_id),toArtifactId:String(r.to_artifact_id),type:r.type,status:r.status,source:r.source,confidence:r.confidence==null?undefined:Number(r.confidence),rationale:r.rationale||undefined,metadata:r.metadata||{},createdAt:rowTime(r.created_at),updatedAt:rowTime(r.updated_at)}));
    project.changeSets=cr.rows.map(r=>({id:String(r.id),projectId:String(r.project_id),title:r.title,description:r.description||'',status:r.status,baseRevision:Number(r.base_revision),actorUserId:r.actor_user_id?String(r.actor_user_id):undefined,createdAt:rowTime(r.created_at),updatedAt:rowTime(r.updated_at),items:itemsByCs.get(String(r.id))||[]}));
    project.aiCandidates=air.rows.map(r=>({id:String(r.id),projectId:String(r.project_id),requestId:r.request_id?String(r.request_id):undefined,operation:r.operation,targetArtifactId:r.target_artifact_id?String(r.target_artifact_id):null,proposedType:r.proposed_type,proposedPayload:r.proposed_payload||{},provenance:r.provenance||{},confidence:r.confidence==null?0:Number(r.confidence),status:r.status,createdAt:rowTime(r.created_at),resolvedAt:rowTime(r.resolved_at)}));
    project.readinessSnapshots=rsr.rows.map(r=>({id:String(r.id),projectId:String(r.project_id),gateId:r.stage,status:r.status,score:Number(r.score),...(r.result||{}),artifactVersionIds:(r.artifact_version_ids||[]).map(String),validationIssueIds:(r.validation_issue_ids||[]).map(String),createdAt:rowTime(r.created_at)}));
    return project;
  }
  async list(){const r=await this.client.query('select id from projects order by created_at');const out=[];for(const row of r.rows)out.push(await this.get(String(row.id)));return out}
  async saveProjectHeader(project){const r=await this.client.query(`insert into projects(id,name,description,revision,settings,created_at,updated_at) values($1,$2,$3,$4,$5::jsonb,coalesce($6::timestamptz,now()),now()) on conflict(id) do update set name=excluded.name,description=excluded.description,revision=excluded.revision,settings=excluded.settings,updated_at=now() returning *`,[project.id,project.name,project.description||null,project.revision||1,JSON.stringify(project.settings||{}),project.createdAt||null]);return r.rows[0]}
  async save(project){return this.transaction(async()=>{await this.saveProjectHeader(project);await this.replaceAggregate(project);return this.get(project.id)})}
  async replaceAggregate(project){
    const id=project.id;
    await this.client.query('delete from readiness_snapshots where project_id=$1',[id]);
    await this.client.query('delete from ai_candidates where project_id=$1',[id]);
    await this.client.query('delete from change_set_items where change_set_id in (select id from change_sets where project_id=$1)',[id]);
    await this.client.query('alter table artifact_versions drop constraint if exists artifact_versions_changeset_fk');
    await this.client.query('delete from change_sets where project_id=$1',[id]);
    await this.client.query('update artifacts set current_version_id=null where project_id=$1',[id]);
    await this.client.query('delete from artifact_versions where artifact_id in (select id from artifacts where project_id=$1)',[id]);
    await this.client.query('delete from relations where project_id=$1',[id]);
    await this.client.query('delete from artifacts where project_id=$1',[id]);
    for(const a of project.artifacts||[])await this.client.query(`insert into artifacts(id,project_id,key,type,title,description,status,knowledge_state,current_version,current_version_id,tags,metadata,revision,review_required,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,null,$10,$11::jsonb,$12,$13,coalesce($14::timestamptz,now()),coalesce($15::timestamptz,now()))`,[a.id,id,a.key,a.type,a.title,a.description||null,a.status,a.knowledgeState||'undefined',a.version||1,a.tags||[],JSON.stringify({...a.metadata,sourceIds:a.sourceIds||[]}),a.revision||1,!!a.reviewRequired,a.createdAt||null,a.updatedAt||null]);
    for(const v of project.artifactVersions||[])await this.client.query(`insert into artifact_versions(id,artifact_id,version,schema_version,title,description,payload,knowledge_annotations,change_set_id,created_by,created_at) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,null,$9,coalesce($10::timestamptz,now()))`,[v.id,v.artifactId,v.version,v.schemaVersion||1,v.title,v.description||null,JSON.stringify(v.payload||{}),JSON.stringify(v.knowledgeAnnotations||[]),v.createdBy||null,v.createdAt||null]);
    for(const a of project.artifacts||[])if(a.currentVersionId)await this.client.query('update artifacts set current_version_id=$1 where id=$2',[a.currentVersionId,a.id]);
    for(const r of project.relations||[])await this.client.query(`insert into relations(id,project_id,from_artifact_id,to_artifact_id,type,status,source,confidence,rationale,metadata,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,coalesce($11::timestamptz,now()),coalesce($12::timestamptz,now()))`,[r.id,id,r.fromArtifactId,r.toArtifactId,r.type,r.status||'active',r.source||'human',r.confidence??null,r.rationale||null,JSON.stringify(r.metadata||{}),r.createdAt||null,r.updatedAt||null]);
    for(const cs of project.changeSets||[]){await this.client.query(`insert into change_sets(id,project_id,title,description,status,base_revision,actor_user_id,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz,now()),coalesce($9::timestamptz,now()))`,[cs.id,id,cs.title,cs.description||null,cs.status||'open',cs.baseRevision||project.revision||1,cs.actorUserId||null,cs.createdAt||null,cs.updatedAt||cs.appliedAt||null]);for(const item of cs.items||[])await this.client.query(`insert into change_set_items(id,change_set_id,operation,target_id,payload) values($1,$2,$3,$4,$5::jsonb)`,[item.id,cs.id,item.kind,item.artifactId||item.targetId||item.relationId||item.artifact?.id||null,JSON.stringify(item)])}
    for(const v of project.artifactVersions||[])if(v.changeSetId)await this.client.query('update artifact_versions set change_set_id=$1 where id=$2',[v.changeSetId,v.id]);
    await this.client.query('alter table artifact_versions add constraint artifact_versions_changeset_fk foreign key (change_set_id) references change_sets(id)');
    for(const c of project.aiCandidates||[])await this.client.query(`insert into ai_candidates(id,project_id,request_id,operation,target_artifact_id,proposed_type,proposed_payload,provenance,confidence,status,created_at,resolved_at) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,coalesce($11::timestamptz,now()),$12)`,[c.id,id,c.requestId||null,c.operation,c.targetArtifactId||null,c.proposedType||null,JSON.stringify(c.proposedPayload||{}),JSON.stringify(c.provenance||{}),c.confidence??null,c.status||'pending',c.createdAt||null,c.resolvedAt||null]);
    for(const s of project.readinessSnapshots||[])await this.client.query(`insert into readiness_snapshots(id,project_id,stage,status,score,result,artifact_version_ids,validation_issue_ids,created_at) values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,coalesce($9::timestamptz,now()))`,[s.id,id,s.gateId||s.stage||'implementation',s.status,s.score,JSON.stringify(s),s.artifactVersionIds||[],s.validationIssueIds||[],s.createdAt||null]);
  }
  async transaction(fn){await this.client.query('begin');try{const value=await fn(this);await this.client.query('commit');return value}catch(e){await this.client.query('rollback');throw e}}
}
