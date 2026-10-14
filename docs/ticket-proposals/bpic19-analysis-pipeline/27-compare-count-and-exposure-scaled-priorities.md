# 27: Compare count and exposure-scaled priorities

Status: **proposed — owner seam/breakdown review pending; not yet a published ready-for-agent issue**.

## What to build

The analyst selects a reviewed exposure calibration and compares count/exposure multipliers for item groups and documents while holding item score means and the arithmetic reference fixed.

## Acceptance criteria

- [ ] Creation-value and historical max-absolute95th-percentile proxies are distinct named calibrations with finite raw-value witnesses.
- [ ] Multiplier, unit, calibration population, missing/negative policy and tied value bands are explicit; subset selection never recalibrates.
- [ ] Exposure changes the multiplier only; an exposure-weighted score reference is a different profile.
- [ ] Document totals avoid repeated-event double counting; absent valid exposure is unavailable rather than zero.
- [ ] Independent count/exposure examples, exact member/value receipts and export/restart show the changed priority without changing input scores.

## Blocked by

proposed 09 — Review source-witnessed item-value definitions, proposed 16 — Inspect count priorities at document grain

## Existing ownership and qualification

Related existing scope: [#14](https://github.com/feelfine1977/WISE_Platform/issues/14), [#38](https://github.com/feelfine1977/WISE_Platform/issues/38), [#41](https://github.com/feelfine1977/WISE_Platform/issues/41), [#25](https://github.com/feelfine1977/WISE_Platform/issues/25). These are reuse/qualification references, not new blockers merely because their tracker state is open. Preserve existing native edges. Every slice extends schemas, API, browser behavior, independent acceptance and persistence at the existing analyst seam. Exact external Method/engine support is admitted and qualified before a result is presented; unsupported meaning cannot be replaced.
