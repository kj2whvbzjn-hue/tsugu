import {PostgresProjectRepository} from './repository.mjs';
import {PostgresAuditOutboxStore} from './postgres-audit-outbox.mjs';
import {EngineeringDesignApplicationService} from './application-service.mjs';

export class PostgresEngineeringDesignUnitOfWork{
  constructor(pool){if(!pool?.connect)throw new Error('Postgres pool with connect() is required');this.pool=pool}
  async withClient(fn){
    const client=await this.pool.connect();
    try{return await fn(client)}finally{client.release?.()}
  }
  async applyChangeSet(input){
    return this.withClient(async client=>{
      const repository=new PostgresProjectRepository(client),auditOutbox=new PostgresAuditOutboxStore(client),service=new EngineeringDesignApplicationService({repository,auditOutbox});
      return service.applyChangeSet(input);
    });
  }
  async previewChangeSet(input){
    return this.withClient(async client=>{
      const repository=new PostgresProjectRepository(client),auditOutbox=new PostgresAuditOutboxStore(client),service=new EngineeringDesignApplicationService({repository,auditOutbox});
      return service.previewChangeSet(input);
    });
  }
}
