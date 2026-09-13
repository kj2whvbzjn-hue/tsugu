import {addChangeItem,applyChangeSet,artifactByKey,buildImplementationPackage,createChangeSet,ensureVersionStore,makeSampleProject,previewChangeSet,readiness,runValidation,trace,validationSummary,validateRelation} from './core.mjs';
import {acceptAICandidate,createLocalDemoProvider,ensureAIStore,rejectAICandidate,requestAICandidates} from './ai-engine.mjs';
import {createImplementationPackageArchive} from './package-archive.mjs';
const json=(status,body)=>({status,headers:{'content-type':'application/json'},body});
const binary=(status,body,headers={})=>({status,headers:{'content-type':'application/zip',...headers},body});
const problem=(status,code,title,detail)=>json(status,{type:`https://errors.local/${code.toLowerCase().replaceAll('_','-')}`,title,status,code,detail,traceId:crypto.randomUUID(),errors:[]});
const uuid=()=>crypto.randomUUID(), stamp=()=>new Date().toISOString();
export function createApiService(seed=[makeSampleProject()],{aiProvider=createLocalDemoProvider()}={}){
  const projects=new Map(seed.map(p=>[p.id,ensureAIStore(ensureVersionStore(structuredClone(p)))]));
  const findArtifact=id=>{for(const p of projects.values()){const a=p.artifacts.find(a=>a.id===id);if(a)return[p,a]}return[]};
  const findChangeSet=id=>{for(const p of projects.values()){const cs=p.changeSets.find(c=>c.id===id);if(cs)return[p,cs]}return[]};
  const findCandidate=id=>{for(const p of projects.values()){const c=p.aiCandidates?.find(c=>c.id===id);if(c)return[p,c]}return[]};
  async function handle(req){
    const method=req.method.toUpperCase(),url=new URL(req.url,'http://local'),path=url.pathname.replace(/\/$/,'')||'/',body=req.body||{},parts=path.split('/').filter(Boolean);
    if(parts[0]!=='api'||parts[1]!=='v1')return problem(404,'NOT_FOUND','Not found',path);
    const p=parts.slice(2);
    try{
      if(method==='POST'&&p.length===1&&p[0]==='projects'){const id=uuid(),t=stamp(),pr=ensureAIStore(ensureVersionStore({id,name:body.name||'Untitled Project',revision:1,artifacts:[],relations:[],changeSets:[],readinessSnapshots:[],createdAt:t,updatedAt:t}));projects.set(id,pr);return json(201,pr)}
      if(p[0]==='projects'&&p[1]){const project=projects.get(p[1]);if(!project)return problem(404,'PROJECT_NOT_FOUND','Project not found',p[1]);
        if(method==='GET'&&p.length===2)return json(200,project);
        if(method==='GET'&&p[2]==='summary')return json(200,{id:project.id,name:project.name,revision:project.revision,artifactCount:project.artifacts.length,relationCount:project.relations.length,aiCandidateCount:project.aiCandidates.length,validation:validationSummary(project),readiness:readiness(project)});
        if(method==='GET'&&p[2]==='artifacts'){let items=[...project.artifacts];for(const k of ['type','status'])if(url.searchParams.get(k))items=items.filter(a=>a[k]===url.searchParams.get(k));const q=url.searchParams.get('search')?.toLowerCase();if(q)items=items.filter(a=>`${a.key} ${a.title}`.toLowerCase().includes(q));return json(200,{items,nextCursor:null})}
        if(method==='POST'&&p[2]==='artifacts'){if(!body.key||!body.type)return problem(422,'ARTIFACT_INVALID','Artifact invalid','key and type are required');if(artifactByKey(project,body.key))return problem(409,'ARTIFACT_KEY_CONFLICT','Artifact key conflict',body.key);const id=uuid(),t=stamp(),a={id,projectId:project.id,key:body.key,type:body.type,title:body.title||body.key,description:body.description||'',status:'draft',knowledgeState:body.knowledgeState||'undefined',version:1,revision:1,currentVersionId:uuid(),tags:body.tags||[],sourceIds:body.sourceIds||[],metadata:body.metadata||{},payload:body.payload||{},createdAt:t,updatedAt:t};const cs=createChangeSet(project,`Create ${a.key}`);addChangeItem(cs,{kind:'create_artifact',artifact:a});return json(202,{changeSet:cs,artifact:a})}
        if(method==='POST'&&p[2]==='relations'){const r={id:uuid(),projectId:project.id,fromArtifactId:body.fromArtifactId,toArtifactId:body.toArtifactId,type:body.type,status:'active',source:'human',createdAt:stamp(),updatedAt:stamp()},vr=validateRelation(project,r);if(!vr.ok)return problem(422,'RELATION_INVALID','Relation invalid',vr.error);const cs=createChangeSet(project,'Create relation');addChangeItem(cs,{kind:'create_relation',relation:r});return json(202,{changeSet:cs,relation:r})}
        if(method==='GET'&&p[2]==='graph'){const root=url.searchParams.get('root'),depth=Number(url.searchParams.get('depth')||8),direction=url.searchParams.get('direction')||'downstream';return json(200,{root,direction,items:root?trace(project,root,direction,depth):[]})}
        if(method==='POST'&&p[2]==='validations'&&p[3]==='run')return json(200,validationSummary(project));
        if(method==='GET'&&p[2]==='validation-summary')return json(200,validationSummary(project));
        if(method==='GET'&&p[2]==='validation-issues')return json(200,{items:runValidation(project),nextCursor:null});
        if(method==='GET'&&p[2]==='readiness')return json(200,readiness(project));
        if(method==='POST'&&p[2]==='readiness'&&p[3]==='evaluate')return json(200,readiness(project));
        if(method==='POST'&&p[2]==='change-sets'){const cs=createChangeSet(project,body.title||'ChangeSet',body.actorUserId||'api-user');return json(201,cs)}
        if(method==='GET'&&p[2]==='ai-candidates')return json(200,{items:project.aiCandidates,nextCursor:null});
        if(method==='POST'&&p[2]==='ai-requests'){const result=await requestAICandidates(project,{role:body.role,targetArtifactId:body.targetArtifactId||null,input:body.input||'',provider:aiProvider,providerName:body.providerName||'local-demo',model:body.model||'deterministic-demo',actorUserId:body.actorUserId||'api-user'});return json(202,result)}
        if(method==='POST'&&p[2]==='implementation-packages'){
          if(url.searchParams.get('format')==='zip'||body.format==='zip'){const out=await createImplementationPackageArchive(project,body.taskIds||[],{override:!!body.readinessOverride,reason:body.reason||''});return binary(201,out.zip,{'content-disposition':`attachment; filename="${out.fileName}"`,'x-content-sha256':out.archiveHash,'x-manifest-sha256':out.manifest.hash})}
          const pkg=buildImplementationPackage(project,body.taskIds||[],{override:!!body.readinessOverride,reason:body.reason||''});return json(201,pkg)
        }
      }
      if(p[0]==='artifacts'&&p[1]){const [project,a]=findArtifact(p[1]);if(!a)return problem(404,'ARTIFACT_NOT_FOUND','Artifact not found',p[1]);
        if(method==='GET'&&p.length===2)return json(200,a);
        if(method==='PATCH'&&p.length===2){const cs=createChangeSet(project,`Update ${a.key}`);addChangeItem(cs,{kind:'update_artifact',artifactId:a.id,expectedRevision:Number(req.headers?.['if-match']||a.revision||1),previousStatus:a.status,patch:body});return json(202,{changeSet:cs})}
        if(method==='GET'&&p[2]==='versions')return json(200,{items:project.artifactVersions.filter(v=>v.artifactId===a.id),nextCursor:null});
        if(method==='GET'&&p[2]==='relations')return json(200,{items:project.relations.filter(r=>r.fromArtifactId===a.id||r.toArtifactId===a.id),nextCursor:null});
        if(method==='GET'&&p[2]==='trace')return json(200,{downstream:trace(project,a.id,'downstream'),upstream:trace(project,a.id,'upstream')});
      }
      if(p[0]==='change-sets'&&p[1]){const [project,cs]=findChangeSet(p[1]);if(!cs)return problem(404,'CHANGESET_NOT_FOUND','ChangeSet not found',p[1]);
        if(method==='GET'&&p.length===2)return json(200,cs);
        if(method==='POST'&&p[2]==='items'){addChangeItem(cs,body);return json(201,cs)}
        if(method==='POST'&&p[2]==='validate')return json(200,previewChangeSet(project,cs.id).validation);
        if(method==='POST'&&p[2]==='impact-preview')return json(200,previewChangeSet(project,cs.id));
        if(method==='POST'&&p[2]==='apply'){applyChangeSet(project,cs.id);ensureVersionStore(project);return json(200,{changeSet:project.changeSets.find(c=>c.id===cs.id),revision:project.revision})}
      }
      if(p[0]==='ai-candidates'&&p[1]){const [project,c]=findCandidate(p[1]);if(!c)return problem(404,'AI_CANDIDATE_NOT_FOUND','AI candidate not found',p[1]);
        if(method==='GET'&&p.length===2)return json(200,c);
        if(method==='POST'&&p[2]==='accept')return json(202,acceptAICandidate(project,c.id,{actorUserId:body.actorUserId||'api-user',editedPayload:body.editedPayload??null}));
        if(method==='POST'&&p[2]==='reject')return json(200,rejectAICandidate(project,c.id,{actorUserId:body.actorUserId||'api-user',reason:body.reason||''}));
      }
      return problem(404,'NOT_FOUND','Not found',path);
    }catch(e){const msg=String(e.message||e);if(msg.includes('conflict'))return problem(409,'REVISION_CONFLICT','Revision conflict',msg);if(msg.includes('NOT_READY'))return problem(422,'READINESS_NOT_READY','Implementation gate not ready',msg);if(msg.includes('validation failed'))return problem(422,'CHANGESET_VALIDATION_FAILED','Validation failed',msg);return problem(422,'REQUEST_FAILED','Request failed',msg)}
  }
  return {handle,projects};
}
