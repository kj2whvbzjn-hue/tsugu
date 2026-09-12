# TSUGU C-04 v4 — 構造UI再設計決定

## 1. 再設計の起点

C-04 v3 は自動受入を通過したが、実機確認で不合格となった。問題は操作距離ではなく、画面の主構造が初期構想と現行の運用基準に一致していなかったことである。

初期構想図では、構造ノード／Box が階層・分岐し、各地点に複数の項目と状態・フラグが付随する。固定の「Task → Box → 仕様」の一方向3段階ではない。任意地点から親・子・関連元・関連先へ戻れる必要がある。

運用基準書は Architecture / WorkBox / Task を TSUGU の業務側 first-class entity とし、汎用 `items` への新規機能継ぎ足しを禁止、`items` は互換経路に限定すると定める。Core vNext も Box、Rule/Test、Task、Check/Evidence、Event/TaskDependency を独立した型として持つ。

## 2. UIの正規構造

### 2.1 主画面

主画面は「構造マップ」とする。

- ArchitectureNode は親子木を形成する。
- WorkBox は ArchitectureNode に配置され、必要に応じて WorkBox 自身も親子を持つ。
- 各 WorkBox には Task、Test、Decision、Issue、Check 等の typed entity が付随する。
- 初期構想図の「項目A〜D＋フラグ」に相当する表示は、typed entity の一覧と派生状態として表示する。
- 色や表示フラグを主キーや正本状態として扱わない。

### 2.2 関係の保存と表示

関係レコード自体は方向を持ってよいが、UI は必ず incoming / outgoing の両方を逆引きする。

したがって、どの entity から開いても以下を同じ画面内で確認・移動できることを必須とする。

- 親
- 子
- 所属先
- 所属元
- 依存先
- 依存元
- 生成先
- 利用先
- 検査対象
- 検査定義

「関連先」1フィールドに全関係を押し込めない。

### 2.3 登録面

少なくとも以下は独立した登録面を持つ。

1. ArchitectureNode
2. WorkBox
3. Task
4. Test
5. Event / TaskDependency
6. Decision / Issue / Check

Box、Test、Dependency を legacy item の本文や task JSON へ埋め込まない。

## 3. legacy `items` の扱い

`project.items` は既存案件互換のため読み取り・保守経路を残すが、新構造UIの正本にはしない。

- 新しい Box、Task、Test、Dependency は `items` へ追加しない。
- `parentId` を新構造の親子・関連関係に使用しない。
- `task.dependsOn` を新しい依存正本に使用しない。
- 互換項目は専用の「互換項目」領域に隔離する。

## 4. 双方向ナビゲーションの原則

双方向とは同じ関係を二重保存することではない。1件の正規関係から reverse index を導出して、両端から辿れることを意味する。

例:

- WorkBox → Task と Task → WorkBox
- WorkBox → Test と Test → WorkBox
- producer Task → Event → dependent Task と dependent Task → required Event → producer Task
- parent ArchitectureNode → child と child → parent
- parent WorkBox → child と child → parent

この原則は仕様・Box・Taskだけに限定しない。

## 5. 受入前提

実装前に `static/c04-structure-ui-plan-v4.json` を凍結する。C-04 v3 の過去PASSは削除しないが、実機不合格を別記録として残し、v4合格の代用にはしない。

v4は、構造・登録場所・双方向逆引き・legacy隔離・依存循環拒否を満たして初めて候補UI合格とする。
