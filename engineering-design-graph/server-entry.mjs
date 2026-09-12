import {loadRuntimeConfig,publicConfigSummary} from './config.mjs';
import {createOidcVerifier} from './security.mjs';
import {createEngineeringDesignRuntime} from './runtime.mjs';
import {createRateLimiter,createStructuredLogger} from './observability.mjs';
import {PostgresRateLimiter} from './postgres-rate-limit.mjs';
import {createHttpBroker,createInMemoryBroker} from './broker.mjs';
import {OutboxWorker} from './outbox-worker.mjs';
import {OutboxScheduler} from './outbox-scheduler.mjs';
import {createOtlpHttpExporter} from './telemetry.mjs';

export async function startEngineeringDesignServer({env=process.env,fetchFn=fetch,pgModule=null,logger=createStructuredLogger()}={}){
  const config=loadRuntimeConfig(env),pg=pgModule||await import('pg'),Pool=pg.Pool||pg.default?.Pool;if(!Pool)throw new Error('pg.Pool is required');
  const jwksResponse=await fetchFn(config.oidc.jwksUrl,{headers:{accept:'application/json'}});if(!jwksResponse.ok)throw new Error(`OIDC JWKS request failed: ${jwksResponse.status}`);const jwks=await jwksResponse.json();
  const verifyBearer=createOidcVerifier({issuer:config.oidc.issuer,audience:config.oidc.audience,jwks});
  const pool=new Pool(config.database.connectionString?{connectionString:config.database.connectionString,max:config.database.max,ssl:config.database.ssl}:{host:config.database.host,port:config.database.port,user:config.database.user,password:config.database.password,database:config.database.database,max:config.database.max,ssl:config.database.ssl});
  await pool.query('select 1');
  const rateLimiter=config.rateLimit.backend==='postgres'?new PostgresRateLimiter({pool,limit:config.rateLimit.limit,windowMs:config.rateLimit.windowMs}):createRateLimiter(config.rateLimit);
  const runtime=await createEngineeringDesignRuntime({pool,verifyBearer,logger,rateLimiter}),server=await runtime.gateway.listen(config.port,config.host);
  const publisher=config.outbox.brokerUrl?createHttpBroker({url:config.outbox.brokerUrl,secret:config.outbox.brokerSecret,fetchImpl:fetchFn}):createInMemoryBroker();
  const outboxWorker=new OutboxWorker({store:runtime.outbox,publisher}),outboxScheduler=new OutboxScheduler({worker:outboxWorker,intervalMs:config.outbox.intervalMs,logger}).start();
  let otlpTimer=null,otlpExporter=null;if(config.telemetry.otlpEndpoint){otlpExporter=createOtlpHttpExporter({endpoint:config.telemetry.otlpEndpoint,headers:config.telemetry.otlpAuthorization?{authorization:config.telemetry.otlpAuthorization}:{},fetchImpl:fetchFn});otlpTimer=setInterval(()=>{void otlpExporter.export(runtime.metrics).catch(error=>logger.warn('telemetry.export_failed',{message:String(error?.message||error)}))},config.telemetry.exportIntervalMs);otlpTimer.unref?.()}
  logger.info('server.started',{...publicConfigSummary(config),pid:process.pid});
  const close=async()=>{if(otlpTimer)clearInterval(otlpTimer);await outboxScheduler.stop();await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));await pool.end();logger.info('server.stopped',{pid:process.pid})};
  return{...runtime,pool,server,config,publisher,outboxWorker,outboxScheduler,otlpExporter,close};
}

if(import.meta.url===`file://${process.argv[1]}`){startEngineeringDesignServer().catch(error=>{console.error(JSON.stringify({timestamp:new Date().toISOString(),level:'error',event:'server.start_failed',message:String(error?.message||error)}));process.exitCode=1})}
