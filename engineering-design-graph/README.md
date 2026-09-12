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
- Idempotency-Key for ChangeSet apply / AI request / export
- PostgreSQL migrations / Project aggregate repository
- transactional ChangeSet Application Service
- Audit Log / Outbox / publisher worker boundary
- Project membership / project policy persistence
- Playwright UI E2E + authenticated HTTP E2E
- GitHub Actions + PostgreSQL 16 integration checks

## Transaction boundary

Production-oriented ChangeSet apply uses `EngineeringDesignApplicationService` and a connection-scoped PostgreSQL Unit of Work. The same checked-out database connection performs:

1. ChangeSet → Project resolution
2. Project aggregate load
3. deterministic ChangeSet apply / validation
4. Artifact + immutable ArtifactVersion persistence
5. current-version pointer / Relation / ChangeSet persistence
6. Audit Log insert
7. Outbox Event insert
8. commit

Any failure before commit rolls back the database transaction. `PostgresEngineeringDesignUnitOfWork` checks out one dedicated client from a pool so `BEGIN`, all SQL statements, and `COMMIT/ROLLBACK` cannot be split across pool connections.

## Outbox

`OutboxWorker` reads unpublished events, publishes them through a publisher adapter, and only after success marks them published. Failed publications remain pending for retry.

## Project access

`db/002_project_access.sql` adds project-scoped membership roles and JSON project policies. OIDC identity remains the authentication source; project membership supplies project-specific authorization.

## 起動

静的UIはHTTPサーバーから `engineering-design-graph/index.html` を開けます。

```bash
python3 -m http.server 8080
# http://localhost:8080/engineering-design-graph/
```

## テスト

```bash
npm run test:engineering-design
npm run test:engineering-design:e2e
```

専用GitHub Actions workflowは `engineering-design-graph/db/*.sql` をPostgreSQL 16へ順番に適用し、unit/API/AI/security/persistenceテストの後、Playwright desktop/mobile UI E2Eとauthenticated HTTP E2Eを実行します。HTTP E2EではChangeSetを実HTTPでStageし、transactional Application Service経由でApplyして保存済みrevision・Audit・Outboxまで確認します。
