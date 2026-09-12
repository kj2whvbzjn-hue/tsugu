# TSUGU プロジェクト運用・参照基準書

現行契約：TSUGU Workflow / `tsugu-workflow/1`。2026-09-12。

ユーザーのハードカット指示により、旧items/Coreと工程管理v6への依存を撤去する。過去のCore vNext A〜D資料・検査記録は履歴であり、現行実装契約ではない。新しい作業構造は `docs/WORKFLOW_HARD_CUT.md` を参照する。

アプリケーションは `kj2whvbzjn-hue/tsugu`、配信は既存GitHub Pages。Private `tsugu-data` の `data/workflow-projects/` を新しい案件正本とする。旧 `data/projects/` の読込・書込・自動変換は行わない。DB、bucket、既存案件の削除は本変更に含まない。

## 正本と操作

- Projectは作業目的・順序・仕様・判断・確認・承認の正本。実装ファイルとcommitは実装の正本。
- 同じProjectのidentityはinstance UUIDで検証する。保存は選択したbranchへ行い、blob SHAとrevisionの両方を照合する。
- PATはタブ内メモリにだけ保持する。GitHub `/user` とPrivate repositoryの書込権限を確認する。
- Workflow、Lifecycle、Task状態、承認を混同しない。Workflow互換状態は工程から導出する。
- 必須FAILを消さず、後続の同対象再Checkで解決する。
- 実施済みCheck・成果物版は変更しない。履歴は追記する。
- 内容変更で承認が失効した場合は再承認する。
- source更新Taskの完了にはTask CheckとApplied実装記録を必要とする。
- 旧業務データを推測で新形式へ変換しない。

## 認証の限界

現行はサーバーを持たないGitHub Pagesアプリである。アプリ内の承認操作はGitHubで確認した利用者名と対象hashを記録し、AI返却からの承認を拒否する。ただし、data repositoryへ直接書ける主体によるJSON改変までサーバーで防ぐ構成ではない。権限境界はGitHub repositoryにあり、対象SHAとGit履歴で監査する。認証方式／hosting方式の変更は別の作業として決める。
