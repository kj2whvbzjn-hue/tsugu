import {applyChangeSet,ensureVersionStore,previewChangeSet} from './core.mjs';

export class EngineeringDesignApplicationService{
  constructor({repository,auditOutbox}){
    if(!repository?.get||!repository?.transaction||!repository?.saveWithinTransaction)throw new Error('Transactional repository is required');
    if(!auditOutbox?.recordAudit||!auditOutbox?.enqueue)throw new Error('Audit/outbox store is required');
    this.repository=repository;this.auditOutbox=auditOutbox;
  }
  async previewChangeSet({projectId,changeSetId}){
    const project=await this.repository.get(projectId);if(!project)throw Object.assign(new Error('Project not found'),{status:404,code:'PROJECT_NOT_FOUND'});
    return previewChangeSet(ensureVersionStore(project),changeSetId);
  }
  async applyChangeSet({projectId,changeSetId,actorUserId,traceId=null}){
    return this.repository.transaction(async repo=>{
      const project=await repo.get(projectId);if(!project)throw Object.assign(new Error('Project not found'),{status:404,code:'PROJECT_NOT_FOUND'});
      ensureVersionStore(project);
      const beforeRevision=project.revision;
      const beforeVersions=project.artifactVersions.length;
      applyChangeSet(project,changeSetId);
      ensureVersionStore(project);
      const applied=project.changeSets.find(x=>x.id===changeSetId);
      await repo.saveWithinTransaction(project);
      const audit=await this.auditOutbox.recordAudit({projectId,actorUserId,action:'changeset.apply',targetType:'change_set',targetId:changeSetId,traceId,detail:{beforeRevision,afterRevision:project.revision,versionCountBefore:beforeVersions,versionCountAfter:project.artifactVersions.length,itemCount:applied?.items?.length||0}});
      const event=await this.auditOutbox.enqueue({aggregateType:'project',aggregateId:projectId,eventType:'changeset.applied',payload:{projectId,changeSetId,actorUserId,beforeRevision,afterRevision:project.revision,auditLogId:audit?.id??null}});
      return {project,changeSet:applied,audit,event};
    });
  }
}
