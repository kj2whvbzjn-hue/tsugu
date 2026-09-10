# G0-01 v21/v22 physical Environment・D1・R2 比較表

- 対象: TSUGU Core vNext v2.3 / G0-01
- 性質: 読み取り専用診断成果物
- 状態: **未完了。v22の一部は監督実測済み、v21 physical provenance は未取得。**
- 禁止: rebind、redeploy、migration、owner書換え、新規案件、削除、writer切替

## 1. 取得経路

今回この作業チャットから利用可能な正規ブラウザ経路を1回確認したが、`Browser not connected` で停止した。再試行ループや別経路への迂回は行っていない。

取得不能項目を埋めるために必要な最小権限は次。

- 認証済みSites version/deployment historyのread
- v21/v22それぞれのEnvironment identifierとphysical D1/R2 binding metadataのread
- physical D1に対するSELECT / read-only PRAGMA
- physical R2 objectのmetadata readとobject read
- 設定変更、deploy、migration、write/delete権限は不要

logical binding名 `DB` / `BUCKET` をphysical resource IDとして扱わない。

## 2. 比較表

| 項目 | v21 | v22 | 期待出力 / 判定 | 取得元 |
|---|---|---|---|---|
| Sites version | 21 | 22 | version history上の不変値 | v21: 未取得 / v22: 監督実測 |
| source identifier | **未取得** | `de808756e8396b612ee992f83be3df61176f4dda` | Sites側source識別子。GitHub SHAと混同しない | v21: 未取得 / v22: 監督実測 |
| Deployment ID | **未取得** | `appgdep_6aa20602a9c8819192425635a3c76520` | immutable deployment identifier | v21: 未取得 / v22: 監督実測 |
| Environment identifier | **未取得** | **未取得** | 同一なら同一Environment候補、異なれば環境分離を強く示す | authorized deployment metadata |
| D1 logical binding | **未取得** | `DB` | 名前だけではphysical同一性を判定しない | v22監督実測 / source config |
| physical D1 ID | **未取得** | **未取得** | 一致/不一致が最重要分岐 | authorized binding metadata |
| D1 schema objects | **未取得** | `projects`,`revisions`,`evidences`,`evidence_versions`等を実測 | `G0-01-readonly-diagnostics.sql` のsqlite_master/PRAGMAで比較 | v21: 未取得 / v22: 監督D1 read + SQL待ち |
| applied migration record | **未取得** | **未取得** | migration履歴が取得可能なら0000..0005適用状態を確認。table存在だけでmigration履歴確定としない | authorized D1 metadata/read |
| `projects` count | **未取得** | 1 | v21に26/27件相当が存在すればphysical DB分岐の強い証拠 | read-only SQL |
| `revisions` count | **未取得** | 1 | project件数と履歴整合を見る | read-only SQL |
| `evidences` count | **未取得** | 1 | parent orphanを別途確認 | read-only SQL |
| `evidence_versions` count | **未取得** | 2 | version metadataとR2照合へ渡す | read-only SQL |
| distinct owner lineages | **未取得** | 少なくとも複数。監督観測では現認証主体を含め少なくとも3系統 | complete owner値は公開しない | read-only SQL + authenticated identity observation |
| orphan Evidence project_id | **未取得** | `73f74cc8-...`（公開資料では既知prefixのみ） | full IDは制限付き診断出力で照合可。対応projects行が無いことを確認 | 監督D1 read / read-only SQL |
| R2 logical binding | **未取得** | `BUCKET`（source設定） | physical IDではない | source config |
| physical R2 ID | **未取得** | **未取得** | v21/v22で一致/不一致を確認 | authorized binding metadata |
| orphan Evidence R2 object existence | **未取得** | **未取得** | object_keyに対し存在、size、SHAを確認 | authorized R2 read |
| signed-in UI project count | **未取得** | 0 | API返却とD1 owner条件を照合 | v22監督実測 |
| signed-in `/api/projects` | **未取得** | UI結果から0件相当、response原文は未取得 | HTTP status + JSON件数を取得 | authorized browser/API read |

## 3. GitHubとの対応

GitHub baseline `ad3534750e03345b38a01416e012b9f4dde06701` はSites source identifier `de808756...`そのものではない。GitHub側は `tsugu-source-v22-de808756(1).zip` を172ファイルとしてimportしたcommitである。

従って比較キーは次の4種類を分ける。

1. Sites version
2. Sites source identifier
3. Sites Deployment ID
4. GitHub import commit

## 4. D1判定規則

### physical D1 IDが異なる

過去26/27案件の所在候補としてv21側D1をread-only inventoryする。v21側に案件が存在すれば「削除」ではなくbinding/Environment divergenceが第一候補になる。まだrebindしない。

### physical D1 IDが同じ

同一DBでv21時点の案件が現在見えないなら、ownerだけでは説明できないため、バックアップ/履歴/operation log/retention/削除経路の証拠が必要。削除と断定しない。

### physical D1 IDを取得できない

logical名の一致だけで同一DB判定をしない。G0-01は未確認のまま保持する。

## 5. R2 existence / size / SHA 読取手順

1. 対象deploymentのphysical R2 resource IDをread-only metadataから取得する。`BUCKET`というlogical名だけで判定しない。
2. D1 `evidence_versions` をread-onlyで取得し、`object_key`, `byte_size`, `sha256`, `storage_state` を制限付き証拠として保存する。
3. 同じphysical bucketに対しobject metadata/readを行う。write/copy/deleteは行わない。
4. object不存在なら `NOT_FOUND` と記録する。別bucket探索を無差別に行わず、まずv21/v22 binding provenanceを確定する。
5. objectが存在すれば取得byte数をD1 `byte_size` と比較する。
6. object bytesをローカル/読取処理内でSHA-256し、D1 `sha256` と比較する。完全bytesを取得できない権限ならSHAは **未確認** とする。
7. 結果は `EXISTS + SIZE_MATCH + SHA_MATCH`、`EXISTS + SIZE/SHA_MISMATCH`、`NOT_FOUND`、`UNVERIFIED` に分ける。
8. orphan Evidenceは現行APIが親Project確認で先に拒否するため、API 404/拒否をR2不存在の証拠にしない。

## 6. 現在の取得済み / 未取得

取得済みはv22のversion/source/deployment、signed-in UI 0件、logical `DB`、D1の限定table inventoryとowner分断、orphan Evidence存在。physical D1/R2 ID、Environment、v21一式、R2 direct readback、v22 `/api/projects` response原文は未取得。

この未取得状態ではG0-02契約承認/A-01へ進まない。
