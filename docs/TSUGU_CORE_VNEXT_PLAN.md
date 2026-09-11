# TSUGU Core vNext 改修計画

**基礎資料:** `TSUGU_Core_vNext_修正版計画_v2.3`  
**現行環境補正版:** 2026-09-11  
**対応基準:** `docs/TSUGU_PROJECT_REFERENCE.md`

この計画は v2.3 のCore再構築方針、Stage A/B/C/D、安定ID、Check/Assurance、Approval、ChangeSet、Event/Task依存、FAIL履歴保持の設計意図を継承する。一方、v2.3が前提としていた ChatGPT Sites / Cloudflare D1 / R2 / サーバー受信API は現在のTSUGUには存在しないため、その実装前提は破棄する。

## 1. 現行環境

- 正本コード: `kj2whvbzjn-hue/tsugu` / `main`
- 公開: GitHub Pages
- 業務データ: Private `kj2whvbzjn-hue/tsugu-data` / `main`
- クライアント: ブラウザ実行
- 永続化: GitHub Contents API / Git commit history
- 競合制御: project revision + blob SHA
- 認証: 利用者入力のFine-grained PAT、GitHub `/user` で主体確認
- CI/CD: GitHub Actions
- 実機検証: GitHub Pages + Playwright E2E

D1 transaction、R2 object、Cloudflare Worker、ChatGPT Sites dispatch、MCP受信を前提に設計しない。

## 2. 変更しないCore方針

- legacy業務モデルを新Coreへコピーしない
- `items` へ新Core機能を継ぎ足さない
- first-class typed entitiesを優先する
- 安定IDを使い、表示名やpathを主キーにしない
- 変更前後のrevision/対象/hashを固定する
- Approvalは対象版と内容hashに固定する
- FAILを削除してPASSへ置換しない
- 開始条件と完了条件を分離する
- commit / Deployment / RequirementSnapshotの対象一致を検査する
- 不明状態はfail closedにする
- 旧コードへのフォールバックは作らない

## 3. GitHub保存方式に合わせた契約修正

### 3.1 原子的変更

現行の案件JSONは1ファイルを1回のContents API更新で確定し、Git blob SHAをcompare-and-swapとして使う。Core vNextで複数Entityを導入するときは、部分更新を避けるため次のどちらかを採用する。

- 1 Project = 1 aggregate JSONとして1 commitで確定する
- Git tree/commit APIで複数ファイルを1 commitへ束ね、branch ref更新を最終確定点にする

別Repository間の同時確定は仮定しない。途中失敗は未完了として再試行・再照合する。

### 3.2 Evidence

R2は使用しない。Evidenceを実装する場合はPrivate data repository内のimmutable pathへ版別保存し、内容SHA-256・size・Git blob SHA・対象revisionを記録する。保存後にreadbackして内容を検証したEvidenceVersionだけをCheckから参照可能にする。

### 3.3 Deployment

DeploymentはGitHub Pagesの実測結果として扱い、対象source commit、Actions run/deployment、公開URL、取得時刻を固定する。同一commitの再デプロイは別の実測記録として残す。

### 3.4 GitHub同期

現行TSUGUはGitHubへ直接読み書きするため、サーバーWebhook受信を必須にしない。更新はGitHub API再取得と明示的refreshで照合する。将来イベント駆動を追加する場合も、別サーバー実装をフォールバックとして追加せず、現行アーキテクチャへ明示的に統合する。

## 4. Stage A — Core基盤

- Actor / Permission / Auditの型を確立
- RepositoryCommitRef / RepositoryBaseline / DeploymentをGitHub事実に結び付ける
- Project / ArchitectureNode / PathEntry / Bindingの安定IDを実装
- ChangeSetのbase revision、候補hash、precondition、validationを実装
- Applyを単一Git commitの確定単位へ接続
- 競合時に部分変更を残さず `STALE_CHANGESET` とする
- GitHub再取得によるreconciliationを実装

Stage A完了まで、旧server modelやlegacy `items` を新Coreの裏側として呼び出さない。

## 5. Stage B — 実運用MVP

- BoxDefinition / BoxInstance / SchemaDefinition / ChildConstraint
- RuleDefinition / TestDefinition / RequirementSnapshot
- Task / Approval / Waiver / Decision / Issue
- Check / Evidence / EvidenceVersion
- PlannedChange / ActualChange
- Assurance最小 / Event / TaskDependency / 失効連鎖

開始条件と完了条件を分け、対象commit・要求snapshot・評価世代が一致したPASSだけを採用する。完了に必要なCheckを同じTaskの開始条件に入れない。

## 6. Stage C — 影響範囲

Impact Graph、差分再計算、Architecture Health、同期回復と負荷検証を実装する。判定不能はFull testへ戻す。古い計算世代で現在状態を上書きしない。

## 7. Stage D — 設計支援

ArchitectureBaseline、Full Dry Run、高度version migration、Decision実行モデル、Blueprintを追加する。Published定義を後から書き換えず、過去参照を固定する。

## 8. 切替・旧コード

現行TSUGUへの統一は完了しているため、v2.3の「旧ランタイムを並行維持して後日切替」という前提は使わない。旧サーバーコードはmainから撤去し、実行可能なfallbackを残さない。

復旧は旧ランタイム起動ではなく、Git履歴から現行TSUGUの既知の正常commitへ原因を確認したうえで修正commitを作る。Private案件データは別Repositoryで保持し、コード撤去とデータ削除を同一扱いにしない。

## 9. 検証

各実装Taskで最低限記録する。

- 開始commit / 成果commit
- 変更対象
- 実行した検査と終了結果
- Actions run / Deployment
- E2E結果
- 対象RequirementSnapshot / Check / Evidence（実装後）
- 未解決Issue / FAIL

コードがmainに存在するだけでは完了にしない。公開実体と保存経路まで実測する。
