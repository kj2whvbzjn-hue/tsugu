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
- OIDC RS256/JWKS verification
- RBAC (`viewer`, `editor`, `reviewer`, `architect`, `admin`)
- Project-scoped membership / policy persistence
- Idempotency-Key for ChangeSet apply / AI request / export
- PostgreSQL migrations / Project aggregate repository
- transactional ChangeSet Application Service / connection-scoped Unit of Work
- Audit Log / Outbox / exponential retry / DLQ-equivalent state
- HTTP CloudEvents broker publisher with optional HMAC signature
- Outbox scheduler with overlap protection and clean shutdown
- structured JSON logging / Prometheus `/metrics` / OTLP HTTP exporter
- in-memory or PostgreSQL distributed rate limit backend
- `/health/live` / database-backed `/health/ready`
- production runtime config / OIDC JWKS bootstrap / `pg.Pool` server entrypoint
- Dockerfile / Kubernetes Deployment + Service + ConfigMap + Secret template
- PostgreSQL backup/restore runbook and CI restore drill
- Playwright UI E2E + authenticated HTTP E2E
- GitHub Actions + PostgreSQL 16 integration checks

## Transaction boundary

Production-oriented ChangeSet apply uses `EngineeringDesignApplicationService` and a connection-scoped PostgreSQL Unit of Work. The same checked-out database connection performs `BEGIN` → ChangeSet/Project resolution → deterministic apply/validation → Artifact/ArtifactVersion/Relation persistence → Audit → Outbox → `COMMIT`. Any failure before commit executes `ROLLBACK`.

## Authorization

OIDC identifies the user. For project-scoped API calls, `project_members` is the authoritative role source; global `admin` is the only membership bypass. Supported roles are `viewer`, `editor`, `reviewer`, `architect`, `admin`.

## Outbox / broker

`OutboxWorker` reads eligible unpublished events and publishes through a publisher adapter. `OutboxScheduler` prevents overlapping runs. Failed delivery updates retry metadata and eventually enters the DLQ-equivalent state after the configured retry limit. The HTTP broker adapter emits CloudEvents-style JSON and can attach an HMAC SHA-256 signature.

## Observability

- `GET /health/live`: process liveness, no OIDC required
- `GET /health/ready`: PostgreSQL readiness, no OIDC required
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

Database is configured by `DATABASE_URL` or standard `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`. Optional operations settings include:

```text
RATE_LIMIT_BACKEND=memory|postgres
RATE_LIMIT_PER_MINUTE=120
BROKER_URL
BROKER_SECRET
OUTBOX_INTERVAL_MS=5000
OTLP_ENDPOINT
OTLP_AUTHORIZATION
OTLP_INTERVAL_MS=15000
```

Start the production HTTP service with Node after installing `pg`:

```bash
node engineering-design-graph/server-entry.mjs
```

Container/Kubernetes templates are under `engineering-design-graph/Dockerfile` and `engineering-design-graph/ops/k8s.yaml`. Deployment secrets must replace placeholders outside source control.

## Backup / restore

See `engineering-design-graph/ops/BACKUP_RESTORE.md`. The dedicated GitHub Actions workflow performs a real custom-format `pg_dump`, restores it into a clean database, and compares project/version counts before proceeding to Playwright.

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

The dedicated workflow validates migrations, unit/API/AI/security/operations tests, Docker image build, deployment manifest sanity, real `pg.Pool` round-trip, distributed PostgreSQL rate limiting, backup/restore, and Playwright desktop/mobile UI plus authenticated HTTP E2E.

## Remaining deployment decisions

- choose and configure the managed broker product if HTTP delivery is insufficient
- production secret manager integration strategy
- image registry/release workflow and environment overlays
- production RPO/RTO/SLO and alert thresholds
