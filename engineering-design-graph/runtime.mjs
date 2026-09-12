import {PostgresProjectRepository} from './repository.mjs';
import {PostgresEngineeringDesignUnitOfWork} from './postgres-unit-of-work.mjs';
import {ProjectAccessRepository} from './project-access.mjs';
import {PostgresAuditOutboxStore} from './postgres-audit-outbox.mjs';
import {createPersistentApiService} from './persistent-api.mjs';
import {createHttpGateway} from './http-server.mjs';
import {createStructuredLogger,createMetrics,createRateLimiter} from './observability.mjs';

export class PooledProjectRepository{
  constructor(pool){if(!pool?.connect)throw new Error('Postgres pool with connect() is required');this.pool=pool}
  async withRepository(fn){const client=await this.pool.connect();try{return await fn(new PostgresProjectRepository(client))}finally{client.release?.()}}
  get(id){return this.withRepository(repo=>repo.get(id))}
  list(){return this.withRepository(repo=>repo.list())}
  save(project){return this.withRepository(repo=>repo.save(project))}
}

export class PooledProjectAccessRepository{
  constructor(pool){if(!pool?.connect)throw new Error('Postgres pool with connect() is required');this.pool=pool}
  async withRepository(fn){const client=await this.pool.connect();try{return await fn(new ProjectAccessRepository(client))}finally{client.release?.()}}
  roleFor(projectId,userSubject){return this.withRepository(repo=>repo.roleFor(projectId,userSubject))}
  upsertMember(projectId,userSubject,role){return this.withRepository(repo=>repo.upsertMember(projectId,userSubject,role))}
  removeMember(projectId,userSubject){return this.withRepository(repo=>repo.removeMember(projectId,userSubject))}
  getPolicy(projectId){return this.withRepository(repo=>repo.getPolicy(projectId))}
  setPolicy(projectId,policy,updatedBy){return this.withRepository(repo=>repo.setPolicy(projectId,policy,updatedBy))}
}

export class PooledOutboxStore{
  constructor(pool){if(!pool?.connect)throw new Error('Postgres pool with connect() is required');this.pool=pool}
  async withStore(fn){const client=await this.pool.connect();try{return await fn(new PostgresAuditOutboxStore(client))}finally{client.release?.()}}
  pending(limit){return this.withStore(store=>store.pending(limit))}
  deadLetters(limit){return this.withStore(store=>store.deadLetters(limit))}
  markPublished(id){return this.withStore(store=>store.markPublished(id))}
  markFailed(id,error,options){return this.withStore(store=>store.markFailed(id,error,options))}
}

export async function createEngineeringDesignRuntime({pool,verifyBearer,seed=[],logger=createStructuredLogger(),metrics=createMetrics(),rateLimiter=createRateLimiter()}={}){
  if(!pool?.connect)throw new Error('Postgres pool with connect() is required');if(!verifyBearer)throw new Error('verifyBearer is required');
  const repository=new PooledProjectRepository(pool),projectAccessRepository=new PooledProjectAccessRepository(pool),unitOfWork=new PostgresEngineeringDesignUnitOfWork(pool);
  const api=await createPersistentApiService({repository,seed,applicationService:unitOfWork});
  const readinessCheck=async()=>{const client=await pool.connect();try{await client.query('select 1')}finally{client.release?.()}};
  const gateway=createHttpGateway({api,verifyBearer,projectAccessRepository,logger,metrics,rateLimiter,readinessCheck});
  return{repository,projectAccessRepository,outbox:new PooledOutboxStore(pool),unitOfWork,api,gateway,logger,metrics,rateLimiter,readinessCheck};
}
