# TSUGU GitHub Pages 静的版

## 構成

- UI: `static/` を GitHub Pages で配信
- 案件保存: 同一リポジトリの `tsugu-data` ブランチ
- 案件ファイル: `data/projects/<projectId>.json`
- 1回の保存 = 1 Git commit
- 履歴 = Git commit history
- 競合防止 = Contents API の blob SHA と案件 revision の双方を照合

## 認証

GitHub Pages は静的ホスティングのため、サーバー側に秘密情報を保持しない。
利用者が Fine-grained personal access token を画面で入力し、そのタブのメモリ内だけで利用する。
localStorage / Cookie / 案件JSONには保存しない。

推奨権限:

- Repository access: `kj2whvbzjn-hue/tsugu` のみ
- Repository permissions: `Contents: Read and write`

`.github/workflows` をブラウザから変更する機能は実装していないため、静的アプリ利用用PATに Workflows 権限は不要。

## GitHub Pages 有効化

リポジトリ Settings → Pages → Build and deployment → Source を `GitHub Actions` に設定する。
`main` にこの変更を取り込むと `pages.yml` が `static/` の静的成果物をデプロイする。

## 対応範囲

静的版で対応:

- GitHub上の案件一覧・読込・新規作成・更新・削除
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
