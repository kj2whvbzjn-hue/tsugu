import {createApiService} from './api-v1.mjs';

const isMutation=method=>!['GET','HEAD'].includes(String(method||'GET').toUpperCase());

export async function createPersistentApiService({repository,seed=[]}={}){
  if(!repository?.list||!repository?.save)throw new Error('Repository with list() and save() is required');
  let projects=await repository.list();
  if(!projects.length&&seed.length){for(const p of seed)await repository.save(p);projects=await repository.list()}
  const api=createApiService(projects);
  async function handle(req){
    const before=structuredClone([...api.projects.entries()]);
    const response=await api.handle(req);
    if(isMutation(req.method)&&response.status>=200&&response.status<300){
      try{for(const p of api.projects.values())await repository.save(p)}catch(err){api.projects.clear();for(const [k,v] of before)api.projects.set(k,v);throw err}
    }
    return response;
  }
  async function reload(){api.projects.clear();for(const p of await repository.list())api.projects.set(p.id,p);return api.projects}
  return {handle,projects:api.projects,reload,repository};
}
