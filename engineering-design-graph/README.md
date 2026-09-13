# Engineering Design Graph — standalone MVP

`engineering_design_graph_implementation_package.zip` の設計を、TSUGU既存UIと分離して検証できる実装領域です。PR #38はDraftのまま継続開発し、明示指示があるまで`main`へはマージしません。

## 実装済み

- Structured Artifact repository / immutable ArtifactVersion
- Relation / Traceability Graph / dependency cycle detection
- Requirement coverage / deterministic validation / change impact
- ChangeSet stage → preview → atomic apply / revision conflict
- Implementation Readiness gate (`READY`, `READY_WITH_WARNINGS`, `NOT_READY`)
- AI Provider Adapter / Candidate review / Accept→ChangeSet / Reject
- AI secret transmission governance
- task-rooted ZIP Implementation Package / SHA-256 manifest
- `/api/v1` service boundary / HTTP Gateway
- OIDC RS256/JWKS verification + unknown `kid` refresh
- RBAC (`viewer`, `editor`, `reviewer`, `architect`, `admin`)
- Project-scoped membership / policy persistence
- PostgreSQL shared Idempotency-Key reservation/replay for ChangeSet apply / AI request / export
- checksum-tracked PostgreSQL migrations with advisory lock / schema readiness check
- transactional ChangeSet Application Service / connection-scoped Unit of Work
- PostgreSQL HTTP Audit Log / Outbox persistence
- Outbox lease claim for multi-replica workers / exponential retry / DLQ-equivalent state
- HTTP CloudEvents broker publisher with optional HMAC signature
- Outbox scheduler with overlap protection and clean shutdown
- structured JSON logging / Prometheus `/metrics` / OTLP HTTP exporter
- in-memory or PostgreSQL distributed rate limit backend
- `/health/live` / database + migration-checksum-backed `/health/ready`
- production runtime config / `pg.Pool` server entrypoint
- HTTP request body size limit / request, header, keep-alive timeouts
- SIGTERM/SIGINT graceful shutdown
- Dockerfile / non-root production image
- Kubernetes Deployment + Service + ConfigMap + Secret + dev/prod overlays
- Kubernetes non-root / read-only root filesystem / capability drop / seccomp / service-account token disabled
- topology spread / startup-readiness-liveness probes / PodDisruptionBudget
- PostgreSQL migration Job template
- PostgreSQL backup/restore runbook and CI restore drill
- example Prometheus alert rules
- manual GHCR image release workflow (`publish=false` by default)
- Playwright UI E2E + authenticated HTTP E2E
- GitHub Actions + PostgreSQL 16 integration checks

## Transaction boundary

Production-oriented ChangeSet apply uses `EngineeringDesignApplicationService` and a connection-scoped PostgreSQL Unit of Work. The same checked-out database connection performs `BEGIN` → ChangeSet/Project resolution → deterministic apply/validation → Artifact/ArtifactVersion/Relation persistence → Audit → Outbox → `COMMIT`. Any failure before commit executes `ROLLBACK`.

## Authorization

OIDC identifies the user. For project-scoped API calls, `project_members` is the authoritative role source; global `admin` is the only membership bypass. Supported roles are `viewer`, `editor`, `reviewer`, `architect`, `admin`.

## Outbox / broker

`OutboxWorker` claims eligible unpublished events with a database lease before publishing. Separate replicas use `FOR UPDATE SKIP LOCKED` semantics so the same pending row is not selected by two workers at once. Failed delivery updates retry metadata and eventually enters the DLQ-equivalent state after the configured retry limit. The HTTP broker adapter emits CloudEvents-style JSON and can attach an HMAC SHA-256 signature.

## Observability

- `GET /health/live`: process liveness, no OIDC required
- `GET /health/ready`: PostgreSQL connectivity plus migration checksum readiness, no OIDC required
- `GET /metrics`: Prometheus text format, no OIDC required
- optional OTLP/HTTP periodic export via `OTLP_ENDPOINT`
- structured logs contain request/user/project/route/status/duration fields but not request bodies, bearer tokens, DB passwords, broker secrets or telemetry authorization values

## Production runtime

Required OIDC variables:

```text
OIDC_ISSUER
OIDC_AUDIENCE
OIDC_JWKS_URL
```

Database is configured by `DATABASE_URL` or standard `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`. Sensitive values may be mounted as files with the corresponding `*_FILE` variable. Optional runtime settings include:

```text
HTTP_BODY_LIMIT_BYTES=1048576
HTTP_REQUEST_TIMEOUT_MS=30000
HTTP_HEADERS_TIMEOUT_MS=15000
HTTP_KEEP_ALIVE_TIMEOUT_MS=5000
RATE_LIMIT_BACKEND=memory|postgres
RATE_LIMIT_PER_MINUTE=120
BROKER_URL
BROKER_SECRET
OUTBOX_INTERVAL_MS=5000
OTLP_ENDPOINT
OTLP_AUTHORIZATION
OTLP_INTERVAL_MS=15000
```

Run migrations before the application rollout:

```bash
cd engineering-design-graph
npm run migrate
```

The migration runner creates `schema_migrations`, serializes concurrent migration attempts with a PostgreSQL advisory lock, stores SHA-256 checksums, and rejects checksum drift.

Start the production HTTP service with Node after installing `pg`:

```bash
node engineering-design-graph/server-entry.mjs
```

Container/Kubernetes templates are under `engineering-design-graph/Dockerfile` and `engineering-design-graph/ops/`. The base manifest is hardened for non-root execution and read-only root filesystem. Deployment secrets must replace placeholders outside source control.

## Backup / restore

See `engineering-design-graph/ops/BACKUP_RESTORE.md`. The dedicated GitHub Actions workflow performs a real custom-format `pg_dump`, restores it into a clean database, and compares project/version/migration state before proceeding to Playwright.

## Static UI

For standalone UI-only inspection:

```bash
python3 -m http.server 8080
# http://localhost:8080/engineering-design-graph/
```

## Tests

```bash
npm run test:engineering-design
npm run test:engineering-design:e2e
```

The dedicated workflow validates migrations, unit/API/AI/security/operations tests, non-root Docker image build, Kubernetes security/deployment manifest sanity, real `pg.Pool` round-trip, cross-runtime PostgreSQL Idempotency replay, multi-worker Outbox leases, distributed rate limiting, backup/restore, and Playwright desktop/mobile UI plus authenticated HTTP E2E.

## Remaining deployment decisions

- choose and configure a managed broker-specific adapter only if the target platform requires Kafka/SNS/SQS/PubSub instead of the generic HTTP CloudEvents adapter
- choose the production secret-manager product and map it to env/file-mounted secret delivery
- define production RPO/RTO/SLO values and replace example alert thresholds
- define environment-specific Ingress / NetworkPolicy / certificate / DNS rules after the deployment platform and endpoints are known
