# 23: Export and replay a frozen analyst pipeline

Status: **proposed — owner seam/breakdown review pending; not yet a published ready-for-agent issue**.

## What to build

The analyst exports a frozen investigation report and declarative supported-action recipe, then replays/reopens it with the same definitions, evidence and current-run outputs.

## Acceptance criteria

- [ ] Reuse existing immutable investigation/run persistence; do not introduce a second finding store.
- [ ] Exports include definitions, units, grain, support, source/profile/run/calibration and witnesses/limitations.
- [ ] Only admitted actions execute; missing operators/models return an omission or typed refusal, never arbitrary code.
- [ ] A current-run output manifest excludes stale charts; changed meanings/source create new identities.
- [ ] Matching-host browser, actual process stop/restart and exact export/member/answer comparisons prove replay.

## Blocked by

proposed 01 — Review a named source and observation policy

## Existing ownership and qualification

Related existing scope: [#25](https://github.com/feelfine1977/WISE_Platform/issues/25), [#28](https://github.com/feelfine1977/WISE_Platform/issues/28), [#72](https://github.com/feelfine1977/WISE_Platform/issues/72). These are reuse/qualification references, not new blockers merely because their tracker state is open. Preserve existing native edges. Every slice extends schemas, API, browser behavior, independent acceptance and persistence at the existing analyst seam. Exact external Method/engine support is admitted and qualified before a result is presented; unsupported meaning cannot be replaced.
