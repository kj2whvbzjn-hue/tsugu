# TSUGU Core vNext B-01 — Box Registry / Schema / ChildConstraint / Box Binding

## 1. 目的

B-01 は Stage A の `ProjectArchitecture` を破壊的に変更せず、Stage B の Box Registry を上位レイヤとして追加する。既存 A データは `migrateFromStageA()` で取り込み、Node Binding の stable ID / revision / effective period を維持する。

Stage B の永続変更は `BoxChangeSet` と GitHub Contents API の blob-SHA CAS を経由する。`core-box.js` の直接永続書込み境界は `BOX_CHANGESET_REQUIRED` で閉じる。

## 2. ドメイン

### SchemaDefinition

- `(id, version)` を固定参照単位とする。
- field type は B-01 で `STRING / NUMBER / BOOLEAN / ENUM` を扱う。
- Draft を Published にする際、定義内容の SHA-256 `contentHash` を固定する。
- Published 後の内容改変は `PUBLISHED_CONTENT_HASH_MISMATCH` として fail-closed にする。

### BoxDefinition

- `(id, version)` を固定参照単位とする。
- Published Box は Published Schema の明示 version を参照する。
- version 更新は `createNextBoxDefinitionVersion()` により新しい Draft version を作成して明示的に Publish する。旧 version は書換えない。
- Deprecated / Retired は定義本体を書換えず `DefinitionLifecycleEvent` の別履歴として保持する。
- Deprecated / Retired 後も既存 `BoxInstance` の固定参照は有効だが、新規 Instance 作成には利用できない。

### BoxInstance

- `boxDefinitionId + boxDefinitionVersion` を固定する。
- `architectureNodeId` を持ち、Box 所属 Node は Instance から導出する。
- config は参照 Schema の required / type / enum / unknown-field 契約を検証する。

### ChildConstraint

- 特定 `BoxDefinition(id, version)` に所属する。
- child の `SchemaDefinition(id, version)` と `minCount / maxCount` を固定する。
- 子 Box の Schema 型が許可されない場合は `CHILD_TYPE_NOT_ALLOWED`。
- 複数制約はすべて成立する必要があり、個数違反は `CHILD_CONSTRAINT_VIOLATION`。
- Published Box の ChildConstraint は後付け変更できない。Constraint も Box content hash の対象に含める。

### ArchitectureBindingV2

- 1行につき1 `PathEntry` と1設計対象を持つ。
- `targetType=NODE` は `architectureNodeId` のみ、`targetType=BOX_INSTANCE` は `boxInstanceId` のみを許可する。
- Node / Box の同時指定は `BINDING_TARGET_EXCLUSIVITY`。
- relation / target existence / duplicate effective period / Project scope を検証する。
- Box Binding の設計 Node は `BoxInstance.architectureNodeId` から導出する。

## 3. A → B migration

`migrateFromStageA()` は A-03 schema をそのまま `architecture` として保持し、A の `ArchitectureBinding` を `ArchitectureBindingV2(targetType=NODE)` へ写像する。

この migration では既存 Binding の ID、revision、relation、active/inactive revision を変更しない。Stage A の保存形式そのものは変更しないため、A 系の既存 UI / E2E を継続できる。

## 4. System Definition Seed

`seedSystemDefinitions()` は `SYSTEM_SEED_VERSION=B01-1` の Published Schema / Box / ChildConstraint を stable ID で投入する。

- 同一内容での再実行は no-op で revision を増やさない。
- 同一 stable ID/version に異なる内容が存在する場合は `SYSTEM_SEED_COLLISION` で停止する。
- Seed 定義も通常の Published 定義と同じ content-hash 検査を受ける。

## 5. BoxChangeSet

`core-box-changeset.js` は B-01 専用 aggregate を提供する。

- `baseRevision` と Git blob `baseBlobSha` を固定する。
- payload hash と candidate hash を SHA-256 で固定する。
- validation 後、Apply 時に candidate を再構築して同一性を確認する。
- create 系 operation は stable ID を payload 内で必須化する。
- Publish / lifecycle operation の時刻も payload 内に固定し、Validation と Apply の実行時刻差で candidate hash が変化しないようにする。
- GitHub Contents API の CAS 409/422 は `STALE_CHANGESET` に正規化し、部分確定しない。
- AppliedBoxChangeSet / AuditEvent / OutboxRecord を同一 aggregate 書込みで確定する。
- 同一 idempotency key + payload は replay、別 payload での key 再利用は拒否する。

## 6. B-01で扱わないもの

RuleDefinition / Effective Rules / TestDefinition / RequirementSnapshot / Waiver / Approval / Evidence / ActualChange は B-02 以降。B-01 ではこれらが存在する前提で処理を通さない。

## 7. 検証

`tests/core-box.test.cjs` で以下を検証する。

- A→B Node Binding migration
- Seed 冪等性と collision
- Published Schema / Box content hash 固定
- 明示 Box version 更新と旧 version 保持
- Schema 型不一致 / unknown field 拒否
- ChildConstraint 型 / min / max
- Deprecated / Retired 既存参照保持
- Node / Box 排他的 Binding と Box 所属 Node 導出
- ChangeSet 必須境界
- deterministic ChangeSet payload
- GitHub Contents API CAS / idempotency / `STALE_CHANGESET`

`.github/workflows/box-e2e.yml` は Pages 配信後に一時 GitHub branch を作り、A migration、B Seed、Published v1、BoxInstance、Box Binding、Seed 再実行、明示 v2、旧 v1 参照保持、型不一致と排他違反の拒否を実リポジトリ readback で確認する。