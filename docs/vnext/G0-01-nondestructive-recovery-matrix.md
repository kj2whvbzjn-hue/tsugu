# G0-01 非破壊復旧 判断表

- 対象: TSUGU Core vNext v2.3 / G0-01
- 状態: **原因未確定。復旧操作未承認。**
- 原則: 先にprovenanceとbackupを確定し、rebind/owner変更/copy/migrationは後段の人間Decisionに分離する。

| ケース | 必要証拠 | backup前提 | 人間判断 | 非破壊・可逆な候補 | 禁止操作 |
|---|---|---|---|---|---|
| v21/v22が同一physical D1 | 両deploymentのphysical D1 ID一致、同一Environment/別Environmentの記録、現在table inventory、過去案件存在を示すbackup/log/history | 現D1 snapshot/export相当、R2 inventory、Evidence metadata保全 | 案件消失の原因調査をどこまで行うか。owner alias調整だけで復旧可能か | read-only owner照合、隔離cloneでの復元検証、UI/APIをcloneに向けないオフライン比較 | 本番owner一括書換え、migration、DELETE、現在DBへの推測import |
| v21/v22が別physical D1 | physical D1 ID不一致、v21側に26/27案件相当が存在、schema/owner分布比較 | v21/v22双方のD1 backup、双方のR2 inventory、deployment/binding記録 | 正本DBをどちらとするか、将来の統合方式、切替承認者 | まず隔離コピーで差分分析。必要なら後続Decisionでrebindまたは明示migrationを設計 | 即時rebind、片側DB削除、writer同時稼働、未backup移行 |
| 旧physical D1が未発見 | v21 deployment/binding metadata探索結果、取得不能理由、権限境界、既存backup/archive有無 | 発見済みv22 D1/R2を先に保全 | 探索継続範囲、provider側調査/復旧依頼の要否 | provider/read-only履歴、既存export/backup/GitHubに保存された非機密記録の照合 | 新DBを正本と決めつける、空DBへ再作成、旧データ不存在と断定 |
| 同一DBでownerのみ不一致 | physical D1同一、過去案件rowが存在、対象rowのownerが現identity keysと不一致、project/evidence owner整合 | owner変更前のD1 backup、owner分布・対象ID一覧、R2 inventory | 互換alias方式かデータ移行方式か、対象owner lineageの本人性確認 | 読取時alias/compatibility mapping、明示mapping table等の可逆方式を優先。隔離fixtureで先に検証 | 本人性未確認のowner書換え、複数owner無条件統合、履歴owner破壊 |

## 共通Gate

復旧操作へ進む前に最低限次を満たす。

1. v21/v22のDeployment ID、Environment、physical D1/R2 provenanceを可能な範囲で確定する。
2. `G0-01-readonly-diagnostics.sql` の出力をdeployment別に保存する。
3. projects/revisions/Evidence 3表の件数・owner lineage・孤児関係を比較する。
4. R2はobject existence/size/SHAをread-only確認する。
5. D1とR2のbackup/inventoryを取り、復元可能性を人間が確認する。
6. どのDBを正本候補とするかをDecision化する。
7. その後もG0-02承認まではA-01を開始しない。

## 現時点の原因優先度

- physical D1 binding / Environment divergence: **最優先で確認。未確定。**
- owner fragmentation: **存在は確認済み。ただし現D1に過去26/27 row自体が無い観測を単独では説明しない。**
- 親Project消失後のEvidence残存: **現行コードで可能。今回の発生原因かは未確定。**
- destructive migration: **現行0000..0005 sourceからは支持されない。**
- R2 divergence/object loss: **未確認。**

## TSUGU登録

案件可視性復旧までTask/Check/Evidence登録は未実施のまま保持する。登録したふりをしない。
