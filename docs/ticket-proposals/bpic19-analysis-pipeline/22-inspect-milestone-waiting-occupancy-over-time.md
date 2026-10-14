# 22: Inspect milestone waiting occupancy over time

Status: **proposed — owner seam/breakdown review pending; not yet a published ready-for-agent issue**.

## What to build

The analyst reviews waiting intervals and a recorded-time occupancy peak, inspects exact contributing items and saves the result with its horizon/completion policy.

## Acceptance criteria

- [ ] Use one declared interval convention and endpoint operator; half-open/equal/unknown intervals have explicit treatment.
- [ ] Retrospective completed-case occupancy and current operational waiting are separate questions and populations.
- [ ] Clock, horizon, interval/event/case units and calendar bins are visible; missing response never means known completion.
- [ ] Selecting a peak keeps complete original histories and supplies activation/response/cutoff witnesses.
- [ ] Boundary/censoring/tie fixtures and saved temporal selection pass the existing seam.

## Blocked by

proposed 01 — Review a named source and observation policy, proposed 07 — Inspect declared milestone intervals

## Existing ownership and qualification

Related existing scope: [#18](https://github.com/feelfine1977/WISE_Platform/issues/18), [#32](https://github.com/feelfine1977/WISE_Platform/issues/32), [#66](https://github.com/feelfine1977/WISE_Platform/issues/66), [#25](https://github.com/feelfine1977/WISE_Platform/issues/25). These are reuse/qualification references, not new blockers merely because their tracker state is open. Preserve existing native edges. Every slice extends schemas, API, browser behavior, independent acceptance and persistence at the existing analyst seam. Exact external Method/engine support is admitted and qualified before a result is presented; unsupported meaning cannot be replaced.
