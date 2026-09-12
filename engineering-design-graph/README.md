# Engineering Design Graph — standalone MVP

`engineering_design_graph_implementation_package.zip` の設計を、TSUGU既存UIと分離して検証できるブラウザMVPとして実装したものです。

## 実装済み

- Structured Artifact repository (Requirement / Specification / Domain / System / Module / Interface / Task など)
- Relationを一級Entityとして管理、relation registryでfrom/to型を検証
- `depends_on` cycle detection
- Requirement traceability coverage
- Deterministic validation rules
- Implementation readiness gate (`READY`, `READY_WITH_WARNINGS`, `NOT_READY`)
- downstream change impact traversal
- 3-pane UI: Navigation / Main / Inspector
- Artifact編集、Relation追加、ChangeSet相当のworking changes
- JSON import/export
- EC Order Creation sample project
- localStorage persistence

## 起動

静的HTTPサーバーから `engineering-design-graph/index.html` を開いてください。

例:

```bash
python3 -m http.server 8080
# http://localhost:8080/engineering-design-graph/
```

## テスト

```bash
node --test tests/engineering-design-graph.test.mjs
```

## スコープ

このブランチでは設計パッケージのMVP概念を既存TSUGUから隔離して実装しています。PostgreSQL/NestJS/Queue/OIDC/AI Providerは、ブラウザMVP検証後に置き換える境界として残しています。正本DB化の際も `core.mjs` のArtifact/Relation/Validation/Readiness semanticsを維持する前提です。
