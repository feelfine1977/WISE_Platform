# 19: Compare FIFO-consuming invoice matches

Status: **proposed — owner seam/breakdown review pending; not yet a published ready-for-agent issue**.

## What to build

The analyst evaluates an alternative FIFO-consuming match on the same retained item evidence and compares its endpoints, unmatched support and durations with the prior policy.

## Acceptance criteria

- [ ] Explicit one-to-one consumption and eligible GR/IR/clearing ordering follow the named source policy.
- [ ] Ordinal and FIFO results have distinct identities and visible event reuse/coverage differences.
- [ ] A declared tie policy retains legitimate equal-time/zero-duration matches; unresolved ambiguity, unmatched supply/demand, cancellations and impossible intervals have distinct local states.
- [ ] The comparison retains raw original witnesses and never promotes inferred pairs to native invoice identity.
- [ ] Independent multi-event examples including a legitimate zero interval, policy-switch/save/reopen prove the difference.

## Blocked by

proposed 18 — Inspect inferred ordinal invoice episodes

## Existing ownership and qualification

Related existing scope: [#38](https://github.com/feelfine1977/WISE_Platform/issues/38), [#25](https://github.com/feelfine1977/WISE_Platform/issues/25). These are reuse/qualification references, not new blockers merely because their tracker state is open. Preserve existing native edges. Every slice extends schemas, API, browser behavior, independent acceptance and persistence at the existing analyst seam. Exact external Method/engine support is admitted and qualified before a result is presented; unsupported meaning cannot be replaced.
