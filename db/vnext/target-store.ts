import {env} from 'cloudflare:workers';
import type {Deployment,Environment,Repository,RepositoryBaseline,RepositoryCommitRef} from '@/app/vnext/domain/deployment-target';
import type {DeploymentTargetStore} from '@/app/vnext/server/deployment-target-service';

function db(){
  if(!env.DB)throw new Error('vNext D1 binding is unavailable');
  return env.DB;
}

type RepositoryRow={id:string;project_id:string;provider:string;external_ref:string;revision:number;created_at:string};
type EnvironmentRow={id:string;project_id:string;environment_key:string;provider_ref:string;revision:number;created_at:string};
type CommitRow={id:string;project_id:string;repository_id:string;repository_revision:number;commit_sha:string;tree_sha:string;created_at:string};
type BaselineRow={id:string;project_id:string;repository_id:string;repository_revision:number;commit_ref_id:string;commit_sha:string;tree_sha:string;manifest_digest:string;created_at:string};
type DeploymentRow={id:string;project_id:string;environment_id:string;environment_revision:number;repository_id:string;repository_revision:number;commit_ref_id:string;commit_sha:string;tree_sha:string;artifact_digest:string;config_version:string;schema_version:string;provider_deployment_ref:string;created_at:string};

const repositoryFromRow=(row:RepositoryRow):Repository=>({id:row.id,projectId:row.project_id,provider:row.provider,externalRef:row.external_ref,revision:row.revision,createdAt:row.created_at});
const environmentFromRow=(row:EnvironmentRow):Environment=>({id:row.id,projectId:row.project_id,key:row.environment_key,providerRef:row.provider_ref,revision:row.revision,createdAt:row.created_at});
const commitFromRow=(row:CommitRow):RepositoryCommitRef=>({id:row.id,projectId:row.project_id,repositoryId:row.repository_id,repositoryRevision:row.repository_revision,commitSha:row.commit_sha,treeSha:row.tree_sha,createdAt:row.created_at});
const baselineFromRow=(row:BaselineRow):RepositoryBaseline=>({id:row.id,projectId:row.project_id,repositoryId:row.repository_id,repositoryRevision:row.repository_revision,commitRefId:row.commit_ref_id,commitSha:row.commit_sha,treeSha:row.tree_sha,manifestDigest:row.manifest_digest,createdAt:row.created_at});
const deploymentFromRow=(row:DeploymentRow):Deployment=>({id:row.id,projectId:row.project_id,environmentId:row.environment_id,environmentRevision:row.environment_revision,repositoryId:row.repository_id,repositoryRevision:row.repository_revision,commitRefId:row.commit_ref_id,commitSha:row.commit_sha,treeSha:row.tree_sha,artifactDigest:row.artifact_digest,configVersion:row.config_version,schemaVersion:row.schema_version,providerDeploymentRef:row.provider_deployment_ref,createdAt:row.created_at});

export function vnextTargetStore():DeploymentTargetStore{
  return {
    async getRepositoryById(id){
      const row=await db().prepare('SELECT * FROM vnext_repositories WHERE id=?').bind(id).first<RepositoryRow>();
      return row?repositoryFromRow(row):null;
    },
    async getRepositoryByIdentity(projectId,provider,externalRef){
      const row=await db().prepare('SELECT * FROM vnext_repositories WHERE project_id=? AND provider=? AND external_ref=?').bind(projectId,provider,externalRef).first<RepositoryRow>();
      return row?repositoryFromRow(row):null;
    },
    async insertRepository(value){
      const database=db();
      const result=await database.prepare('INSERT INTO vnext_repositories (id,project_id,provider,external_ref,revision,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(value.id,value.projectId,value.provider,value.externalRef,value.revision,value.createdAt).run();
      if(result.meta.changes===1)return value;
      const row=await database.prepare('SELECT * FROM vnext_repositories WHERE project_id=? AND provider=? AND external_ref=?').bind(value.projectId,value.provider,value.externalRef).first<RepositoryRow>();
      if(!row)throw new Error('repository insert conflicted without matching identity');
      return repositoryFromRow(row);
    },
    async getEnvironmentById(id){
      const row=await db().prepare('SELECT * FROM vnext_environments WHERE id=?').bind(id).first<EnvironmentRow>();
      return row?environmentFromRow(row):null;
    },
    async getEnvironmentByKey(projectId,key){
      const row=await db().prepare('SELECT * FROM vnext_environments WHERE project_id=? AND environment_key=?').bind(projectId,key).first<EnvironmentRow>();
      return row?environmentFromRow(row):null;
    },
    async insertEnvironment(value){
      const database=db();
      const result=await database.prepare('INSERT INTO vnext_environments (id,project_id,environment_key,provider_ref,revision,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(value.id,value.projectId,value.key,value.providerRef,value.revision,value.createdAt).run();
      if(result.meta.changes===1)return value;
      const row=await database.prepare('SELECT * FROM vnext_environments WHERE project_id=? AND environment_key=?').bind(value.projectId,value.key).first<EnvironmentRow>();
      if(!row)throw new Error('environment insert conflicted without matching identity');
      return environmentFromRow(row);
    },
    async getCommitRefById(id){
      const row=await db().prepare('SELECT * FROM vnext_repository_commit_refs WHERE id=?').bind(id).first<CommitRow>();
      return row?commitFromRow(row):null;
    },
    async getCommitRefByRepositorySha(repositoryId,commitSha){
      const row=await db().prepare('SELECT * FROM vnext_repository_commit_refs WHERE repository_id=? AND commit_sha=?').bind(repositoryId,commitSha).first<CommitRow>();
      return row?commitFromRow(row):null;
    },
    async insertCommitRef(value){
      const database=db();
      const result=await database.prepare('INSERT INTO vnext_repository_commit_refs (id,project_id,repository_id,repository_revision,commit_sha,tree_sha,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(value.id,value.projectId,value.repositoryId,value.repositoryRevision,value.commitSha,value.treeSha,value.createdAt).run();
      if(result.meta.changes===1)return value;
      const row=await database.prepare('SELECT * FROM vnext_repository_commit_refs WHERE repository_id=? AND commit_sha=?').bind(value.repositoryId,value.commitSha).first<CommitRow>();
      if(!row)throw new Error('commit insert conflicted without matching repository+SHA identity');
      return commitFromRow(row);
    },
    async getBaselineById(id){
      const row=await db().prepare('SELECT * FROM vnext_repository_baselines WHERE id=?').bind(id).first<BaselineRow>();
      return row?baselineFromRow(row):null;
    },
    async insertBaseline(value){
      const result=await db().prepare('INSERT INTO vnext_repository_baselines (id,project_id,repository_id,repository_revision,commit_ref_id,commit_sha,tree_sha,manifest_digest,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(value.id,value.projectId,value.repositoryId,value.repositoryRevision,value.commitRefId,value.commitSha,value.treeSha,value.manifestDigest,value.createdAt).run();
      if(result.meta.changes!==1)throw new Error('baseline was not inserted');
      return value;
    },
    async getDeploymentById(id){
      const row=await db().prepare('SELECT * FROM vnext_deployments WHERE id=?').bind(id).first<DeploymentRow>();
      return row?deploymentFromRow(row):null;
    },
    async getDeploymentByProviderRef(environmentId,providerDeploymentRef){
      const row=await db().prepare('SELECT * FROM vnext_deployments WHERE environment_id=? AND provider_deployment_ref=?').bind(environmentId,providerDeploymentRef).first<DeploymentRow>();
      return row?deploymentFromRow(row):null;
    },
    async insertDeployment(value){
      const database=db();
      const result=await database.prepare('INSERT INTO vnext_deployments (id,project_id,environment_id,environment_revision,repository_id,repository_revision,commit_ref_id,commit_sha,tree_sha,artifact_digest,config_version,schema_version,provider_deployment_ref,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(value.id,value.projectId,value.environmentId,value.environmentRevision,value.repositoryId,value.repositoryRevision,value.commitRefId,value.commitSha,value.treeSha,value.artifactDigest,value.configVersion,value.schemaVersion,value.providerDeploymentRef,value.createdAt).run();
      if(result.meta.changes===1)return value;
      const row=await database.prepare('SELECT * FROM vnext_deployments WHERE environment_id=? AND provider_deployment_ref=?').bind(value.environmentId,value.providerDeploymentRef).first<DeploymentRow>();
      if(!row)throw new Error('deployment insert conflicted without matching provider identity');
      return deploymentFromRow(row);
    },
  };
}
