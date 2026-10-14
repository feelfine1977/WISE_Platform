# 02: Profile case attributes and business grain

Status: **proposed — owner seam/breakdown review pending; not yet a published ready-for-agent issue**.

## What to build

The analyst reviews all selected source attributes by PO item, distinguishes static case values from event-varying values, verifies document/item identity and opens missing or conflicting source records before choosing process groups.

## Acceptance criteria

- [ ] Show unique values, PO-item/event/document supports and missing/conflicting support with declared grain; avoid event-frequency shares presented as item shares.
- [ ] Review Item Category, Item Type, Goods Receipt, GR-Based Inv. Verif., document/item, company/spend/vendor and resource/value roles; preserve supplied names/values separately from semantic labels.
- [ ] A chronology-independent invariant case reducer checks every raw record; inconsistent attributes cannot silently use first or first nonempty.
- [ ] Purchasing documents may contain several flow types; document membership is overlapping and never automatically a disjoint flow partition.
- [ ] Independent mixed-header, changing-category, missing-flag and invalid-time fixtures plus actual source-profile counts persist through API/browser/save/restart.

## Blocked by

None (can start immediately on existing source/preparation foundations)

## Existing ownership and qualification

Related existing scope: [#5](https://github.com/feelfine1977/WISE_Platform/issues/5), [#14](https://github.com/feelfine1977/WISE_Platform/issues/14), [#38](https://github.com/feelfine1977/WISE_Platform/issues/38), [#41](https://github.com/feelfine1977/WISE_Platform/issues/41), [#64](https://github.com/feelfine1977/WISE_Platform/issues/64), [#99](https://github.com/feelfine1977/WISE_Platform/issues/99). These are reuse/qualification references, not new blockers merely because their tracker state is open. Preserve existing native edges. Every slice extends schemas, API, browser behavior, independent acceptance and persistence at the existing analyst seam. Exact external Method/engine support is admitted and qualified before a result is presented; unsupported meaning cannot be replaced.
