# TSUGU Core vNext C-02 — 差分再計算とArchitecture Health

C-02はB-06の保守的失効を削除せず、C-01 Impact Graphで非影響を説明できるscopeだけを局所的に継続利用できるようにする。判定不能、同期UNKNOWN、Full test対象、世代不一致では従来どおり安全側に停止する。

## 正本と派生状態

`static/core-architecture-health.js` は新しい業務判断の正本を作らない。B-06 `StageBAssuranceEventRegistry`、B-03 Governance、C-01 `ImpactGraph` からhash固定の `ArchitectureHealthSnapshot` を導出する。Health cacheは派生物であり、削除しても同じ正本・同じ評価時刻から同じ `healthHash` を再構築できる。

Health snapshotはProject、評価世代、Assurance revision/sync state、Governance revision、Impact Graph hash、評価時刻を `context` として固定し、`inputHash` と `healthHash` を持つ。異なる世代や異なるsource fingerprintの計算結果はcache hitとして採用しない。

## Health優先順

要約と個別itemの優先順は計画v2.3どおり次で固定する。

`FAILED > CONFLICT > STALE > UNVERIFIED > WAIVED > VALID`

要約は各statusの件数だけでなく、全reasonと由来を保持する。矛盾する同一scope・同一世代AssuranceはCONFLICTとして記録し、FAILEDが同時に存在すれば優先順によりFAILEDを表示する。現在世代のAssuranceがなく旧世代VALIDしかなければ通常はSTALEである。

有効な人間承認付きWaiverは、scopeと版・hash・期限・revocationをB-03契約で再検証できる場合だけWAIVED理由として採用する。WaiverはFAILED、CONFLICT、STALE、UNVERIFIEDを隠さない。

## 差分再計算

B-06が `RECALCULATING` の間、C-01 Impact Graphが対象scopeを非影響と確定でき、直前世代のAssuranceがVALIDである場合に限り、Health上は `UNAFFECTED_CARRY_FORWARD` として局所的にVALIDを継続利用できる。変更影響scope、Full test scope、Impact Graph欠損はSTALEにする。既存FAILEDは非影響変更で解消されたとはみなさずFAILEDを維持する。

同期状態 `UNKNOWN` はImpact Graphの有無にかかわらずSTALEである。これにより外部事実を取得できない状態を「影響なし」と推測しない。

## Task READYとの分離

`evaluateTaskHealth` は全体Architecture Healthとは別に、Taskのsubjectと明示Event条件に関連するHealth itemだけを集約する。別Box/別NodeのFAILや再計算を理由に無関係Taskを一律BLOCKEDにしない。一方でTaskに関連するitemがSTALE/UNVERIFIED/CONFLICT/FAILEDならreadyにしない。

このAPIはHealthだけを判定する。B-06が持つApproval、Hold理由、TaskDependency、開始・完了条件の最終再検証を置き換えない。

## cache invalidation

cache keyはProject、評価世代、Assurance revision/sync state、Governance revision、Impact Graph hash、評価時刻に固定する。新世代のcontextから旧世代cacheを読むとmissになり、`evaluateTaskHealth` も期待世代と異なるsnapshotを拒否する。`invalidateHealthCache` で旧世代entryを明示削除できる。

cacheを空にして `rebuildArchitectureHealth` を実行した結果は、同じ正本入力ならcache利用時と同じ `healthHash` とsummaryになることを契約テストで固定する。

## 検証

`tests/core-architecture-health.test.cjs` はHealth優先順、全reason/由来、局所carry-forward、関連scope失効、Full test、安全側fallback、Waiver、世代cache拒否、cache再構築一致、同期UNKNOWN、Project越境拒否を検証する。

`.github/workflows/architecture-health-e2e.yml` はPRで実B-03/B-04/B-06/C-01モジュールに接続した契約テストを実行する。main統合後はPages公開物の一致と、公開済みC-02モジュールを使った再構築hash一致を追加確認する。
