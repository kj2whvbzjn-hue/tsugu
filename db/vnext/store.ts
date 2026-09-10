import {env} from 'cloudflare:workers';
import type {Actor,BootstrapReceipt} from '@/app/vnext/domain/identity';
import type {AuditEvent} from '@/app/vnext/server/audit';
import type {BootstrapCommit,BootstrapStore} from '@/app/vnext/server/bootstrap';

function db(){
  if(!env.DB)throw new Error('vNext D1 binding is unavailable');
  return env.DB;
}

type ActorRow={id:string;subject_id:string;email_hash:string;created_at:string};
type ReceiptRow={id:string;generation:string;subject_id:string;actor_id:string;project_id:string;membership_id:string;config_fingerprint:string;created_at:string};

const actorFromRow=(row:ActorRow):Actor=>({id:row.id,subjectId:row.subject_id,emailHash:row.email_hash,createdAt:row.created_at});
const receiptFromRow=(row:ReceiptRow):BootstrapReceipt=>({id:row.id,generation:row.generation,subjectId:row.subject_id,actorId:row.actor_id,projectId:row.project_id,membershipId:row.membership_id,configFingerprint:row.config_fingerprint,createdAt:row.created_at});

export function vnextStore():BootstrapStore & {appendAudit:(event:AuditEvent)=>Promise<void>}{
  return {
    async getBootstrapReceipt(generation){
      const row=await db().prepare('SELECT * FROM vnext_bootstrap_receipts WHERE generation=?').bind(generation).first<ReceiptRow>();
      return row?receiptFromRow(row):null;
    },
    async getActorBySubject(subjectId){
      const row=await db().prepare('SELECT * FROM vnext_actors WHERE subject_id=?').bind(subjectId).first<ActorRow>();
      return row?actorFromRow(row):null;
    },
    async commitBootstrap(candidate:BootstrapCommit){
      const database=db();
      try{
        const results=await database.batch([
          database.prepare('INSERT INTO vnext_actors (id,subject_id,email_hash,created_at) VALUES (?,?,?,?) ON CONFLICT(subject_id) DO NOTHING').bind(candidate.actor.id,candidate.actor.subjectId,candidate.actor.emailHash,candidate.actor.createdAt),
          database.prepare('INSERT INTO vnext_roles (id,project_id,name,permissions_json,created_at) VALUES (?,?,?,?,?)').bind(candidate.role.id,candidate.role.projectId,candidate.role.name,JSON.stringify(candidate.role.permissions),candidate.role.createdAt),
          database.prepare('INSERT INTO vnext_project_memberships (id,project_id,actor_id,role_id,revision,created_at) VALUES (?,?,?,?,?,?)').bind(candidate.membership.id,candidate.membership.projectId,candidate.membership.actorId,candidate.membership.roleId,candidate.membership.revision,candidate.membership.createdAt),
          database.prepare('INSERT INTO vnext_bootstrap_receipts (id,generation,subject_id,actor_id,project_id,membership_id,config_fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(candidate.receipt.id,candidate.receipt.generation,candidate.receipt.subjectId,candidate.receipt.actorId,candidate.receipt.projectId,candidate.receipt.membershipId,candidate.receipt.configFingerprint,candidate.receipt.createdAt),
          database.prepare('INSERT INTO vnext_audit_logs (id,actor_id,subject_id,project_id,action,policy_version,resource_revision,result,reason_code,details_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(candidate.audit.id,candidate.audit.actorId||null,candidate.audit.subjectId,candidate.audit.projectId,candidate.audit.action,candidate.audit.policyVersion,candidate.audit.resourceRevision,candidate.audit.result,candidate.audit.reasonCode,candidate.audit.detailsJson,candidate.audit.createdAt),
        ]);
        if(results.length!==5||results[1].meta.changes!==1||results[2].meta.changes!==1||results[3].meta.changes!==1||results[4].meta.changes!==1)throw new Error('bootstrap batch did not commit exactly once');
      }catch(error){
        const existing=await database.prepare('SELECT * FROM vnext_bootstrap_receipts WHERE generation=?').bind(candidate.receipt.generation).first<ReceiptRow>();
        if(existing)return receiptFromRow(existing);
        throw error;
      }
      const row=await database.prepare('SELECT * FROM vnext_bootstrap_receipts WHERE generation=?').bind(candidate.receipt.generation).first<ReceiptRow>();
      if(!row)throw new Error('bootstrap receipt was not persisted');
      return receiptFromRow(row);
    },
    async appendAudit(event){
      const result=await db().prepare('INSERT INTO vnext_audit_logs (id,actor_id,subject_id,project_id,action,policy_version,resource_revision,result,reason_code,details_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(event.id,event.actorId||null,event.subjectId,event.projectId,event.action,event.policyVersion,event.resourceRevision,event.result,event.reasonCode,event.detailsJson,event.createdAt).run();
      if(result.meta.changes!==1)throw new Error('audit event was not appended');
    },
  };
}
