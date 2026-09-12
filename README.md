# 継ぐ / TSUGU

目的・仕様・作業・確認結果・人の承認を、案件単位でつなぐ工程管理です。

2026-09-12のハードカット指示に基づき、旧items、旧Core、v4〜v6画面とその実行依存を撤去しました。新モデルは `tsugu-workflow/1`。互換読込、自動migration、旧画面へのfallbackはありません。

## 現行構成

- アプリケーション：`kj2whvbzjn-hue/tsugu` / `main`
- 配信：`https://kj2whvbzjn-hue.github.io/tsugu/`（GitHub Pages）
- 案件保存：Private `kj2whvbzjn-hue/tsugu-data` / `main`
- 新案件パス：`data/workflow-projects/<workspace.id>.json`
- `static/workflow-domain.mjs`：型、参照、依存、工程、承認、JSON統合
- `static/workflow-git.mjs`：GitHub認証、SHA＋revision競合検知、保存
- `static/workflow-app.mjs` / `workflow.css`：日本語UI

旧案件の `data/projects/` は新ランタイムから読み書きしません。この変更は旧データの削除を実行しません。

## 業務モデル

作業分類ツリー → WorkBox → Task。工程は検討 → 実装準備 → 実装 → 確認 → 完了。Lifecycle、Task状態、Task承認は独立しています。

議論・決定・正式仕様・仕様候補、System要素・契約・接続・変更影響、実装記録・SHA-256付き成果物参照、確認結果・再検査・履歴を管理します。Taskの完了にはそのTaskのCompletion Checkが必要です。実装TaskにはAppliedの実装記録と固定commit SHAも必要です。

必須FAILはGeneralを含め開始／完了Gateを止めます。過去FAILは変更せず、同じ対象・GateのPassed/Waived Checkから解決します。

## 検証

```sh
node --test tests/workflow.test.mjs
bash .github/scripts/build-pages-site.sh _site
npm install --no-save --package-lock=false playwright@1.55.0
npx playwright install chromium
python3 -m http.server 4173 --directory _site
# 別ターミナル
node tests/workflow-ui.e2e.cjs
```

UIテストは状態を保持するGitHub API fixtureを使用します。Privateの本番データへテストを書き込みません。認証・Git保存の実接続確認や、公開後の実機確認と区別してください。

参照：`docs/WORKFLOW_HARD_CUT.md`、`docs/TSUGU_PROJECT_REFERENCE.md`、`AI_CONNECTION.md`、`DEPLOYMENT.md`。
