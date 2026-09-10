# A-01 実装準備 — Core境界 / Auth / Permission / Audit / Bootstrap

- 日付: 2026-09-10
- 対象: TSUGU Core vNext v2.3 Stage A / A-01
- 前提: `G0-02-contract-review-2026-09-10.md`
- 状態: **実装準備完了。アプリ実装はまだ開始していない。**

## 目的

legacy `Project/items/core` のJSON正本を延長せず、vNextの認証・認可・監査・bootstrapを独立境界として開始する。旧26/27案件の復元・移行は前提にしない。

## 初回対象path

| path | 役割 |
|---|---|
| `app/vnext/domain/identity.ts` | Actor/Role/Permission/ProjectMembership/Policyの型・安定ID契約。UI/legacy model非依存 |
| `app/vnext/server/auth-context.ts` | Sites authenticated headersからtrusted principalを生成。body identity禁止 |
| `app/vnext/server/authorization.ts` | Project-scoped permission、cross-project拒否、self-elevation拒否 |
| `app/vnext/server/bootstrap.ts` | server-only `BootstrapConfig` に基づくidempotent初期admin登録 |
| `app/vnext/server/audit.ts` | protected operation用append-only AuditEvent/AuditLog生成 |
| `db/vnext/schema.ts` | A-01 first-class persistence schema。legacy `db/schema.ts` と分離 |
| `db/vnext/store.ts` | vNext D1 store/transaction interface。legacy storeをDomainから直接参照させない |
| `drizzle/0006_vnext_identity_audit_bootstrap.sql` | additive A-01 migration。既存tableをDROP/rename/rewriteしない |
| `tests/vnext-a01-boundary.test.mjs` | legacy import禁止・境界検査 |
| `tests/vnext-a01-authz.test.mjs` | trusted principal / project scope / forgery / self-elevation検査 |
| `tests/vnext-a01-bootstrap-audit.test.mjs` | bootstrap idempotency・unauthorized seed拒否・Audit検査 |

実装時にDrizzle Kitの生成規則上migration名を変更する必要がある場合は、`0006`相当の**additive migration**であることをChangeSetに記録し、勝手に既存migrationを編集しない。

## DB対象

A-01では少なくとも次のvNext tableを独立prefix/namespaceで定義する。

- `vnext_actors`
- `vnext_roles`
- `vnext_project_memberships`
- `vnext_policies`
- `vnext_audit_logs`
- `vnext_bootstrap_receipts`

`project_id` はA-03でProject本体を導入するまでopaque stable IDとして扱い、A-01からlegacy `projects` tableへのFKを作らない。Stage順序を逆転させない。

## 入力

### Auth context

- `oai-authenticated-user-id`
- `oai-authenticated-user-email`（表示/互換補助。vNext admin権限の自己申告根拠にはしない）

request bodyの `actor_id` / Role / HUMANフラグはauthority入力にしない。

### Authorization

- trusted Actor/principal
- `project_id`
- action / required permission
- candidate membership/role operation
- Policy version/precondition

### Bootstrap

- server-only `BootstrapConfig`
- authenticated stable subject
- bootstrap generation/version

## 出力

- `AuthPrincipal` / canonical Actor
- allow/deny authorization result
- typed denial reason
- idempotent bootstrap result
- append-only AuditEvent/AuditLog

最低限のerror code候補:

- `UNAUTHENTICATED`
- `FORBIDDEN`
- `CROSS_PROJECT`
- `ACTOR_FORGERY`
- `SELF_ELEVATION`
- `BOOTSTRAP_NOT_AUTHORIZED`
- `STALE_POLICY`

## bootstrap技術契約

推奨方式:

1. stable authenticated subject IDをcanonical bootstrap keyとする。
2. allowlist/configはclient/request bodyから変更不能なserver-side sourceから注入する。
3. DBが空でも「最初にアクセスしたユーザー」を自動adminにしない。
4. 同じprincipal/configで複数回実行してもActor/Role/Membershipを重複作成しない。
5. bootstrap実行結果をreceipt + Auditで記録する。
6. config外principalはDBが空でも拒否する。

本番principal値とSitesで利用可能な保護config carrierは未確定。A-01コードはinterface注入で進め、本番bootstrap実行はその値が確定するまで行わない。

## Acceptance tests

### Boundary

- `app/vnext/domain/**` が `app/model.ts`, legacy `db/schema.ts`, legacy UIを直接importしていない。
- vNext DomainはCloudflare/Sites header parsingを含まない。
- legacy compatibilityが必要なら明示adapterに限定される。

### Authentication / authorization

- 未認証requestはfail closed。
- request body actor/Roleを変えてもauthorityは変わらない。
-別Actor/別Projectのresourceは拒否。
- owner/emailが一致して見えることだけをRole根拠にしない。
- Role自己昇格を拒否。
- Policy/revision precondition不一致を拒否。

### Bootstrap

- empty DB + unauthorized principal -> admin生成なし。
- empty DB + configured principal -> exactly one bootstrap admin membership。
- 同一bootstrap再実行 -> duplicateなし、結果はidempotent。
- config変更/世代不一致を暗黙昇格に使わない。

### Audit

- protected write/deny/bootstrapについてActor、project/action、policy/revision、result、timestampをserver側で記録。
- 過去Audit rowを更新して成功へ書き換えない。

### DB/migration

- `0006`はadditiveのみ。
- legacy table/dataを書き換えない。
- unit/integration fixtureはin-memory SQLite等の隔離環境で実施しproduction D1/R2/APIを呼ばない。

### Repository verification

実装commitごとに最低限:

```text
npm ci
node --test tests/vnext-a01-boundary.test.mjs tests/vnext-a01-authz.test.mjs tests/vnext-a01-bootstrap-audit.test.mjs
npm test
npx tsc --noEmit --incremental false
```

対象SHAとactual checkout SHAを記録する。

## 開始条件

A-01 source implementationを開始できる条件:

1. `G0-02-contract-review-2026-09-10.md` がbranchに記録済み。
2. Core/legacy境界、Actor authority、bootstrap fail-closed、Audit append-onlyの技術契約が維持される。
3. 旧26/27案件の復元・owner mappingを待たない。
4. production D1/R2/hosting/binding/writerを変更しない。

A-01の**live bootstrap完了**には追加で以下が必要:

- 本番admin principalの人間Decision
- server-only bootstrap config carrierの確認
- 認証済みlive requestでprincipal derivationを確認
- 正式D1でidempotency/transactionを検証

## A-01完了後にA-02へ渡すもの

- canonical Actor identity契約
- Project-scoped authorization interface
- AuditLog interface/schema
- bootstrap result/receipt contract
- stable `project_id` / revision precondition interface

Environment/Deployment/physical D1/R2 resource identityはA-02の対象とし、A-01で推測値を埋めない。

## 明示的な非対象

- legacy案件の復元/移行
- existing owner rowの書換え
- production migration実行
- hosting/rebind/redeploy
- writer切替
- Stage BのEvidence/Check本実装
- TSUGU本体への登録（実施できた場合のみ別途記録）