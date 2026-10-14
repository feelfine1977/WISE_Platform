# 16: Inspect count priorities at document grain

Status: **proposed — owner seam/breakdown review pending; not yet a published ready-for-agent issue**.

## What to build

The analyst groups scored source items by purchasing document, opens each document’s complete item membership and compares priorities scaled by the number of scored PO items within each document, without rescaling item scores.

## Acceptance criteria

- [ ] The multiplier is the number of scored PO items in the document; document means and the arithmetic item reference retain their distinct definitions.
- [ ] Document grouping aggregates original items; it does not create a new item score or require financial exposure.
- [ ] Missing/conflicting headers and overlapping perspectives have explicit support or refusal.
- [ ] Pareto percentages state count-PI or penalty support; zero relative priority is not a compliance result.
- [ ] Exact document-to-item membership and output units survive export/restart.

## Blocked by

proposed 02 — Profile case attributes and business grain, proposed 13 — Rank business groups by actual Method priority

## Existing ownership and qualification

Related existing scope: [#38](https://github.com/feelfine1977/WISE_Platform/issues/38), [#41](https://github.com/feelfine1977/WISE_Platform/issues/41), [#25](https://github.com/feelfine1977/WISE_Platform/issues/25). These are reuse/qualification references, not new blockers merely because their tracker state is open. Preserve existing native edges. Every slice extends schemas, API, browser behavior, independent acceptance and persistence at the existing analyst seam. Exact external Method/engine support is admitted and qualified before a result is presented; unsupported meaning cannot be replaced.
