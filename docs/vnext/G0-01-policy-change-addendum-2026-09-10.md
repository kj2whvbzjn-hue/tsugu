# G0-01 診断追補 — 旧案件非保護への方針変更

- 日付: 2026-09-10
- 参照Decision: `D-G0-02-09-legacy-data-nonretention-2026-09-10.md`
- 対象: G0-01 runtime/physical provenance診断
- 状態: **過去の実測は保持。旧案件復旧Gateのみ解除。**

## 1. 方針変更

ユーザーはChatGPT側の旧案件を意図的に削除し、旧案件を保護・復元しない方針を明示した。このため、以下はG0-02/A-01へ進むための前提ではなくなった。

- 過去26/27案件の所在特定
- 旧D1からの案件復元
- 旧owner lineageの本人照合・統合
- 旧案件のR2原本回収
- 旧案件ID mapping/compatibility migration

`G0-01-nondestructive-recovery-matrix.md` は当時の原因診断・復旧選択肢の履歴として残すが、現在のlegacy datasetの復旧Gateとしては使用しない。

## 2. 変わらない履歴事実

次は削除・上書きせず、G0-01の観測履歴として維持する。

- v22認証済みUIで案件0件だった。
- 当時読取したD1は `projects=1`, `revisions=1`, `evidences=1`, `evidence_versions=2` だった。
- Evidenceに対応Projectがない孤児参照を観測した。
- current auth / Project / Evidenceでowner lineage分断を観測した。
- characterizationで、現行Project DELETE後にEvidence metadata/R2 objectを残し得る挙動を再現した。
- v21/v22のphysical D1/R2 resource IDは未取得で、過去の案件0事象の原因は確定していない。

旧案件を復元しないDecisionは、過去の原因を「削除」「binding事故」等に確定する根拠ではない。

## 3. `/api/projects` 直接読取の追加観測

監督側がサインイン済み `/api/projects` の直接読取を試みたが、Cloud BrowserのURL policyにより `net::ERR_BLOCKED_BY_CLIENT` で拒否された。policy上の迂回は行っていない。

この結果はAPI serverの障害やHTTP statusを示さない。したがって認証済み `/api/projects` response原文は引き続き **UNVERIFIED** とする。

## 4. Git内案件データ

HEAD `36420acee53a8607111c4e100904b903283efd25` のrecursive Git treeを完全取得してpath/roleを棚卸しした。結果は `G0-01-git-project-data-inventory-2026-09-10.md` に記録した。

実案件payload/旧案件専用export/backupとして特定できる追跡済みファイルは見つからなかったため、案件データ削除は実行していない。`change-records/FT-13.json` は開発変更台帳、`drizzle/meta/**` はschema metadata、tests内データは汎用fixtureであり削除対象外。

## 5. physical provenanceの新しい位置付け

以下は依然UNVERIFIEDである。

- Environment identifier
- v21/v22 physical D1 resource ID / binding target
- v21/v22 physical R2 resource ID / binding target
- applied migration journalのlive値
- R2 object direct readback / size / SHA
- authenticated `/api/projects` response原文

ただし、これらは**旧案件復旧のためのG0-02全停止条件ではない**。次のStage-specific Gateとして保持する。

- A-02: Environment/Deployment/resource provenance
- A-04: D1 transaction/atomicity integration
- Stage B Evidence: R2 readback/SHA/project scope
- R/cutover: 新vNext dataのbackup/restore/writer verification

logical `DB` / `BUCKET`、`provider_deployment_id`、`env_set_revision` をphysical resource IDの代替にしない原則は維持する。

## 6. G0-02/A-01への移行

G0-02の8契約候補は `G0-02-contract-review-2026-09-10.md` で再評価する。A-01のsource-level対象path・入出力・受入testは `A-01-implementation-plan-2026-09-10.md` に固定する。

G0-02全体を人間承認済みとはまだ記録しない。一方、旧案件の復旧待ちを理由にsource-level準備を停止しない。

## 7. 本番操作境界

今回の方針変更は次を自動承認しない。

- production D1/R2の全削除
- migration実行
- owner書換え
- physical rebind
- redeploy
- hosting変更
- writer切替

TSUGU Task/Check/Evidence登録は未実施。実際に登録した時だけ登録済みとする。