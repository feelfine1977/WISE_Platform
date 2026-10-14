# 09: Review source-witnessed item-value definitions

Status: **proposed — owner seam/breakdown review pending; not yet a published ready-for-agent issue**.

## What to build

The analyst compares a PO-creation-event value with the historical notebook’s maximum-absolute event-value proxy, inspects contributing amounts and saves the two explicitly different item measures.

## Acceptance criteria

- [ ] V1 admits only creation-event value and max-absolute proxy, each with event selector, currency/unit and conflicting-value policy; event-sum/netted recipes remain separate extensions.
- [ ] Zero/negative/missing/non-finite values and duplicate candidates have explicit policies and source witnesses.
- [ ] The historical max-absolute95th-percentile calibration has a frozen population; selection never recalibrates.
- [ ] Tied value bands, missing treatment and the distinction between value/proxy/exposure are explicit; no spend or cost claim is inferred.
- [ ] Definition, calibration and source-value evidence survive export/save/reopen.

## Blocked by

None (can start immediately on existing source/preparation foundations)

## Existing ownership and qualification

Related existing scope: [#14](https://github.com/feelfine1977/WISE_Platform/issues/14), [#41](https://github.com/feelfine1977/WISE_Platform/issues/41), [#25](https://github.com/feelfine1977/WISE_Platform/issues/25). These are reuse/qualification references, not new blockers merely because their tracker state is open. Preserve existing native edges. Every slice extends schemas, API, browser behavior, independent acceptance and persistence at the existing analyst seam. Exact external Method/engine support is admitted and qualified before a result is presented; unsupported meaning cannot be replaced.
