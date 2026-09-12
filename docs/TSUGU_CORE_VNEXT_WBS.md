# TSUGU Workflow ハードカット作業一覧

| ID | 作業 | 検証 |
| --- | --- | --- |
| WF-01 | 現行mainと資料の境界確認 | main SHA、GitHub Pages、Private Git保存を固定 |
| WF-02 | 新domainと完全Record統合 | 型・参照・循環・承認・Task完了・失敗履歴テスト |
| WF-03 | Git保存 | UTF-8、選択branch、SHA/revision競合、削除済み正本拒否 |
| WF-04 | 新UI | 作成から完了承認、保存、reloadまでのモバイル通し検証 |
| WF-05 | ハードカット | 旧runtime dependencyが成果物とstaticに存在しない |
| WF-06 | 共有と配置 | commit、PR、CI、Deployment、実機の状態を区別して記録 |
