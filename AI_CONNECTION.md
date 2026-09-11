# 継ぐ / TSUGU：AI連携

TSUGUは単一のアプリケーションとして運用します。現在の正規AI連携は **AI引き継ぎテキスト + 返却JSON** です。

## 実装・参照ツール

AIの実装作業では、GitHub接続ツールで `kj2whvbzjn-hue/tsugu` の `main` とcommit/diff/Actionsを確認し、ローカル実行環境で構文検査・テスト・生成を行い、Web/Browserで公式仕様と公開TSUGUを実測します。ChatGPT Sites、旧MCP、旧サーバーAPIは参照・実行経路にしません。

共通参照は `docs/TSUGU_PROJECT_REFERENCE.md`、Core vNextは `docs/TSUGU_CORE_VNEXT_PLAN.md` と `docs/TSUGU_CORE_VNEXT_WBS.md` を使用します。

## AIへ渡す

案件画面の「AI引き継ぎ」から、案件ID、baseRevision、目的、方針、Git基準、項目を含むテキストを生成します。AIは作業前にGitHub `main` の現在HEADを別途確認し、引き継ぎ中の古いSHAを現在値として流用しません。

## TSUGUへ戻す

```json
{
  "projectId": "TSUGU UUID",
  "baseRevision": 1,
  "summary": "変更概要",
  "changes": {},
  "upserts": []
}
```

TSUGUは `projectId` と `baseRevision` を現在案件と照合し、許可された変更だけを編集内容へ反映します。反映だけでは保存されず、利用者が「GitHubへ保存」を実行した時点で新revisionとして確定します。

削除、工程移行、実装承認、完了承認はAI返却から直接実行しません。

旧MCPルートや提案Inboxは撤去対象であり、フォールバックとして残しません。将来AI接続方式を拡張する場合も、統一TSUGUの同じ案件モデル、競合検査、承認規則へ直接統合します。
