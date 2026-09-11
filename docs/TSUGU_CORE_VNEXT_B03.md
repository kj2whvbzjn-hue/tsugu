# TSUGU Core vNext B-03 Task / Approval / Waiver / Decision / Issue Contract

## Scope

B-03 adds the governance lifecycle required by the Stage B MVP without changing the existing Stage A/B-01/B-02 persistence path. The implementation is `static/core-task-governance.js` with focused domain tests in `tests/core-task-governance.test.cjs`.

It introduces first-class typed entities for:

- `Task`
- `Approval`
- `Waiver`
- `Decision`
- `Issue`

The layer does not use legacy `items`, does not introduce server runtime state, and does not treat mutable display names or paths as identity.

## Fixed target references

Every governance record that acts on another entity uses a target reference containing:

- entity type
- stable entity ID
- version
- SHA-256 content hash

Tasks additionally persist a hash of that complete target reference. Approvals and Waivers fix the same target reference together with the acting actor. Any later mutation of the target version/hash invalidates validation rather than silently moving the governance record to new content.

## Task lifecycle

Task start and completion gates are separate lists. The same criterion ID is rejected if it appears in both lists. Required gate results are fail-closed: only explicit `PASS` allows the transition; `FAIL`, `UNKNOWN`, and missing results block it.

Lifecycle transitions are explicit:

- `PLANNED -> ACTIVE` by `START`
- `ACTIVE -> ON_HOLD` by `HOLD`
- `ACTIVE|ON_HOLD -> INTERRUPTED` by `INTERRUPT`
- `ON_HOLD|INTERRUPTED -> ACTIVE` by `RESUME`
- `ACTIVE -> COMPLETED` by `COMPLETE`
- any non-terminal state -> `CANCELLED` by `CANCEL`

`COMPLETED` and `CANCELLED` are terminal. Every transition appends a sequence-numbered history event carrying actor, timestamp, reason and the fixed target hash. Hold, interrupt, resume and cancel therefore remain visible instead of being overwritten by the current status.

## Approval

An Approval is a one-shot `APPROVED` or `REJECTED` decision. Its exact target reference, actor, timestamp, rationale and decision are content-hashed. Validation rejects post-hoc modification of any hashed field.

## Waiver

B-03 enables explicit Waiver records rather than relaxing B-02 Rule comparison. A Waiver is applicable only when all of the following match exactly:

- RuleDefinition ID
- RuleDefinition version
- RuleDefinition content hash
- target type / ID / version / content hash
- active status
- non-expired time window

Revocation is explicit and records actor, timestamp and reason. A revoked or expired Waiver is never applicable. The underlying Rule remains unchanged.

## Decision

A Decision begins as `DRAFT`. Finalization selects one declared option and fixes the selected value, rationale, actor and timestamp with a content hash. A FINAL Decision cannot be finalized again or silently changed.

## Issue

Issue state changes are append-only history:

- `OPEN -> RESOLVED`
- `RESOLVED -> OPEN` for regression/reopen
- `RESOLVED -> CLOSED`

Earlier resolution attempts remain in history when an Issue regresses and is fixed again. A CLOSED Issue is terminal in B-03.

## Persistence boundary

B-03 is intentionally a domain layer in this increment. Persistent writes remain required to pass through the existing atomic aggregate / ChangeSet boundary when B-03 is connected to saved project state. No direct GitHub write path is introduced by this module.
