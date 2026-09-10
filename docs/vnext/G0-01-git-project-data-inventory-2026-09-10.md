# G0-01 Git内案件データ棚卸し

- 日付: 2026-09-10
- 対象HEAD開始点: `36420acee53a8607111c4e100904b903283efd25`
- 対象tree: `0931db6e61b320fbf93564062b7df2fed9df8482`
- 方針: `D-G0-02-09` により旧案件データは保護対象外。ただし削除は役割を特定できた実案件payload/exportだけ。

## 調査方法

GitHub Git tree APIで上記treeをrecursive取得した。応答は `truncated: false` であり、当該HEADの追跡済みpath全体をpath/roleで確認した。

## 判定

**現在のGit treeには、runtimeの実案件payload、案件backup、旧案件専用exportとして特定できる追跡済みファイルを確認できなかった。したがって案件データ削除commitは作らない。**

### データに見えるが削除対象外と判定したもの

| path / group | 役割 | 判定 |
|---|---|---|
| `change-records/FT-13.json` | 開発Task FT-13のbaseline、planned/actual files、deviation、verification、rollbackを記録する変更台帳 | 開発検証記録。保持 |
| `drizzle/meta/*_snapshot.json` | Drizzle schema snapshot | schema/migration metadata。保持 |
| `drizzle/meta/_journal.json` | migration生成journal | schema/migration metadata。保持 |
| `components.json` | UI/component設定 | 設定。保持 |
| `package.json` / `package-lock.json` | build/runtime dependency設定 | source/build設定。保持 |
| `tests/*.test.mjs` 内fixture | 汎用・隔離test fixture | 汎用検証資産。保持 |
| `docs/vnext/**` | 計画、G0診断、Decision、実装準備 | 開発証拠。保持 |
| `public/tsugu-ai-manual-v9.md` | TSUGU利用/AI manual | ドキュメント。保持 |

`README.md`にも「添付案件の実データはソースに含めない」と記載されており、今回のtree棚卸し結果と整合する。

## 削除を行わない理由

ユーザーの削除許可は無差別なJSON削除ではなく、旧案件の実データを非保護とする方針である。現treeでは対象を具体的に同定できないため、開発台帳・schema metadata・test fixtureを案件データと誤認して削除しない。

将来、追跡済みの実案件payload/exportが具体的に発見された場合は、path・役割・案件専用である根拠を記録した上で通常commitによる削除対象にできる。Git履歴rewrite/force pushは不要。

## 本番データとの境界

この棚卸しはGit追跡ファイルだけが対象である。現在D1/R2に存在する行/objectを削除した事実も、削除する許可もここからは導かない。physical D1/R2への無差別削除は別途明示Decisionがない限り実施しない。