import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRuntimeConfig,publicConfigSummary} from '../engineering-design-graph/config.mjs';

test('runtime config requires OIDC settings and parses database/rate limit values',()=>{const config=loadRuntimeConfig({OIDC_ISSUER:'https://issuer.test',OIDC_AUDIENCE:'edg',OIDC_JWKS_URL:'https://issuer.test/jwks',PGHOST:'db',PGPORT:'5433',PGUSER:'edg',PGPASSWORD:'secret',PGDATABASE:'design',PGPOOL_MAX:'7',RATE_LIMIT_PER_MINUTE:'90',PORT:'4190'});assert.equal(config.port,4190);assert.equal(config.database.host,'db');assert.equal(config.database.port,5433);assert.equal(config.database.max,7);assert.equal(config.rateLimit.limit,90)});

test('public config summary never exposes database password',()=>{const config=loadRuntimeConfig({OIDC_ISSUER:'https://issuer.test',OIDC_AUDIENCE:'edg',OIDC_JWKS_URL:'https://issuer.test/jwks',PGPASSWORD:'top-secret'}),summary=publicConfigSummary(config),text=JSON.stringify(summary);assert.equal(text.includes('top-secret'),false);assert.equal('password' in summary.database,false)});

test('runtime config fails closed when OIDC variables are absent',()=>{assert.throws(()=>loadRuntimeConfig({}),/OIDC_ISSUER/)});
