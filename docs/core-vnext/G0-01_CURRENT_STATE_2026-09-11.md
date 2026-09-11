# G0-01 現状調査記録

**実施日:** 2026-09-11  
**開始 commit / main HEAD:** `1f3a551361e691352e35dccfc5b40a5c34aa1d6a`  
**Repository:** `kj2whvbzjn-hue/tsugu`  
**公開先:** GitHub Pages `https://kj2whvbzjn-hue.github.io/tsugu/`

## 1. 実測した現行構成

- アプリケーション正本: Public `kj2whvbzjn-hue/tsugu` / `main`
- UI: `static/index.html`, `static/styles.css`, `static/favicon.svg`, `static/app.js.gz.b64`
- Deploy: `.github/workflows/pages.yml`
- E2E: `.github/workflows/e2e.yml`
- 案件データ正本: Private `kj2whvbzjn-hue/tsugu-data` / `main`
- 案件パス: `data/projects/<projectId>.json`
- 保存経路: ブラウザ -> GitHub API
- 認証主体: GitHub `/user` で確認したログイン主体
- Fine-grained PAT: タブのメモリ内のみ。localStorage / Cookie / 案件JSONへ保存しない
- 更新競合: 案件 revision + Git blob SHA を更新直前に再照合
- 1保存: 1 Git commit

## 2. 現行ではない実行経路

以下は `main` の現行実行系に存在せず、Core vNextでも互換経路として復活させない。

- ChatGPT Sites
- Cloudflare D1 / R2
- Worker
- `app/api/*` 旧サーバーAPI
- Next / vinext / Wrangler / Drizzle
- 旧MCPサーバー
- legacy `items` へのフォールバック

## 3. main HEADに対する実行証拠

対象 commit `1f3a551361e691352e35dccfc5b40a5c34aa1d6a` について次を確認した。

- `Deploy TSUGU` run `34552863533`: `completed / success`
- `TSUGU E2E` run `34552882911`: `completed / success`

Deploy workflowは `static/app.js.gz.b64` を base64 decode + gzip展開して `_site/app.js` を生成し、`node --check` 後にGitHub Pagesへ配置する。

## 4. 計画との対応

### 既に完了扱いできる現行化作業

- GitHub Pagesを唯一の配信先として固定
- 旧サーバーランタイム撤去
- D1/R2/Worker/Next系の実行経路撤去
- GitHub API直結保存
- PATの永続保存禁止
- 保存前の revision + blob SHA 競合確認
- Deploy / E2E Actionsの導入

これらを再実装対象にしない。

### Core vNextで未実装または未確認

- Actor / Permission をCore概念として分離した権限モデル
- Auditの不変記録モデル
- RepositoryCommitRef / RepositoryBaseline / DeploymentのCoreモデル
- ArchitectureNode / PathEntry / Binding
- ChangeSet と原子的Apply
- Stage B以降のBox / Rule / Task / Approval / Evidence / Assurance等

現行bundleに同名概念が存在するかは、Stage A着手時に実装ソースとして再確認する。名前の一致だけで実装済みとは判定しない。

## 5. G0-01結論

Core vNextは、GitHub Pages + GitHub API + Private `tsugu-data` という現在の静的アーキテクチャ上へ実装する。旧サーバー方式へ戻さない。

次作業は G0-02 の実装契約固定。その後 A-01 へ進む。
