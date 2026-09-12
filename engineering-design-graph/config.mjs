function required(env,name){const value=env[name];if(!value)throw new Error(`Missing required environment variable: ${name}`);return value}
function positiveInt(value,fallback,name){const n=value==null?fallback:Number(value);if(!Number.isInteger(n)||n<=0)throw new Error(`${name} must be a positive integer`);return n}
export function loadRuntimeConfig(env=process.env){
  const port=positiveInt(env.PORT,4180,'PORT'),dbMax=positiveInt(env.PGPOOL_MAX,10,'PGPOOL_MAX'),rateLimit=positiveInt(env.RATE_LIMIT_PER_MINUTE,120,'RATE_LIMIT_PER_MINUTE'),outboxIntervalMs=positiveInt(env.OUTBOX_INTERVAL_MS,5000,'OUTBOX_INTERVAL_MS');
  return{
    host:env.HOST||'127.0.0.1',port,
    database:{connectionString:env.DATABASE_URL||null,host:env.PGHOST||null,port:env.PGPORT?positiveInt(env.PGPORT,5432,'PGPORT'):5432,user:env.PGUSER||null,password:env.PGPASSWORD||null,database:env.PGDATABASE||null,max:dbMax,ssl:env.PGSSL==='require'?{rejectUnauthorized:env.PGSSL_REJECT_UNAUTHORIZED!=='false'}:false},
    oidc:{issuer:required(env,'OIDC_ISSUER'),audience:required(env,'OIDC_AUDIENCE'),jwksUrl:required(env,'OIDC_JWKS_URL')},
    rateLimit:{limit:rateLimit,windowMs:60_000},
    outbox:{intervalMs:outboxIntervalMs,brokerUrl:env.BROKER_URL||null,brokerSecret:env.BROKER_SECRET||null},
    telemetry:{otlpEndpoint:env.OTLP_ENDPOINT||null,otlpAuthorization:env.OTLP_AUTHORIZATION||null,exportIntervalMs:positiveInt(env.OTLP_INTERVAL_MS,15000,'OTLP_INTERVAL_MS')}
  };
}
export function publicConfigSummary(config){return{host:config.host,port:config.port,database:{host:config.database.host,port:config.database.port,database:config.database.database,max:config.database.max,ssl:!!config.database.ssl,connectionStringConfigured:!!config.database.connectionString},oidc:{issuer:config.oidc.issuer,audience:config.oidc.audience,jwksUrl:config.oidc.jwksUrl},rateLimit:{limit:config.rateLimit.limit,windowMs:config.rateLimit.windowMs},outbox:{intervalMs:config.outbox.intervalMs,brokerConfigured:!!config.outbox.brokerUrl},telemetry:{otlpConfigured:!!config.telemetry.otlpEndpoint,exportIntervalMs:config.telemetry.exportIntervalMs}}}
