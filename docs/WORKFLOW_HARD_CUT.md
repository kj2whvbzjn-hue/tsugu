# TSUGU Workflow ハードカット実装契約

基準commit: `290b50609e9063a29489285f0406eb1ec4a37737`。
指示: 解析済み工程管理をTSUGUへ移植し、破綻した旧システムへの依存・互換を残さない。

## 変更範囲

旧のitems/Core/画面v4〜v6、gzip Base64 app、旧ランタイムに結び付いたテスト・Actionsを撤去する。新しいdomain、Git repository接続、UI、契約テスト、通し検証へ置換する。旧テストの削除は判定緩和ではなくモデル全体の置換であり、新しい重要不変条件を独立に検証する。過去のdocs・change-recordsは履歴として残し、実行依存にしない。

Hostingは既存GitHub Pages。Private案件保存は新しい `data/workflow-projects/`。旧案件ディレクトリを読み書きせず、旧データの削除／移行も行わない。新しい案件を作成して運用を始める。

## 移植した構造

| 領域 | 新モデル |
| --- | --- |
| 案件 | workspace、authority、revision、context、current_focus、source_baseline |
| 作業分解 | architecture_nodesの木、work_boxes、tasks、Task依存DAG |
| 計画と仕様 | discussions、decisions、specifications、specification_candidates、project_rules |
| システム設計 | system_nodes、system_contracts、system_connections、system_impacts、flags/events |
| 工程 | Discovery / Planning / Implementing / Verifying / Completed |
| 案件状態 | Active / Paused / Completed / Superseded / Archived |
| Task | Todo / Doing / Blocked / Done、受入条件、作業種別、順序、承認 |
| 確認と証拠 | checks、resolves_check_ids、artifacts、implementation_records、history |

Git blob SHAは保存競合、revisionは案件の保存版、instance UUIDは案件同一性、SHA-256は承認内容／成果物の固定に用いる。役割を混同しない。

## 解析元から補強した条件

- Task依存・Architecture・仕様依存の循環を拒否。
- 不明statusをTodoへ丸めず拒否。
- Completed入力には対応する承認、全Task Done、Completion Gate、Lifecycle一致を要求。
- Task Doneには対象TaskのCompletion Check、実装種別にはApplied記録とcommit SHAを要求。
- Generalを含む未解決必須FAILで開始／完了Gateを閉じる。
- 実施済みCheck・Artifact版は不変。失敗解決は対象種別・対象ID・Gate一致と実時刻を検証。
- Workflow承認とTask承認は対象内容のSHA-256へ固定。関連計画の変更で再承認を要求。
- JSONはIDマージ後の最終候補で参照を検証。配列部分入力が他の既存参照を見失う問題を解消。
- AI返却はIdentity／base revision検証、完全Record更新、差分確認を経る。承認・工程・Lifecycle・Task状態を直接変更できない。
- Git保存は常に利用者が選択したbranch。直前のSHA/revisionを確認し、同時更新と正本消失を拒否。
- 1案件1ファイルで一覧をGitディレクトリから取得。案件本文と別indexの部分成功問題を作らない。

## 保存と権限

GitHub `/user` とPrivate repository書込権限を確認する。PATはメモリにだけ保持し、保存・承認時に再確認する。接続失敗はidentityを破棄する。Git保存中の二重送信を拒否する。PUTの結果が不明なときは自動再送せず、再読込を要求する。

アプリ内チェックはサーバー側の承認強制ではない。直接data repositoryを書き換えられる権限を持つ主体は、この静的クライアントを経由せず変更できる。GitHub側の権限と履歴を監査境界とする。専用サーバーの追加は本移植で暗黙に行わない。

成果物はversion／URI／SHA-256を保持する参照モデルであり、外部URI原本のreadbackやR2 uploadを提供するものではない。Checkのevidenceは実施者が登録する証拠情報であり、ソース変更や外部検査の自動実行は含めない。実装記録のcommitは形式を検証するが、任意Repositoryのcommit実在・diffを自動証明するものではない。

## UIと操作

案件 → 概要／構成／Task／工程・確認／議論・仕様／システム／実装・成果物／履歴／引継ぎ。

Task作成にはWorkBox、WorkBoxにはArchitectureが必要。作業対象の状態変更には専用操作を使う。実施済み確認結果は閲覧専用。仕様候補では素材を固定し、hashと未解決Impactを検査して正式仕様へ承認する。

書込みは編集中の案件へ反映し、明示的なGitHub保存で確定する。未保存の離脱確認、エラー表示、モバイル折り返し、編集dialogのキーボード移動を用意する。

## 検証と配置の境界

`tests/workflow.test.mjs` は実装のhappy pathだけでなく、循環、参照切れ、承認偽装、古いJSON、チェック改変、結果の時刻逆転、正本消失、Git競合を検証する。

`tests/workflow-ui.e2e.cjs` は390pxのブラウザで案件作成・構成・Task・開始承認・Task承認・FAIL・再確認・Task完了・最終承認・Git保存・reloadを操作する。Git APIは状態を保持するfixtureで検証し、画像と結果をActions artifactへ保存する。

ローカル環境では契約テストと成果物構築を実行した。Chromium取得はネットワークtimeoutのため未完了であり、ブラウザ検証はGitHub Actionsの結果で別途確認する。CI未実行／失敗をPASS扱いにしない。公開環境での実測はDeployment後に区別して記録する。

## CI実測（2026-09-12）

PR #32のhead `bc82a768842defa0ede7d3747469332b6ddadb78` に対する [Actions run 34696873289](https://github.com/kj2whvbzjn-hue/tsugu/actions/runs/34696873289) が成功した。契約テスト24件、成果物の旧依存排除、Chromiumの作成から完了・保存・reloadまでの通し検証が合格。モバイル／デスクトップ画像は同runのartifactに記録。これはGitHub API fixtureでの受入であり、公開後の実データ書込み実測ではない。
