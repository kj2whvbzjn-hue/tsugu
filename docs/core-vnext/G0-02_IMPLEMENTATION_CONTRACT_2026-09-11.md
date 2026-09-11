# G0-02 Core vNext 実装契約

**実施日:** 2026-09-11  
**基準 commit:** `1f3a551361e691352e35dccfc5b40a5c34aa1d6a`

## 1. 実装境界

- TSUGUは単一の静的Webアプリとして維持する。
- 実行時バックエンドを新設しない。
- 永続化はGitHub API経由で行う。
- 案件正本はPrivate `kj2whvbzjn-hue/tsugu-data` / `main` の `data/projects/<projectId>.json` とする。
- 1回の論理保存は1 Git commitで確定する。
- 旧D1/R2/Worker/Next/MCP/legacy itemsを依存先・fallbackとして使用しない。

## 2. ID / scope

Core vNextの新規エンティティは安定IDを持つ。表示名やPathをIDとして使用しない。

最低限のscopeは次とする。

- repository scope: `owner/repo`
- project scope: `projectId`
- architecture scope: `projectId + architectureRevision`
- changeset scope: `projectId + changeSetId`

別ProjectのIDを入力で指定して越境参照できないことを各公開操作で検証する。

## 3. Actor / Permission

- Actorの本人確認はGitHub `/user` のレスポンスを唯一の実行時基準とする。
- 入力JSON、画面入力、AI返却値に含まれるactor名を本人確認に使わない。
- 操作記録には認証済みGitHub loginをActorとして固定する。
- 自己昇格を許可しない。
- 権限変更自体も監査対象とする。

Stage Aの初期権限は最小構成とし、少なくとも `read`, `edit`, `approve`, `admin` を分離可能なモデルにする。UI表示だけでなく書込み前に必ず権限検査する。

## 4. ChangeSet / 原子性

静的構成ではDB transactionを使えないため、原子性はGit aggregate単位で実現する。

- ChangeSetは `baseRevision`, `baseBlobSha`, `payloadHash`, `changeSetId` を固定する。
- Apply直前に最新blobを再取得し、`baseRevision` と `baseBlobSha` の両方を照合する。
- 不一致は `STALE_CHANGESET` として全拒否する。
- 同じ `changeSetId` の再実行は、同じ `payloadHash` のときだけ冪等成功として扱う。
- 同じ `changeSetId` でpayloadが異なる場合は拒否する。
- 案件JSON、Audit、Outbox相当のイベント記録は同一JSON aggregate内で同時に更新し、1 Git commitで確定する。
- 部分成功という状態を作らない。

## 5. Audit

Audit entryは案件aggregate内のappend-only領域として保持する。

最低限記録する項目:

- `auditId`
- `occurredAt`
- `actor.login`
- `action`
- `targetType`
- `targetId`
- `changeSetId`
- `beforeHash`
- `afterHash`
- `repository`
- `commitSha` または commit確定前のpending識別子

既存Audit entryの編集・削除を通常操作から許可しない。

## 6. Repository / Baseline / Deployment

Repository参照は `owner/repo + commit SHA` で固定する。同一SHA文字列でも別Repositoryなら別物として扱う。

最低モデル:

- `RepositoryCommitRef`: repository, sha
- `RepositoryBaseline`: baselineId, repositoryCommitRef, treeSha, capturedAt
- `Deployment`: deploymentId, repositoryCommitRef, artifactIdentity, workflowRunId, deployedAt, url

GitHub Pagesでは成功した `Deploy TSUGU` workflow runと対象commitをDeployment証拠として扱う。同commitの再Deployは別deploymentIdとする。

## 7. Evidence

Stage BのEvidence原本は、案件JSONへ大きな本文を埋め込まず、Private data repository内のimmutable pathへ保存する方式を採る。

推奨パス:

`data/evidence/<projectId>/<evidenceId>/<versionId>/<filename>`

EvidenceVersion確定時に最低限 `sha256`, `size`, `gitBlobSha`, `path`, `commitSha` をreadback検証して固定する。未確定版をPASS根拠に使用しない。

## 8. 復旧

- ソース復旧: Git履歴
- 公開復旧: 既知の正常commitをmainへ修正commitとして再適用しDeploy
- 案件復旧: `tsugu-data` のGit履歴から対象案件ファイルを復元
- 外部Git事実を巻き戻すのではなく、TSUGU側の記録を再照合する

旧ランタイムを復旧手段として保持しない。

## 9. A-01着手条件

A-01では次を実装する。

1. Core境界を独立モジュールとして導入
2. Actor解決をGitHub認証結果へ固定
3. Permission検査を公開書込み操作へ接続
4. Audit append-only記録を導入
5. actor偽装・自己昇格・Project越境を拒否するテストを追加

現行Deploy/E2Eを壊さず、旧runtime依存を追加しないことを合格条件とする。
