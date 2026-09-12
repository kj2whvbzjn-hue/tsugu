# Engineering Design Graph Backup / Restore Runbook

## Scope
Back up PostgreSQL as the system of record. The backup must include project aggregates, immutable ArtifactVersion rows, project membership/policy, audit logs, readiness snapshots and outbox state.

## Backup
1. Put the application in maintenance/read-only mode if a transactionally consistent business cut is required.
2. Record application commit SHA, migration file set and PostgreSQL major version.
3. Run a custom-format backup: `pg_dump --format=custom --no-owner --no-acl --file=edg.dump "$DATABASE_URL"`.
4. Generate SHA-256 for the dump and store the checksum separately.
5. Store the dump in encrypted object storage with retention/versioning enabled.
6. Do not store `DATABASE_URL`, OIDC tokens, broker secrets or other credentials in backup metadata.

## Restore drill
1. Provision a clean PostgreSQL 16 database.
2. Apply no application traffic.
3. Restore with `pg_restore --clean --if-exists --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" edg.dump`.
4. Verify schema/migration expectations and run `select count(*)` checks for `projects`, `artifacts`, `artifact_versions`, `audit_logs`, `outbox_events`, `project_members`.
5. Start the application against the restored database and require `/health/ready` = 200.
6. Run the Engineering Design Graph API/Playwright smoke suite before opening traffic.

## Outbox safety after restore
A restore can reintroduce unpublished events. Consumers must be idempotent by event `id`. Published rows keep `published_at`; only rows with `published_at is null` and `dead_lettered_at is null` are eligible for retry.

## Acceptance target
Perform a restore drill periodically and record RPO/RTO, backup timestamp, restore duration, checksum verification and smoke-test result. Production RPO/RTO values are deployment decisions and are not defined by the current design package.
