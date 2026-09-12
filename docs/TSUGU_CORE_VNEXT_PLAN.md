# TSUGU 現行実装計画

2026-09-12の指示で、従来Core vNextへの継ぎ足しを終了し、工程管理をハードカットで置換する。

現行契約は `WORKFLOW_HARD_CUT.md`。旧A/B/C/Dの実装資料・change-recordsは過去の記録として保持し、新ランタイムは参照しない。

1. 解析済みのProject・Architecture・WorkBox・Task構造を新domainへ実装する。
2. 議論・決定・仕様・仕様候補・System Contract・Impact・確認・実装・成果物を関連付ける。
3. 工程とLifecycleを分離し、Gate、Task承認、完了承認、再検査を同一検証関数へ集約する。
4. GitHub認証・選択branch・SHA/revision競合防止を実装する。
5. 新日本語UIへ接続し、旧items/Core/UI/runtime/test実行依存を撤去する。
6. domain・Git fixture・モバイル／デスクトップUI検証後にレビュー・配置する。

実機の完了判定には、GitHub Actionsの対象commitと公開画面・Private保存の実測が必要。
