# TSUGU Core vNext A-05 — GitHub Sync / Reconciliation

## 目的

Stage AのGitHub同期を、現行のブラウザ + GitHub API + Git保存方式に合わせて完成させる。

v2.3のWebhook前提をそのまま持ち込まず、明示refreshでGitHubのRepository/branch headを再取得し、commit参照を永続受信してから処理する。将来Webhookを追加しても、この永続受信・重複排除・lease/retry契約を入口として使う。

A-05ではActualChangeを合格条件にしない。Stage Aの同期対象は `RepositoryCommitRef / IntegrationRecord / SyncJob` までとする。

## 1. IntegrationRecord

GitHub commitの業務重複キーは `repositoryId + full 40-char commit SHA`。

- 同一Repository + 同一SHAは1件だけ。
- 同じSHAでも別Repositoryなら別IntegrationRecord。
- branch名は観測コンテキストであり主キーではない。
- 受信時に同じcommit用のSyncJobを1件だけ作る。

`IntegrationRecord.status`:

- `RECEIVED`
- `PROCESSED`
- `ERROR`

## 2. SyncJob

`SyncJob.status`:

- `PENDING`
- `LEASED`
- `SUCCEEDED`
- `DEAD`

処理開始時にworker ID、lease期限、attempt番号を永続化する。

- lease期限内は別workerが同一jobをclaimできない。
- lease期限切れは別workerが回収できる。
- failureは `nextAttemptAt` を持つPENDINGへ戻す。
- maxAttempts到達時はDEADとし、IntegrationRecordをERRORにする。
- COMPLETE/FAILは現在lease ownerだけが実行できる。

## 3. 永続境界

同期台帳は `GitHubSyncAggregate` として1 JSONへ保存する。

- integrations[]
- jobs[]
- lastRefresh
- revision

refreshの受信保存、claim、complete、failはいずれもGitHub Contents APIのblob SHA CASで確定する。409/422は `STALE_SYNC_LEDGER` とし、最新台帳を再読込して明示再実行する。

処理本体の外部副作用より先にIntegrationRecord/SyncJobを永続化するため、途中停止後もjobが消えない。

## 4. Repository分離

監視対象Repositoryと同期台帳Repositoryは同一と仮定しない。

`TSUGUCoreSyncReconcile.refreshAndPersist()` は:

1. observed Repositoryのmetadataとbranch headを取得
2. `RepositoryCommitRef` を作る
3. ledger Repositoryのsync aggregateを取得
4. 重複排除してIntegrationRecord/SyncJobを追加
5. ledger blob SHAでCAS保存
6. readback検証

現行運用ではcode Repositoryを観測し、Private data Repository側へ台帳を保存できる。別Repository間の同時確定は仮定しない。

## 5. 管理表示

Pages artifactへ `core-sync-admin.js` を含め、管理用の `Core同期状態` detailsを表示する。

表示用summary:

- received
- processed
- pending
- leased
- retryReady
- dead
- latest commit SHA

同期利用側は `TSUGUCoreSyncAdmin.update(summary)` または `tsugu:core-sync-status` eventで現在状態を表示できる。異常時はERROR表示にできる。

## 6. Outboxとの関係

A-04の `ARCHITECTURE_CHANGED` PENDING OutboxはA-05の同期処理が将来処理対象として引き継ぐが、A-05でActualChangeを生成しない。A-05は受信・再実行・reconciliationの基盤を確定する。

## 7. 検証

単体:

- same repository+SHA dedupe
- cross-repository same SHA separation
- lease exclusivity
- expired lease recovery
- retry timing
- max-attempt DEAD
- lease owner/expiry validation
- admin summary
- duplicate/orphan persisted state rejection

公開E2E:

1. Pagesのsync modulesがcheckoutとbyte一致
2. observed/ledgerを別temp branchとして作成
3. observed headを初回refreshしIntegrationRecord+SyncJobを永続化
4. 同じheadを再refreshしrecords/jobsが増えない
5. ledger上でworker AがleaseをCAS保存
6. lease期限切れ後worker Bが回収
7. failureをretry待ちとして永続化
8. retry時刻後worker CがclaimしてSUCCEEDED
9. observed branchを1 commit進め、新しいheadが別IntegrationRecord/SyncJobになる
10. summaryでprocessed/pending/latest SHAを確認
11. temp branchesを削除

このE2Eはpublic code repository内の隔離temp branchをテストハーネスとして使うだけであり、業務データ保存先をpublicへ変更しない。
