# TSUGU GitHub Pages 静的版

## 構成

- 公開UI: `kj2whvbzjn-hue/tsugu` の `static/` を GitHub Pages で配信
- 案件保存: Private リポジトリ `kj2whvbzjn-hue/tsugu-data`
- データブランチ: `main`
- 案件ファイル: `data/projects/<projectId>.json`
- 1回の保存 = 1 Git commit
- 履歴 = Git commit history
- 競合防止 = Contents API の blob SHA と案件 revision の双方を照合

公開UIと案件データを分離する。`tsugu` リポジトリは GitHub Pages 用に Public のまま維持し、案件データは `tsugu-data` の Private リポジトリへ保存する。

## 認証

GitHub Pages は静的ホスティングのため、サーバー側に秘密情報を保持しない。
利用者が Fine-grained personal access token を画面で入力し、そのタブのメモリ内だけで利用する。
localStorage / Cookie / 案件JSONには保存しない。

推奨権限:

- Repository access: `kj2whvbzjn-hue/tsugu-data` のみ
- Repository permissions: `Contents: Read and write`

静的アプリは接続時に保存先リポジトリが Private であることを確認し、Public リポジトリを案件保存先として指定した場合は接続を拒否する。
`.github/workflows` をブラウザから変更する機能は実装していないため、静的アプリ利用用PATに Workflows 権限は不要。

## GitHub Pages 有効化

公開リポジトリ `kj2whvbzjn-hue/tsugu` の Settings → Pages → Build and deployment → Source を `GitHub Actions` に設定する。
`main` の `pages.yml` が `static/` の静的成果物をデプロイする。

## 初回データ保存

`tsugu-data` は `main` ブランチが存在すれば、`data/projects/` を事前作成しなくてもよい。
最初の案件保存時に GitHub Contents API が `data/projects/<projectId>.json` を作成する。

## 対応範囲

静的版で対応:

- Private GitHubリポジトリ上の案件一覧・読込・新規作成・更新・削除
- 案件版（revision）とGit blob SHAによる競合検出
- Git commit履歴の表示・過去JSON参照
- 概要、工程、項目編集
- 実装承認・完了承認の保存版スタンプ
- SOURCE_UPDATE作業の変更計画／完了検査
- 作業依存の実行前検査
- TSUGU schemaVersion 1 JSONの新規取込／バックアップ
- AI引き継ぎテキスト生成、AI返却JSONの手動反映
- 高度な案件JSON編集（core等の専用UI未移植フィールドを保持）

静的版で非対応:

- Cloudflare D1 / R2
- ChatGPT Sites認証
- `/api/*` サーバールート
- MCPサーバー
- サーバー受信型のAI提案Inbox
- 旧Development Project JSONの変換取込

既存Cloudflare版のソースは残し、GitHub Pages版を並行配置する。
