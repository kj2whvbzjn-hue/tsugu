export class MemoryProjectRepository{
  constructor(projects=[]){this.projects=new Map(projects.map(p=>[p.id,p]))}
  async get(id){return this.projects.get(id)||null}
  async list(){return [...this.projects.values()]}
  async save(project){this.projects.set(project.id,project);return project}
  async transaction(fn){const snapshot=structuredClone([...this.projects.entries()]);try{return await fn(this)}catch(e){this.projects=new Map(snapshot);throw e}}
}

export class PostgresProjectRepository{
  constructor(client){if(!client?.query)throw new Error('Postgres client with query() is required');this.client=client}
  async get(id){const r=await this.client.query('select id,name,revision,created_at,updated_at from projects where id=$1',[id]);return r.rows[0]||null}
  async list(){const r=await this.client.query('select id,name,revision,created_at,updated_at from projects order by created_at');return r.rows}
  async saveProjectHeader(project){const r=await this.client.query(`insert into projects(id,name,revision,created_at,updated_at) values($1,$2,$3,coalesce($4,now()),now()) on conflict(id) do update set name=excluded.name,revision=excluded.revision,updated_at=now() returning *`,[project.id,project.name,project.revision||1,project.createdAt||null]);return r.rows[0]}
  async transaction(fn){await this.client.query('begin');try{const value=await fn(this);await this.client.query('commit');return value}catch(e){await this.client.query('rollback');throw e}}
}
