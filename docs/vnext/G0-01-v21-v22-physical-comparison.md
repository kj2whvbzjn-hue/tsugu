# G0-01 v21/v22 physical Environment・D1・R2 比較表

- 対象: TSUGU Core vNext v2.3 / G0-01
- 性質: 読み取り専用診断成果物
- 状態: **未完了。v21/v22のdeployment control-plane情報は監督実測済み。physical D1/R2 provenance、Environment identifier、v21 inventory、R2 readbackは未取得。**
- 禁止: rebind、redeploy、migration、owner書換え、新規案件、削除、writer切替

## 1. 取得経路

今回この作業チャットから利用可能な正規ブラウザ経路を1回確認したが、`Browser not connected` で停止した。再試行ループや別経路への迂回は行っていない。

その後、監督側の正規な読取経路で v21/v22 の version/deployment metadata が追加確認された。以下の確定値は監督実測として採用する。一方、physical resource identityを示さない項目からD1/R2同一性を推論しない。

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
| Sites version | `21` | `22` | version history上の不変値 | 監督実測 |
| source identifier | `a61060a798454fc457bce4afc05d24202f8c656e` | `de808756e8396b612ee992f83be3df61176f4dda` | Sites側source識別子。GitHub SHAと混同しない | 監督実測 |
| Deployment ID | `appgdep_6aa122d6d9f481919bb334743dfad300` | `appgdep_6aa20602a9c8819192425635a3c76520` | immutable deployment identifier | 監督実測 |
| Deployment status | `succeeded` | `succeeded` | deployment成功状態の記録。physical resource同一性は示さない | 監督実測 |
| Updated | `2026-09-09T09:12:44.881187Z` | `2026-09-10T01:22:01.373021Z` | version/deployment metadataの時刻 | 監督実測 |
| provider_deployment_id | `site---6a9d191e8fd48191ac8b14311ccfa935` | `site---6a9d191e8fd48191ac8b14311ccfa935` | 同じprovider-side site/deployment familyを示す観測値。ただしphysical D1/R2 IDではない | 監督実測 |
| env_set_revision | `0` | `0` | environment-set revision metadata。同値でもphysical resource mapping同一とは判定しない | 監督実測 |
| Sites environment variables | revision `0`, entries empty | revision `0`, entries empty | user-visible env variable setに差がない観測。binding resource metadataとは別物 | 監督実測 |
| Environment identifier | **UNVERIFIED** | **UNVERIFIED** | provider/site IDやenv_set_revisionで代用しない | authorized deployment/environment metadata |
| D1 logical binding | **UNVERIFIED for v21** | `DB` | 名前だけではphysical同一性を判定しない | v22監督実測 / source config |
| physical D1 ID | **UNVERIFIED** | **UNVERIFIED** | 一致/不一致が最重要分岐 | authorized binding metadata |
| D1 schema objects | **UNVERIFIED** | `projects`,`revisions`,`evidences`,`evidence_versions`等を実測 | `G0-01-readonly-diagnostics.sql` のsqlite_master/PRAGMAで比較 | v21: 未取得 / v22: 監督D1 read + SQL待ち |
| applied migration record | **UNVERIFIED** | **UNVERIFIED** | migration履歴が取得可能なら0000..0005適用状態を確認。table存在だけでmigration履歴確定としない | authorized D1 metadata/read |
| `projects` count | **UNVERIFIED** | 1 | v21に26/27件相当が存在すればphysical DB分岐の強い証拠 | read-only SQL |
| `revisions` count | **UNVERIFIED** | 1 | project件数と履歴整合を見る | read-only SQL |
| `evidences` count | **UNVERIFIED** | 1 | parent orphanを別途確認 | read-only SQL |
| `evidence_versions` count | **UNVERIFIED** | 2 | version metadataとR2照合へ渡す | read-only SQL |
| distinct owner lineages | **UNVERIFIED** | 少なくとも複数。監督観測では現認証主体を含め少なくとも3系統 | complete owner値は公開しない | read-only SQL + authenticated identity observation |
| orphan Evidence project_id | **UNVERIFIED** | `73f74cc8-...`（公開資料では既知prefixのみ） | full IDは制限付き診断出力で照合可。対応projects行が無いことを確認 | 監督D1 read / read-only SQL |
| R2 logical binding | **UNVERIFIED for v21** | `BUCKET`（source設定） | physical IDではない | source config |
| physical R2 ID | **UNVERIFIED** | **UNVERIFIED** | v21/v22で一致/不一致を確認 | authorized binding metadata |
| orphan Evidence R2 object existence | **UNVERIFIED** | **UNVERIFIED** | object_keyに対し存在、size、SHAを確認 | authorized R2 read |
| signed-in UI project count | **UNVERIFIED** | 0 | API返却とD1 owner条件を照合 | v22監督実測 |
| signed-in `/api/projects` | **UNVERIFIED** | UI結果から0件相当、response原文は未取得 | HTTP status + JSON件数を取得 | authorized browser/API read |

## 3. 同一 provider_deployment_id / env_set_revision から physical resource 同一と結論しない理由

v21/v22で `provider_deployment_id` が同一、`env_set_revision` がともに0、Sites environment variablesも revision 0 / entries empty であることは確認済みである。しかし、これらの値は次を直接示していない。

- physical D1 database UUID / resource identifier
- logical `DB` がどのphysical D1へ解決されたか
- physical R2 bucket identifier
- logical `BUCKET` がどのphysical R2へ解決されたか
- deploymentごとのEnvironment identifier
- binding provenance / resource mapping revision

したがって、同じprovider-side siteに属し、同じenvironment-set revisionを参照している可能性は示しても、**D1/R2のphysical resource identityを証明しない**。physical resource同一/相違の判定には、binding metadataでresource IDを直接取得するか、同一resourceであることを一意に証明できるread-only provenanceが必要である。

Sites environment variablesがentries空であることも、D1/R2 bindingが存在しない、または同一であることを意味しない。environment variable entriesとD1/R2 resource bindingsは別の確認対象として扱う。

## 4. GitHubとの対応

GitHub baseline `ad3534750e03345b38a01416e012b9f4dde06701` はSites source identifier `de808756...`そのものではない。GitHub側は `tsugu-source-v22-de808756(1).zip` を172ファイルとしてimportしたcommitである。

従って比較キーは次を分ける。

1. Sites version
2. Sites source identifier
3. Sites Deployment ID
4. provider_deployment_id
5. env_set_revision
6. Environment identifier
7. physical D1 / R2 identifiers
8. GitHub import commit

## 5. D1判定規則

### physical D1 IDが異なる

過去26/27案件の所在候補としてv21側D1をread-only inventoryする。v21側に案件が存在すれば「削除」ではなくbinding/Environment divergenceが第一候補になる。まだrebindしない。

### physical D1 IDが同じ

同一DBでv21時点の案件が現在見えないなら、ownerだけでは説明できないため、バックアップ/履歴/operation log/retention/削除経路の証拠が必要。削除と断定しない。

### physical D1 IDを取得できない

logical名、`provider_deployment_id`、`env_set_revision`、environment variable revisionの一致だけで同一DB判定をしない。G0-01は未確認のまま保持する。

## 6. R2 existence / size / SHA 読取手順

1. 対象deploymentのphysical R2 resource IDをread-only metadataから取得する。`BUCKET`というlogical名だけで判定しない。
2. D1 `evidence_versions` をread-onlyで取得し、`object_key`, `byte_size`, `sha256`, `storage_state` を制限付き証拠として保存する。
3. 同じphysical bucketに対しobject metadata/readを行う。write/copy/deleteは行わない。
4. object不存在なら `NOT_FOUND` と記録する。別bucket探索を無差別に行わず、まずv21/v22 binding provenanceを確定する。
5. objectが存在すれば取得byte数をD1 `byte_size` と比較する。
6. object bytesをローカル/読取処理内でSHA-256し、D1 `sha256` と比較する。完全bytesを取得できない権限ならSHAは **UNVERIFIED** とする。
7. 結果は `EXISTS + SIZE_MATCH + SHA_MATCH`、`EXISTS + SIZE/SHA_MISMATCH`、`NOT_FOUND`、`UNVERIFIED` に分ける。
8. orphan Evidenceは現行APIが親Project確認で先に拒否するため、API 404/拒否をR2不存在の証拠にしない。

## 7. 現在の取得済み / 未取得

### 取得済み

- v21: version/source/deployment/status/updated/provider_deployment_id/env_set_revision
- v22: version/source/deployment/status/updated/provider_deployment_id/env_set_revision
- Sites environment variables: 両対象で revision 0 / entries empty
- v22 signed-in UI: 0件
- v22 logical D1 binding: `DB`
- v22 D1限定inventoryとowner分断、orphan Evidence存在

### UNVERIFIED

- v21/v22 Environment identifier
- v21/v22 physical D1 ID
- v21/v22 physical R2 ID
- v21 D1 inventory / owner分布 / 過去26/27案件所在
- v21/v22 applied migration record
- direct R2 existence / size / SHA readback
- v22 `/api/projects` response原文

この未取得状態ではG0-02契約承認/A-01へ進まない。
