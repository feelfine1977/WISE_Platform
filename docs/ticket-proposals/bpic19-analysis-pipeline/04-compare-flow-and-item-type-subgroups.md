# 04: Compare flow and item-type subgroups

Status: **proposed — owner seam/breakdown review pending; not yet a published ready-for-agent issue**.

## What to build

The analyst subdivides a selected purchasing flow by Item Type, compares two named subgroups under the same frozen parent and opens a separate investigation with retained criteria and complete evidence.

## Acceptance criteria

- [ ] Item Category, six-valued Item Type and three-valued Document Type remain distinct dimensions; Service is not a fifth purchasing flow.
- [ ] Expose a flow-by-item-type count table with exact item/event/document supports, unknown/conflicting cells and declared overlap.
- [ ] Both target/comparator definitions persist the flow and subtype predicates, normalization and parent identity, not only an ID list. Standard/Service comparison preserves explicitly named count/value/time denominators.
- [ ] Both comparison sides and all four parent flow memberships remain inspectable; entering a branch preserves the parent and supports return/undo.
- [ ] Use one bounded categorical cross-tab and existing comparison/save routes; literal mixed-document/subtype examples and current-source subgroup counts pass API/browser/restart.

## Blocked by

proposed 03 — Distinguish the four purchasing flow types

## Existing ownership and qualification

Related existing scope: [#14](https://github.com/feelfine1977/WISE_Platform/issues/14), [#38](https://github.com/feelfine1977/WISE_Platform/issues/38), [#41](https://github.com/feelfine1977/WISE_Platform/issues/41), [#64](https://github.com/feelfine1977/WISE_Platform/issues/64), [#72](https://github.com/feelfine1977/WISE_Platform/issues/72). These are reuse/qualification references, not new blockers merely because their tracker state is open. Preserve existing native edges. Every slice extends schemas, API, browser behavior, independent acceptance and persistence at the existing analyst seam. Exact external Method/engine support is admitted and qualified before a result is presented; unsupported meaning cannot be replaced.
