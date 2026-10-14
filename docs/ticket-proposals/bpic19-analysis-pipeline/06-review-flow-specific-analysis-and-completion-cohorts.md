# 06: Review flow-specific analysis and completion cohorts

Status: **proposed — owner seam/breakdown review pending; not yet a published ready-for-agent issue**.

## What to build

The analyst declares the whole-item period and recorded-completion policy for each purchasing flow, reviews closed/open-recorded/unknown and retained/excluded populations, then saves the selected cohort before comparing timing or rework.

## Acceptance criteria

- [ ] Separate original-data overview, whole-item period inclusion, observed completion and due-obligation judgement; each step shows before/after item/event/document counts and exact exclusion witnesses.
- [ ] A selected source recipe declares required milestones per flow: Consignment has no expected item invoice/clearing; two-way does not require goods receipt; GR/SES substitution and Clear/Delete endings are reviewed alternatives.
- [ ] Before-GR allows invoices before or after GR; type assignment and business expectation do not relabel an unusual observed trace into a different flow.
- [ ] A missing clearing means absence in the observed history. The actual paper explicitly retains all251734 items, including missing-clearing/open histories: no completion exclusion is a reviewed choice. Other source recipes retain their named exclusion/horizon rules.
- [ ] Inspect retained/excluded/unknown complete histories and scope decisions, undo to source/flow parent and reopen the exact cohort recipe after restart.

## Blocked by

proposed 01 — Review a named source and observation policy, proposed 03 — Distinguish the four purchasing flow types, proposed 05 — Inspect source-witnessed activity measures

## Existing ownership and qualification

Related existing scope: [#5](https://github.com/feelfine1977/WISE_Platform/issues/5), [#16](https://github.com/feelfine1977/WISE_Platform/issues/16), [#18](https://github.com/feelfine1977/WISE_Platform/issues/18), [#21](https://github.com/feelfine1977/WISE_Platform/issues/21), [#25](https://github.com/feelfine1977/WISE_Platform/issues/25). These are reuse/qualification references, not new blockers merely because their tracker state is open. Preserve existing native edges. Every slice extends schemas, API, browser behavior, independent acceptance and persistence at the existing analyst seam. Exact external Method/engine support is admitted and qualified before a result is presented; unsupported meaning cannot be replaced.
