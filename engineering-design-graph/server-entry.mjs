import {loadRuntimeConfig,publicConfigSummary} from './config.mjs';
import {createOidcVerifier} from './security.mjs';
import {createEngineeringDesignRuntime} from './runtime.mjs';
import {createRateLimiter,createStructuredLogger} from './observability.mjs';

export async function startEngineeringDesignServer({env=process.env,fetchFn=fetch,pgModule=null,logger=createStructuredLogger()}={}){
  const config=loadRuntimeConfig(env),pg=pgModule||await import('pg'),Pool=pg.Pool||pg.default?.Pool;if(!Pool)throw new Error('pg.Pool is required');
  const jwksResponse=await fetchFn(config.oidc.jwksUrl,{headers:{accept:'application/json'}});if(!jwksResponse.ok)throw new Error(`OIDC JWKS request failed: ${jwksResponse.status}`);const jwks=await jwksResponse.json();
  const verifyBearer=createOidcVerifier({issuer:config.oidc.issuer,audience:config.oidc.audience,jwks});
  const pool=new Pool(config.database.connectionString?{connectionString:config.database.connectionString,max:config.database.max,ssl:config.database.ssl}:{host:config.database.host,port:config.database.port,user:config.database.user,password:config.database.password,database:config.database.database,max:config.database.max,ssl:config.database.ssl});
  await pool.query('select 1');
  const runtime=await createEngineeringDesignRuntime({pool,verifyBearer,logger,rateLimiter:createRateLimiter(config.rateLimit)}),server=await runtime.gateway.listen(config.port,config.host);
  logger.info('server.started',{...publicConfigSummary(config),pid:process.pid});
  const close=async()=>{await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));await pool.end();logger.info('server.stopped',{pid:process.pid})};
  return{...runtime,pool,server,config,close};
}

if(import.meta.url===`file://${process.argv[1]}`){startEngineeringDesignServer().catch(error=>{console.error(JSON.stringify({timestamp:new Date().toISOString(),level:'error',event:'server.start_failed',message:String(error?.message||error)}));process.exitCode=1})}
