import {createApiService} from './api-v1.mjs';

const isMutation=method=>!['GET','HEAD'].includes(String(method||'GET').toUpperCase());
const applyMatch=url=>String(url||'').match(/^\/api\/v1\/change-sets\/([^/?]+)\/apply(?:\?|$)/);

export async function createPersistentApiService({repository,seed=[],applicationService=null}={}){
  if(!repository?.list||!repository?.save)throw new Error('Repository with list() and save() is required');
  let projects=await repository.list();
  if(!projects.length&&seed.length){for(const p of seed)await repository.save(p);projects=await repository.list()}
  const api=createApiService(projects);
  async function reload(){api.projects.clear();for(const p of await repository.list())api.projects.set(p.id,p);return api.projects}
  async function handle(req){
    const special=String(req.method||'').toUpperCase()==='POST'?applyMatch(req.url):null;
    if(special&&applicationService){
      const result=await applicationService.applyChangeSet({changeSetId:special[1],actorUserId:req.headers?.['x-user-id']||'api-user',traceId:req.headers?.['x-request-id']||null});
      await reload();
      return {status:200,headers:{'content-type':'application/json','x-transactional-audit':'true'},body:{changeSet:result.changeSet,revision:result.project.revision}};
    }
    const before=structuredClone([...api.projects.entries()]);
    const response=await api.handle(req);
    if(isMutation(req.method)&&response.status>=200&&response.status<300){
      try{for(const p of api.projects.values())await repository.save(p)}catch(err){api.projects.clear();for(const [k,v] of before)api.projects.set(k,v);throw err}
    }
    return response;
  }
  return {handle,projects:api.projects,reload,repository,applicationService};
}
