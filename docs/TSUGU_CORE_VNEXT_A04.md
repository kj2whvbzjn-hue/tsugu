# TSUGU Core vNext A-04 — ChangeSet Core / Atomic Apply

## 目的

A-03で確立した `ProjectArchitecture` を直接GitHubへ書かず、すべての構造変更を `ArchitectureChangeSet` として固定・検証し、1 Project = 1 aggregate JSONのGitHub Contents API更新へ接続する。

現行環境ではDB transactionを仮定しない。1 aggregateファイルのGit blob SHAをCASとして使い、Entity変更・AppliedChangeSet・AuditEvent・OutboxRecordを同じJSONの同じGit commitで確定する。

## 契約

### ArchitectureChangeSet

- `id`
- `projectId`
- `idempotencyKey`
- `baseRevision`
- `baseBlobSha` — 40桁Git blob SHA
- `createdBy`
- `operations[]`
- `preconditions[]`
- `payloadHash` — canonical JSONのSHA-256

Stage A operation:

- `ADD_NODE`
- `RENAME_NODE`
- `MOVE_NODE`
- `ADD_PATH`
- `RENAME_PATH`
- `MOVE_PATH`
- `ADD_BINDING`
- `DEACTIVATE_BINDING`

Stage A precondition:

- `ENTITY_REVISION`
- `REPOSITORY_SCOPE`

### ValidationRecord

commit未存在の設計候補はCheckへ偽装せず、`ValidationRecord` に保存する。

ValidationRecordは次を固定する。

- ChangeSet ID / payloadHash
- base revision / base blob SHA
- candidate hash
- target IDs
- result revision
- PASS / issues

Apply時にはValidationRecordを信用して素通しせず、現在aggregateに対してoperationとpreconditionを再実行し、candidate hash / result revisionまで再照合する。

### ArchitectureAggregate

GitHubへ1回で保存する確定単位。

- `architecture`
- `revision`
- `appliedChangeSets[]`
- `auditEvents[]`
- `outbox[]`

これらは同一JSONへ構成してから1回のContents API PUTで確定するため、競合時にEntityだけ、Auditだけ、Outboxだけが残る状態を作らない。

## 競合

Apply直前に以下を再確認する。

1. project ID
2. base architecture revision
3. base Git blob SHA
4. explicit preconditions
5. Architecture全体validation
6. ValidationRecordのpayload/candidate/result revision

現在値が変わっていた場合は `STALE_CHANGESET` とし、候補の一部を保存しない。

Contents API PUT自体が409/422でCAS競合した場合も `STALE_CHANGESET` に正規化し、自動再適用はしない。最新状態で再validationが必要。

## Idempotency

aggregate内の `appliedChangeSets` を確定台帳とする。

- 同一 `idempotencyKey` + 同一 `payloadHash`: 既存結果を `IDEMPOTENT_REPLAY` として返し、再commitしない。
- 同一 `idempotencyKey` + 異なる `payloadHash`: `IDEMPOTENCY_KEY_REUSED` で拒否する。

payloadHashにはbase revision/blob SHAも含まれるため、同じキーを別のbaseへ流用できない。

## 公開書込み境界

A-03の `core-architecture.js` のmutationは候補stateを作るpure domain operationとして維持する。公開永続化でそのstateを直接保存する経路は開かない。

A-04で有効化する公開構造書込み境界は `TSUGUCoreChangeSet.applyWithContentApi()` のみ。これがGitHub read → revalidation → CAS PUT → readbackを行う。

既存 `static/app.js` のlegacy案件保存経路はA-04では構造変更に流用しない。Private案件データのmigrationも行わない。

## Outbox

A-04では `ARCHITECTURE_CHANGED` を `PENDING` OutboxRecordとしてaggregate内へ原子的に予約する。外部同期処理・重複処理・再実行はA-05で実装する。

## 検証

単体:

- SHA-256既知ベクトル
- payload tamper拒否
- stale revision/blob拒否
- entity/repository precondition
- Architecture validation継承
- ValidationRecord再照合
- atomic aggregate構成
- idempotent replay / key reuse拒否
- Contents API read/write/readback
- CAS conflictで部分変更なし

公開E2E:

1. Pages上の `core-changeset.js` がcheckoutとbyte一致
2. temp branchに初期aggregateを作成
3. 同じbaseから2 ChangeSetをvalidation
4. 1本目をContents APIでApply
5. 2本目が `STALE_CHANGESET`
6. readbackでNode/Applied/Audit/Outboxが1件だけ
7. 1本目の再送が `IDEMPOTENT_REPLAY` で新commitを作らない
8. 同じidempotency keyの異payloadを拒否
9. temp branchを削除

E2Eのtemp branchはGitHub CAS挙動を実測するテストハーネスであり、業務データの正本をpublic code repositoryへ移す設計変更ではない。
