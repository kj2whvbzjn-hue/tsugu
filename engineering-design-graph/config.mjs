import {readFileSync} from 'node:fs';
function fileOrValue(env,name){const file=env[`${name}_FILE`];if(file){const value=readFileSync(file,'utf8').trim();if(!value)throw new Error(`${name}_FILE is empty`);return value}return env[name]||null}
function required(env,name){const value=fileOrValue(env,name);if(!value)throw new Error(`Missing required environment variable: ${name}`);return value}
function positiveInt(value,fallback,name){const n=value==null?fallback:Number(value);if(!Number.isInteger(n)||n<=0)throw new Error(`${name} must be a positive integer`);return n}
export function loadRuntimeConfig(env=process.env){
  const port=positiveInt(env.PORT,4180,'PORT'),dbMax=positiveInt(env.PGPOOL_MAX,10,'PGPOOL_MAX'),rateLimit=positiveInt(env.RATE_LIMIT_PER_MINUTE,120,'RATE_LIMIT_PER_MINUTE'),outboxIntervalMs=positiveInt(env.OUTBOX_INTERVAL_MS,5000,'OUTBOX_INTERVAL_MS'),rateBackend=env.RATE_LIMIT_BACKEND||'memory';if(!['memory','postgres'].includes(rateBackend))throw new Error('RATE_LIMIT_BACKEND must be memory or postgres');
  return{
    host:env.HOST||'127.0.0.1',port,
    http:{bodyLimitBytes:positiveInt(env.HTTP_BODY_LIMIT_BYTES,1_048_576,'HTTP_BODY_LIMIT_BYTES'),requestTimeoutMs:positiveInt(env.HTTP_REQUEST_TIMEOUT_MS,30_000,'HTTP_REQUEST_TIMEOUT_MS'),headersTimeoutMs:positiveInt(env.HTTP_HEADERS_TIMEOUT_MS,15_000,'HTTP_HEADERS_TIMEOUT_MS'),keepAliveTimeoutMs:positiveInt(env.HTTP_KEEP_ALIVE_TIMEOUT_MS,5_000,'HTTP_KEEP_ALIVE_TIMEOUT_MS')},
    database:{connectionString:fileOrValue(env,'DATABASE_URL'),host:env.PGHOST||null,port:env.PGPORT?positiveInt(env.PGPORT,5432,'PGPORT'):5432,user:env.PGUSER||null,password:fileOrValue(env,'PGPASSWORD'),database:env.PGDATABASE||null,max:dbMax,ssl:env.PGSSL==='require'?{rejectUnauthorized:env.PGSSL_REJECT_UNAUTHORIZED!=='false'}:false},
    oidc:{issuer:required(env,'OIDC_ISSUER'),audience:required(env,'OIDC_AUDIENCE'),jwksUrl:required(env,'OIDC_JWKS_URL')},
    rateLimit:{backend:rateBackend,limit:rateLimit,windowMs:60_000},
    outbox:{intervalMs:outboxIntervalMs,brokerUrl:env.BROKER_URL||null,brokerSecret:fileOrValue(env,'BROKER_SECRET')},
    telemetry:{otlpEndpoint:env.OTLP_ENDPOINT||null,otlpAuthorization:fileOrValue(env,'OTLP_AUTHORIZATION'),exportIntervalMs:positiveInt(env.OTLP_INTERVAL_MS,15000,'OTLP_INTERVAL_MS')}
  };
}
export function publicConfigSummary(config){return{host:config.host,port:config.port,http:{bodyLimitBytes:config.http.bodyLimitBytes,requestTimeoutMs:config.http.requestTimeoutMs,headersTimeoutMs:config.http.headersTimeoutMs,keepAliveTimeoutMs:config.http.keepAliveTimeoutMs},database:{host:config.database.host,port:config.database.port,database:config.database.database,max:config.database.max,ssl:!!config.database.ssl,connectionStringConfigured:!!config.database.connectionString},oidc:{issuer:config.oidc.issuer,audience:config.oidc.audience,jwksUrl:config.oidc.jwksUrl},rateLimit:{backend:config.rateLimit.backend,limit:config.rateLimit.limit,windowMs:config.rateLimit.windowMs},outbox:{intervalMs:config.outbox.intervalMs,brokerConfigured:!!config.outbox.brokerUrl},telemetry:{otlpConfigured:!!config.telemetry.otlpEndpoint,exportIntervalMs:config.telemetry.exportIntervalMs}}}
