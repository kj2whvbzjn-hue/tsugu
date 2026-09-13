import {applyChangeSet,ensureVersionStore,previewChangeSet} from './core.mjs';

export class EngineeringDesignApplicationService{
  constructor({repository,auditOutbox}){
    if(!repository?.get||!repository?.transaction||!repository?.saveWithinTransaction)throw new Error('Transactional repository is required');
    if(!auditOutbox?.recordAudit||!auditOutbox?.enqueue)throw new Error('Audit/outbox store is required');
    this.repository=repository;this.auditOutbox=auditOutbox;
  }
  async resolveProjectId(projectId,changeSetId,repo=this.repository){if(projectId)return projectId;if(!repo.findProjectIdByChangeSetId)return null;return repo.findProjectIdByChangeSetId(changeSetId)}
  async previewChangeSet({projectId,changeSetId}){
    const resolved=await this.resolveProjectId(projectId,changeSetId),project=resolved?await this.repository.get(resolved):null;if(!project)throw Object.assign(new Error('Project not found'),{status:404,code:'PROJECT_NOT_FOUND'});
    return previewChangeSet(ensureVersionStore(project),changeSetId);
  }
  async applyChangeSet({projectId=null,changeSetId,actorUserId,traceId=null}){
    return this.repository.transaction(async repo=>{
      const resolved=await this.resolveProjectId(projectId,changeSetId,repo);if(!resolved)throw Object.assign(new Error('ChangeSet project not found'),{status:404,code:'CHANGESET_NOT_FOUND'});
      const project=await repo.get(resolved);if(!project)throw Object.assign(new Error('Project not found'),{status:404,code:'PROJECT_NOT_FOUND'});
      ensureVersionStore(project);
      const beforeRevision=project.revision,beforeVersions=project.artifactVersions.length;
      applyChangeSet(project,changeSetId);ensureVersionStore(project);
      const applied=project.changeSets.find(x=>x.id===changeSetId);
      await repo.saveWithinTransaction(project);
      const audit=await this.auditOutbox.recordAudit({projectId:resolved,actorUserId,action:'changeset.apply',targetType:'change_set',targetId:changeSetId,traceId,detail:{beforeRevision,afterRevision:project.revision,versionCountBefore:beforeVersions,versionCountAfter:project.artifactVersions.length,itemCount:applied?.items?.length||0}});
      const event=await this.auditOutbox.enqueue({aggregateType:'project',aggregateId:resolved,eventType:'changeset.applied',payload:{projectId:resolved,changeSetId,actorUserId,beforeRevision,afterRevision:project.revision,auditLogId:audit?.id??null}});
      return {project,changeSet:applied,audit,event};
    });
  }
}
