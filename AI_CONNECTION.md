# TSUGU Workflow：AI引継ぎ

案件の「引継ぎ」から完全案件JSON、project ID、instance ID、base revision、Git blob SHA、次の実行可能Taskを取得する。Taskにない作業を推測して実施しない。コードの現在HEADは別途確認する。

返却形式：

```json
{
  "project_id": "案件のworkspace.id",
  "instance_id": "案件のauthority.instance_id",
  "base_revision": 1,
  "summary": "今回の結果",
  "upserts": [
    {"collection": "tasks", "record": {"id": "既存または新しいID", "title": "完全Recordの例（省略）"}}
  ]
}
```

上記Recordは説明用で、実入力には全必須fieldが必要。Taskのapprovalは返却に含めず、既存承認を保持する。新TaskはTodo。既存Taskの状態変更、Workflow／Lifecycle／Authority変更、承認、Waived、実施済みCheck変更は拒否する。正式仕様の承認は人が専用操作で行う。

配列をID単位で統合した最終候補全体を検証し、差分previewを見てから反映する。反映とGit保存は別操作。省略したRecordを削除しない。未知collectionや二重ID、古いrevision、別instanceを拒否する。

新しいCheckには実施コマンド・結果・証拠・実施時刻を記載する。Failedのstatusを変えず、新しいPassedのresolves_check_idsで解決関係を持つ。異なる対象／GateのPASSは流用しない。

旧schemaVersion 1、旧items/core、旧返却upsertsは対応しない。
