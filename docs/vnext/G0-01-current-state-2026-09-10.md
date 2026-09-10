# TSUGU Core vNext G0-01 現状調査

- 調査日: 2026-09-10
- 計画: TSUGU Core vNext 修正版計画 v2.3 / 実施作業一覧 v2.3
- Task: G0-01 現状調査
- Repository: `kj2whvbzjn-hue/tsugu`
- Base branch: `main`
- 開始 SHA: `ad3534750e03345b38a01416e012b9f4dde06701`
- 作業 branch: `vnext-g0-20260910`
- 状態: **進行中**（GitHub 側調査済み、認証後の実機・実 D1/R2・Deployment commit は未確認）

## 1. 実測した基準

### GitHub

`main` HEAD は `ad3534750e03345b38a01416e012b9f4dde06701`、commit message は `Import TSUGU source v22 de808756`。今回の実装開始 SHA として固定する。

Repository は private、default branch は `main`。

### Hosting / runtime

`.openai/hosting.json` は次の binding を宣言する。

- D1: `DB`
- R2: `BUCKET`
- OpenAI hosting project id: `appgprj_6a9d191e8fd48191ac8b14311ccfa935`

既存 Sites URL `https://continuity-workbench.pzs4d5yv7g.chatgpt.site/` は到達可能で、未認証状態では「継ぐにサインイン」を表示する。公開面からは実際に配置されている commit SHA、D1 schema 版、R2 bucket 実体までは判定できない。

`package.json` 上の主要構成:

- Node `>=22.13.0`
- Next `16.2.6`
- React `19.2.6`
- vinext `0.0.50`
- Vite `8.0.13`
- Wrangler `4.92.0`
- Drizzle ORM `0.45.2`

Build は `scripts/build-verified.sh` から bounded `vinext build` を実行する。`npm test` は build 成功後に `tests/*.test.mjs` を Node test runner で実行する。

## 2. 現行 API / persistence 境界

主要 API route は以下を確認した。

- `app/api/projects/route.ts`
- `app/api/projects/export/route.ts`
- `app/api/projects/task-context/route.ts`
- `app/api/proposals/route.ts`
- `app/api/evidence/route.ts`
- `app/mcp/route.ts`

Project 保存は D1 `projects.body` に Project 全体を JSON で保存し、revision を条件に更新する。変更時は D1 batch で project 更新、revision 記録、proposal 状態等をまとめ、revision 競合時は 409 を返す。

この既存 revision guard は vNext の ChangeSet 競合設計に再利用できるが、現時点で汎用 `ChangeSet`、`AuditLog`、`Outbox` の first-class persistence は確認できない。

## 3. 現行 DB schema / migration

`db/schema.ts` で確認した D1 table:

1. `projects`
2. `revisions`
3. `original_files`
4. `deletion_jobs`
5. `proposals`
6. `evidences`
7. `evidence_versions`
8. `evidence_uploads`

Migration は `drizzle/0000_*.sql` から `0005_evidence_core.sql` まで存在する。

重要: 現行 typed Core entity の大半は D1 の個別 table ではなく `projects.body` 内 JSON に保持されている。したがって、計画 v2.3 が要求する first-class entity / project scope / revision / FK 境界は、現状の型定義が存在することと分けて評価する。

## 4. legacy `items` と typed Core の併存

`app/model.ts` の `Project` は次を同時に保持する。

- legacy `items[]`
- typed `core`

legacy `items` は `構成 / 作業 / 議論 / 決定 / 検証` を汎用 Item として保持し、Task 条件も Item 配下に持つ。一方 `core-model.ts` には以下の typed entity が既に定義されている。

- ArchitectureNode
- WorkBox
- Task
- Decision
- Issue
- Check
- Approval
- Evidence / EvidenceVersion
- Repository / RepositoryBaseline
- PathEntry
- PlannedChange / ActualChange
- TypedRelation

よって「新 Core をゼロから作る」のではなく、**既存 typed Core の有効部分を保全し、legacy `items` へ新機能を追加せず、DB/API 境界を vNext 契約へ段階的に移す**のが妥当。

## 5. 既存成果として保全する機能

### Evidence

`app/evidence-service.ts` では以下を確認した。

- Evidence / EvidenceVersion
- version 別 R2 object key
- SHA-256 計算
- R2 put 後の readback
- byte size と SHA-256 の再検証
- `operationId` による retry / idempotency
- R2 保存後 DB metadata 確定失敗の retry
- 旧版 retry で `current_version_id` を後退させない条件付き更新
- read 時の SHA/size 再検証

これは計画 F07 / B-04 の重要な先行成果。置換ではなく、vNext の Check / RequirementSnapshot / target 契約へ接続することを優先する。

### Repository / PathEntry

`app/repository-service.ts` では以下を確認した。

- Repository / RepositoryBaseline
- stable PathEntry ID
- path normalization
- self / descendant move 拒否
- file parent 拒否
- same Repository/Baseline 制約
- path 重複拒否
- directory move 時の descendant path 更新
- PlannedChange / ActualChange
- EvidenceVersion -> PathEntry relation

これは A-02/A-03/B-05 の一部に相当する先行成果。ただし永続化は Project JSON 内であり、vNext の project-scoped first-class persistence と Git 同期記録は別途必要。

### Revision / change control

`app/api/projects/route.ts` は base revision の比較、条件付き UPDATE、D1 batch による revision log を持つ。`app/change-control.ts` は source update task に baseline commit、site version、project revision、planned/actual files、verification、rollback plan を要求する。

競合防止と変更記録の思想は再利用するが、vNext A-04 の ChangeSet hash、idempotency key、precondition、Audit、Outbox、STALE_CHANGESET の契約は未実装と扱う。

### Approval

`app/approvals.ts` は server-authored revision stamp を使い、各保存 revision ごとに implementation/completion approval を再要求する。client-supplied stamp を権限として使わない。

ただし vNext が要求する approval kind + target ID/version + content hash + Policy version + expiry + revoke history までは確認できない。

## 6. 認証・権限の現状

認証主体は OpenAI Sites dispatch が供給する header から取得している。

- `oai-authenticated-user-id`
- `oai-authenticated-user-email`

`identityFromHeaders` は request body の actor を信用せず、email の SHA-256 owner key または user id を使用する。この方針は vNext の「Actor は認証済み主体から server が決定」に適合する。

一方、現行 DB に Actor / Role / ProjectMembership / Policy table は確認できない。Project 所有者境界は owner key で行っており、操作別 role、自己昇格拒否、初期管理者 bootstrap は A-01 の主要未実装候補。

## 7. Task / dependency / lifecycle の現状

legacy Task 依存は `app/task-dependencies.ts` で循環と未完了依存を検証し、未完了依存を同一編集で外して実行状態へ移すことも拒否する。

Core Task も `dependsOnTaskIds` と acceptance criteria を持つが、vNext B-06 が要求する EventDefinition / EventOccurrence、RequirementSnapshot、評価世代、複数 Hold 理由、START/RESUME/DONE の保証再評価までは現行コードで確認できない。

## 8. Test / build の現状

Repository tree 上で確認した test:

- `backup.test.mjs`
- `change-control.test.mjs`
- `change-scope.test.mjs`
- `core-model.test.mjs`
- `evidence-schema.test.mjs`
- `evidence-service.test.mjs`
- `handoff.test.mjs`
- `proposals.test.mjs`
- `rendered-html.test.mjs`
- `repository-service.test.mjs`
- `revision-approval.test.mjs`
- `status-model.test.mjs`
- `task-dependencies.test.mjs`
- `task-pack.test.mjs`
- `ui-components.test.mjs`

この調査では test の存在と実行 entrypoint を確認したが、開始 SHA に対して CI / local 実行し PASS したことまではまだ確認していない。

## 9. 計画 v2.3 との初期対応

### 既存成果を優先保全

- F07 / B-04 Evidence readback, SHA/size, retry
- A-03 の一部: Repository/PathEntry stable ID と移動制約
- A-04 の前提の一部: project revision guard と D1 batch
- B-03 の前提の一部: server-authored approval revision stamp
- Task dependency cycle / unfinished dependency guard

### 未達または要再設計

- A-01: Actor / Role / membership / permission / audit / bootstrap
- A-02: RepositoryCommitRef、Environment、Deployment、artifact/config/schema version 固定
- A-03: ArchitectureBinding の first-class persistence
- A-04: ChangeSet / candidate hash / idempotency / AuditLog / Outbox
- A-05: GitHub sync receipt / SyncJob / delivery id / retry / reconciliation
- B-01 以降: Box registry, RequirementSnapshot, Waiver, Event, Assurance, generation invalidation 等
- typed Core の D1 first-class 化と project/revision scope 契約

## 10. 未確認事項

以下は G0-01 完了前に実測が必要。

- 実際の Sites Deployment が指す commit / artifact
- 実 Deployment の Environment identifier
- 実 D1 に適用済みの migration / schema
- 実 R2 bucket と Evidence readback の実機確認
- sign-in 後の主要 UI / API の実動作
- 現行 DB のデータ量・既存案件・互換 owner key の実態
- 現行 test/build の開始 SHA での実行結果
- rollback / restore 手段と権限の実在
- GitHub sync / webhook が現環境に存在するか

## 11. G0-02 で固定する契約候補

G0-01 の未確認を埋めた後、少なくとも以下を決定記録へ固定する。

- Domain / API / D1 table 境界
- legacy `items` の互換範囲と新規書込み禁止境界
- Entity ID / `project_id` / revision の共通契約
- Actor / Role / initial admin bootstrap
- RepositoryCommitRef / Deployment target
- ChangeSet 原子性と R2/GitHub 外部処理の Outbox 境界
- RequirementSnapshot / Check target / Assurance scope
- Task start と completion 条件の分離
- migration / rollback / restore の可否

## 12. 4区分状態

### 完了済み

- 計画 v2.3 / WBS の G0-01 条件を読み取り
- `main` HEAD と開始 SHA を実測して固定
- Repository tree、主要 API、DB schema、migration、Core/legacy 境界、認証、Evidence、Repository/Path、Approval、Task dependency、test/build 構成をコードで確認
- 既存成果と vNext 未達を初期分類
- G0 用作業 branch 作成

### 現在地点

G0-01 の GitHub 側静的調査は完了。実 Deployment / D1 / R2 / sign-in 後 UI / 実 test 結果の確認待ち。

### 未完了

- 認証済み実機と実データストアの確認
- build/test 実行証拠
- Deployment commit / artifact / schema version の固定
- 上記結果の TSUGU Task / Evidence / Check への反映

### 次の作業

1. 認証済み実機で Deployment、D1、R2、主要 UI/API を確認する。
2. 開始 SHA で build / test を実行し、終了コードと失敗箇所を記録する。
3. G0-02 契約を確定し、人間判断が必要な項目を Decision として分離する。
4. G0-02 合格後に A-01 の最小実装単位へ進む。

## 13. 安全制約

G0 中はデータ削除、旧コード削除、hosting 方式変更、writer 切替を行わない。既存 Evidence / stable ID / FAIL 履歴 / owner compatibility を破壊しない。
