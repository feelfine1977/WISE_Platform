# 03: Distinguish the four purchasing flow types

Status: **proposed — owner seam/breakdown review pending; not yet a published ready-for-agent issue**.

## What to build

Before mining or scoring, the analyst selects the supplied Item Category as a reviewed process-family dimension, sees the four named groups plus unassigned/conflicting support, opens a type and keeps all original PO-item histories.

## Acceptance criteria

- [ ] BPIC19 maps the four exact category labels to after-GR, before-GR, two-way and Consignment without inferring type from observed activity order.
- [ ] Use the invariant case reducer: classified/missing/conflicting/unrecognized state and separate valid/unavailable/flag-disagreement cross-check support. Preserve supplied claims and all witness rows; two different records cannot satisfy a compound case predicate by accident.
- [ ] The four exclusive item groups plus unresolved membership reconcile as a disjoint union of the frozen parent under the reviewed recipe. Show item/event support and overlapping document support; classification requires no chronology, discovered model or Norm.
- [ ] Exact full source reconciles15182/221010/1044/14498 items (251734 total);2235 mixed-flow documents remain visible and prevent a single category per document.
- [ ] From the four-flow overview, open/keep one group, inspect complete evidence, undo to the same parent, save and reopen its reviewed definition and exact membership.

## Blocked by

proposed 02 — Profile case attributes and business grain

## Existing ownership and qualification

Related existing scope: [#14](https://github.com/feelfine1977/WISE_Platform/issues/14), [#38](https://github.com/feelfine1977/WISE_Platform/issues/38), [#41](https://github.com/feelfine1977/WISE_Platform/issues/41), [#64](https://github.com/feelfine1977/WISE_Platform/issues/64), [#72](https://github.com/feelfine1977/WISE_Platform/issues/72). These are reuse/qualification references, not new blockers merely because their tracker state is open. Preserve existing native edges. Every slice extends schemas, API, browser behavior, independent acceptance and persistence at the existing analyst seam. Exact external Method/engine support is admitted and qualified before a result is presented; unsupported meaning cannot be replaced.
