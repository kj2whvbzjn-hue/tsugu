# TSUGU Core vNext A-03 Architecture Domain 契約

**Task:** A-03  
**開始基準:** `a5eee7bbb6ed9ffa86fd78b60907bcec44b51977`  
**依存:** A-01 / A-02 PASS

## 1. Project / 安定ID

Architecture domainは`ProjectArchitecture`としてProject単位に閉じる。Project、ArchitectureNode、PathEntry、ArchitectureBindingはrevisionを持ち、Node / Path / BindingのIDは表示名やpath文字列から独立した安定IDとする。

rename / moveでIDを付け替えず、子孫が親IDを参照している関係も維持する。入力JSON中の別Project IDは`PROJECT_SCOPE_VIOLATION`で拒否する。

## 2. ArchitectureNode tree

ArchitectureNodeはPathEntryとは別の木として管理する。

- 親は同一Project内の既存Nodeだけ
- selfまたはdescendantへのmoveを`NODE_CYCLE`で拒否
- 同一親内のNFC正規化済みname衝突を`NODE_NAME_COLLISION`で拒否
- rename / move時は対象Nodeだけrevisionを進め、IDと子孫参照は保持

## 3. PathEntry tree

PathEntryはGitHub repository IDごとに独立した木として管理する。

- kindは`DIRECTORY`または`FILE`
- `FILE`を親にしない
- self / descendantへのmoveを拒否
- Repositoryを跨ぐmoveを`CROSS_REPOSITORY_MOVE`で拒否
- Projectに登録されていないrepository IDを`REPOSITORY_SCOPE_VIOLATION`で拒否
- 同一Repository・同一親内のname衝突を拒否
- `.` / `..` / `/`を含むpath componentを拒否
- rename / move後もPathEntry IDと子孫参照は保持

path文字列は主キーにせず、現在の木から`derivePath()`で導出する。A-02のRepositoryBaselineが過去commit/treeを固定するため、現在PathEntryを移動しても過去Baselineを変更しない。

## 4. ArchitectureBinding

Stage Aでは一行が一つのPathEntryと一つのArchitectureNodeを結ぶ。targetTypeは`NODE`だけを許可し、Box / BoxInstance参照は拒否する。

relationはStage CのImpact Graphへ接続できる最小集合として以下を受理する。

- `IMPLEMENTS`
- `TESTS`
- `CONFIGURES`
- `MIGRATES`

参照先不存在、別Project、未知relation、有効期間の重複を拒否する。Bindingを付け替える場合に過去対応を失わないよう、既存行を削除せず`inactiveFromRevision`で無効化し、新しいBinding行を追加する。

## 5. 永続化境界

A-03ではdomain stateの検証、決定論的serialize / hydrateまでを実装する。GitHubへの構造変更書込みはまだ接続しない。

`PUBLIC_WRITE_ENABLED = false` とし、公開構造書込みを試みる境界は`STRUCTURE_WRITE_LOCKED_UNTIL_A04`で拒否する。A-04でChangeSet、base revision/hash、precondition、atomic Applyを完成させた後にのみ現行GitHub保存経路へ接続する。

## 6. 検証

`tests/core-architecture.test.cjs`で以下を検査する。

- stable ID / revision / descendant reference保持
- Node cycle / name collision拒否
- Path cycle / FILE親 / name collision / Repository越境拒否
- Project / Repository scope拒否
- Binding参照整合 / relation / Box禁止 / 有効期間重複拒否
- Binding履歴保持
- serialize / hydrate
- A-04までのpublic write lock

`TSUGU Architecture E2E`はPages配信後、公開`core-architecture.js`がcheckoutと一致することを確認し、公開されたモジュール自身でProject・Node・Path・Bindingの生成、path導出、serialize/hydrate、write lockを検査する。既存`TSUGU E2E`は従来案件作成・保存経路の回帰検査としてそのまま実行する。
