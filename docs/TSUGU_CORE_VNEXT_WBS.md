# TSUGU Core vNext 実施作業一覧

**現行環境補正版:** 2026-09-11  
**参照:** `docs/TSUGU_CORE_VNEXT_PLAN.md` / `docs/TSUGU_PROJECT_REFERENCE.md`

## G0 現状と契約

| ID | 作業 | 合格条件 |
| --- | --- | --- |
| G0-01 | 現行参照先・実行環境・ツールを固定 | `main`、GitHub Pages、Private `tsugu-data`、Actions、GitHub API、現行認証経路を実測。Sites/D1/R2/MCPを現行前提から除外 |
| G0-02 | Core vNext実装契約を固定 | Git aggregate/commit確定方式、ID/scope、Actor/Permission、ChangeSet、Evidence保存方式、Deployment識別、復旧手段を確定 |
| G0-03 | 旧ランタイム撤去 | `app/`、Worker、D1/R2、Next/vinext/Wrangler/Drizzle等の旧実行コード・設定をmainから削除。fallback/import/shimを残さず、DeployとE2EがPASS |

## Stage A 基盤

| ID | 作業 | 依存 | 合格条件 |
| --- | --- | --- | --- |
| A-01 | Core境界、Actor/Permission、Audit | G0-02,G0-03 | legacy model importなし。GitHub認証主体を基準に越境・偽装・自己昇格を拒否 |
| A-02 | RepositoryCommitRef / Baseline / Deployment | A-01 | repository+SHAを一意化。GitHub Pages Deploymentを実測対象として固定 |
| A-03 | Project / ArchitectureNode / PathEntry / Binding | A-02 | 安定ID、cycle/file親/衝突/範囲外を拒否。legacy itemsを参照しない |
| A-04 | ChangeSet / atomic Apply | A-03 | base revision/hash/precondition固定。単一Git commit確定。競合は全拒否 |
| A-05 | GitHub reconciliation / Stage A結合検証 | A-04 | refresh/retry/重複排除、公開UI、保存、reload、Actionsが合格 |

## Stage B 実運用MVP

| ID | 作業 | 依存 | 合格条件 |
| --- | --- | --- | --- |
| B-01 | Box Registry / Schema / ChildConstraint / Box Binding | A-05 | Published固定、型不一致拒否、明示version、ChangeSet経由 |
| B-02 | Rule / TestDefinition / RequirementSnapshot | B-01 | 出所・継承・manual edit保持、判定不能CONFLICT |
| B-03 | Task / Approval / Waiver / Decision / Issue | B-02 | 開始/完了分離、対象版+hash+主体固定、Hold/Interrupt/Resume/Cancel履歴 |
| B-04 | Check / Evidence / EvidenceVersion | B-03 | immutable Git path、SHA-256+size+blob SHA readback、未確定EvidenceをPASS根拠にしない |
| B-05 | PlannedChange / ActualChange | B-04 | base/head固定、rename不明を推測しない、Git差分再照合 |
| B-06 | Assurance / Event / Dependency / invalidation | B-05 | 対象・要求版・世代一致PASSのみ。UNKNOWN中は操作不可。循環拒否 |
| B-07 | MVP通し検証 | B-06 | 失効、FAIL修正、承認、同時更新、Evidence retry、reload、最終承認をE2Eで確認 |

## Stage C / D

C-01 Impact Graph、C-02 Architecture Health、C-03同期回復・負荷検証、D-01 ArchitectureBaseline、D-02 Full Dry Run、D-03 Decision/Blueprint の順序はv2.3を維持する。各作業はGitHub保存方式を前提とし、D1/R2/旧server runtimeを再導入しない。

## 各Taskの記録

目的、対象、依存、開始/完了条件、開始commit、成果commit、変更ファイル、検査コマンド、Actions run、Deployment、PASS/FAIL、未解決Issue、次作業を記録する。完了済みFAILは削除せず解決関係を残す。
