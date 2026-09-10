# D-G0-02-09 旧案件データ非保護方針

- 日付: 2026-09-10
- 種別: Human Decision
- 対象: TSUGU Core vNext v2.3 / G0-01〜G0-02
- 状態: **決定済み**

## 決定

ユーザーはChatGPT側の旧案件を意図的に全削除し、旧案件データを保護・復元しない方針を明示した。これにより、過去に可視だった26/27件の所在探索、旧案件の復元、旧owner lineageの救済、旧案件をvNextへ移行するための互換mappingは、G0-02合格およびA-01着手の前提から外す。

Git repository内に、実案件payloadまたは当該旧案件専用export/backupが追跡済みファイルとして**具体的に特定できた場合**は、Git履歴を書き換えず通常commitで削除してよい。

## 削除許可の境界

削除対象になり得るのは、実案件データそのもの、またはその旧案件専用export/backupに限る。次は削除対象外である。

- application source
- DB schema / migration / Drizzle metadata
- TSUGU Core vNext修正計画・運用基準
- G0診断・検証・Decision・CI evidence
- 汎用test fixture / characterization test
- 開発変更台帳
- Git history / repository / branch

このDecisionはphysical D1/R2の無差別削除、hosting変更、binding変更、redeploy、writer切替を承認しない。本番データを削除する実行指示としても扱わない。

## 過去の診断記録の扱い

v21/v22のD1可視性差、owner fragmentation、孤児Evidence、過去26/27件が現在D1で確認できなかった事実は履歴証拠として残す。それらから「DB切替事故」「データ削除」等を遡及的に確定しない。

旧案件復旧を行わないため、`G0-01-nondestructive-recovery-matrix.md` と旧案件所在探索は**現在の着手Gateではなく過去の診断資料**として保持する。

## vNext新規データへの影響

旧案件を保護しないことは、新しく作るvNextデータの安全要件を弱めない。以下は引き続き必須とする。

- authenticated Actor / Project-scoped authorization
- stable ID / `project_id` / revision
- cross-project参照整合性
- ChangeSet原子性・Audit・Outbox
- Evidenceのversion固定・size/SHA検証
- FAIL履歴の非上書き
- writer切替前のbackup/restore検証

## Gate変更

G0-02の技術契約レビューおよびA-01のsource-level設計・実装準備は、旧26/27件の所在、旧owner mapping、旧案件復元を待たずに進める。Environment identifier、physical D1/R2 ID、live UI/API等の未確認事項は、該当Stageのintegration/cutover検証条件としてUNVERIFIEDのまま保持する。

TSUGU Task/Check/Evidenceへの登録は、実際に登録できた場合だけ登録済みと記録する。