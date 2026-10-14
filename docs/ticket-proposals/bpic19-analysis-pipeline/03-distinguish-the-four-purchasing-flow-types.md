# 03: Distinguish the four purchasing flow types

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [105](https://github.com/feelfine1977/WISE_Platform/issues/105) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

Before mining or scoring, the analyst selects the supplied Item Category as a reviewed process-family dimension, sees the four named groups plus unassigned/conflicting support, opens a type and keeps all original PO-item histories.

## Current platform foundation and missing analyst behavior

Manual Context value filtering is available. It does not supply a reviewed exhaustive four-flow partition, disjoint unresolved states or category/flag cross-check, and generic shared-reference groups can overlap or suppress singleton values.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Review category binding in Data profile.
2. Open the four-flow overview and read category states and independent flag checks.
3. Inspect an unusual order or flag-disagreement item without relabeling it.
4. Open a named flow, keep all complete item histories and inspect mixed documents.
5. Compare its support to its frozen parent; undo to all four types.
6. Save category/reducer/flags/parent recipe and reopen after restart.

## Source evidence and limits

- R01 merged PDF 7, 9, 19 (printed 6, 8, 18): four category meanings, selected completeness counts and before category permits GR first.
- R02 merged PDF 27, 31–33 (printed 2, 6–8): four types, same flags can cover mixed-item purchasing documents.
- R03 merged PDF 49, 55–57, 74 (printed 3, 9–11, 28): prose before permissive order; appendix 74 swaps verbal before/after descriptions; retain discrepancy.
- R04 merged PDF 80–81, 88–90 (printed 3–4, 11–13): supplied four types, before order insignificant and discovered noise filters suppress valid invoice-first cases.
- R05 merged PDF 112–115 (printed 4–7): raw counts after 15182, before 221010, two 1044, Consignment 14498; before invoices may arrive first but common happy path GR first.
- R06 merged PDF 135, 138–140: four flows versus item/document type; completion sets not classification sequence.
- R07 merged PDF 147, 153–155 (printed 3, 9–11):source category meaning, filtered counts differ.
- all source independent scan: raw four counts 15182/221010/1044/14498; 2235 mixed-flow documents; before and Consignment share GR=true/IV=false. R09 PDF 195/197 separately confirmed by data panel: flag-only 236 k before cohort overlaps Consignment.

**Source-step cross-reference:** R01.03, R01.05, R02.04, R03.04, R03.05, R03.06, R04.02, R04.03, R04.04, R04.05, R04.06, R05.01, R05.02, R06.02, R06.04, R06.05, R06.06, R07.02, R07.04, R08.01, R08.02, R08.03, R08.07, R08.09, R09.01, R09.06, R09.07, R10.01, R10.03, R10.05, R10.06, R11.02, R11.03, R11.04, R11.05, R11.06, R12.04, R12.05, R12.07, R12.12, R13.01, R13.02, R13.03, R13.05, R13.06, R13.07, R13.08, R13.11, R15.03, R15.04, R15.05, NB.C02, NB.C03, P03, P04, P05, P08, P09, P14, P16. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: Primary flow is the supplied exact Item Category, not an event-order label. Before-GR means invoices may be entered before receipt, not that they must be.
- PANEL default: Stable IDs after_gr/before_gr/two_way/consignment retain exact source labels. Downstream paper IDs DF1/DF2/two_way/Consignment are explicit adapter metadata, not new case reassignment.
- PANEL: Use all-record invariant category semantics from 02: classified/missing/conflicting/unrecognized. Independently check reviewed flags GR/IV:after(true, true), before(true, false), two(false, false), Consignment(true, false). Category-valid with mismatched or missing flags stays classified with disagreement/unavailable cross-check.
- PANEL: The four item groups are disjoint; unresolved states cover the remaining parent exactly. Document supports overlap. Category classification is usable without clock order, Norm, discovered model or minimum group size.
- PANEL: Flag-only historical analyst views may overlap and must be named as such; they cannot masquerade as the typed four-flow partition.
- UNKNOWN: A conflicting raw category is not repaired by observed order; a source flag disagreement is not evidence which field is correct. Analyst investigation remains available.

## Required core and conditional extensions

The approved bounded working behavior is required. Separately gated report methods are not automatically activated by this ticket.

## Extended user stories

### T03-US01

As a process analyst, I want the four supplied purchasing flows visible before mining or scoring so that I can choose the relevant business process without interpreting a spaghetti model.

**Preconditions:** The Item Category role and exact category labels are reviewed.

**User actions:**

1. Open four-flow overview.
2. Read exact labels and item/event counts.
3. Open each flow, including singleton Consignment.
4. Inspect the current parent.

**Expected outcome:** Four source-grounded groups and separate unresolved support are available without a Norm.

**Acceptance:** T03-AC01, T03-AC02, T03-AC05; the common integration criteria also apply.

### T03-US02

As a purchasing expert, I want a permissive before-GR type kept separate from observed event order so that valid GR first executions are not reassigned or suppressed.

**Preconditions:** ItemX is labeled before withGR first; itemY is labeled after withIR first.

**User actions:**

1. Open each supplied category claim.
2. Read its complete history.
3. Review observed order separately.

**Expected outcome:** Category remains unchanged and an unusual trace is evidence, not a new type.

**Acceptance:** T03-AC04, T03-AC05; the common integration criteria also apply.

### T03-US03

As a data steward, I want category disagreements and flag problems drillable so that I can investigate data quality without destroying otherwise known type membership.

**Preconditions:** F10 includes missing/conflicting/unrecognized categories and independent flag problems.

**User actions:**

1. Open each unresolved state.
2. Open F_1 and B_1 cross-checks.
3. Compare exact raw cells.
4. Return to the four-flow parent.

**Expected outcome:** Category and flag availability are separate, with no dominant-value repair.

**Acceptance:** T03-AC02, T03-AC03, T03-AC07; the common integration criteria also apply.

### T03-US04

As a process-mining analyst, I want typed flow selection separated from overlapping flag views so that Consignment does not leak into a before-GR cohort.

**Preconditions:** Exact category views and separately named historical flag views are available.

**User actions:**

1. Choose flag pair GR=true/IV=false.
2. Inspect Consignment overlap.
3. Choose exact before Item Category.
4. Review the union/disjoin tness receipt.

**Expected outcome:** Historical flag compatibility and exclusive flow segmentation have different definitions/support.

**Acceptance:** T03-AC06, T03-AC08, T03-AC09; the common integration criteria also apply.

### T03-US05

As an analyst investigating one flow, I want Keep and Undo to retain complete items and the same source parent so that focusing does not shorten histories or lose other business processes.

**Preconditions:** The F10 four-flow profile is available.

**User actions:**

1. Keep after_gr.
2. Open D1_1 complete history.
3. Inspect mixed D1 sibling context.
4. Undo and reopen all four groups.

**Expected outcome:** Two D1_1 rows and the original ten-item parent are preserved.

**Acceptance:** T03-AC09, T03-AC10; the common integration criteria also apply.

### T03-US06

As a returning analyst, I want the reviewed flow recipe and unavailable support to survive actual restart so that later measures use the exact same source claims.

**Preconditions:** A flow selection and its reviewed recipe are saved.

**User actions:**

1. Change an unreviewed role and verify actions are disabled.
2. Revert/review and save.
3. Export.
4. Restart in a different PID and reopen.

**Expected outcome:** Saved definitions, partition and cross-check states persist, while stale results cannot be saved as current.

**Acceptance:** T03-AC11, T03-AC12; the common integration criteria also apply.

## Independent literal inputs

These are explicitly synthetic test inputs, separate from published source totals and real-data qualification. Expand any declared label shorthand using the exact binding legend before import.

### F10 — synthetic independent literal input

Clock: UTC where parseable; f05 missing/f08 malformed must not block attribute/flow profile.

All fields below are literal inputs; null is a missing cell. row_id names the original source row witness, not an inferred invoice ID. Input masks: case_id index1, activity index2, timestamp index3, sequence=null; context indices0 and4–12. Semantic roles use this synthetic table namespace: Item Category4, Item Type5, Goods Receipt6, GR-Based IV7, Purchasing Document8, Item9, original Source Case10, Resource11, Amount12. These are not the native22/prepared29 BPIC19 namespaces. Native category9/prepared category16 require their own explicit role mapping.

| row_id | case_id | activity | timestamp | item_category | item_type | goods_receipt | gr_based_iv | purchasing_document | item | source_case | resource | net_worth |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f01 | D1_1 | Record Invoice Receipt | 2018-01-02T00:00:00Z | 3-way match, invoice after GR | Service | true | true | D1 | 1 | D1_1 | user_1 | 100 |
| f02 | D1_1 | Record Goods Receipt | 2018-01-03T00:00:00Z | 3-way match, invoice after GR | Service | true | true | D1 | 1 | D1_1 | user_1 | 100 |
| f03 | D1_2 | Create Purchase Order Item | 2018-01-01T00:00:00Z | 3-way match, invoice before GR | Standard | true | false | D1 | 2 | D1_2 | user_1 | 100 |
| f04 | D1_2 | Record Goods Receipt | 2018-01-04T00:00:00Z | 3-way match, invoice before GR | Standard | true | false | D1 | 2 | D1_2 | user_1 | 100 |
| f05 | D2_1 | Record Goods Receipt | null | Consignment | Consignment | true | false | D2 | 1 | D2_1 | batch_1 | 0 |
| f06 | D3_1 | Record Invoice Receipt | 2018-01-01T00:00:00Z | 2-way match | Limit | false | false | D3 | 1 | D3_1 | user_1 | 100 |
| f07 | M_1 | Create Purchase Order Item | 2018-01-01T00:00:00Z | null | Standard | true | false | M | 1 | M_1 | user_1 | 100 |
| f08 | C_1 | Record Invoice Receipt | not-a-time | 3-way match, invoice after GR | Standard | true | true | C | 1 | C_1 | user_1 | 100 |
| f09 | C_1 | Record Goods Receipt | 2018-01-03T00:00:00Z | 3-way match, invoice before GR | Standard | true | false | C | 1 | C_1 | user_1 | 100 |
| f10 | U_1 | Create Purchase Order Item | 2018-01-01T00:00:00Z | Unknown | Standard | true | false | U | 1 | U_1 | user_1 | 100 |
| f11 | F_1 | Create Purchase Order Item | 2018-01-01T00:00:00Z | 3-way match, invoice before GR | Standard | true | true | F | 1 | F_1 | user_1 | 100 |
| f12 | B_1 | Create Purchase Order Item | 2018-01-01T00:00:00Z | 3-way match, invoice before GR | Standard | null | false | B | 1 | B_1 | user_1 | 100 |
| f13 | G_1 | Create Purchase Order Item | 2018-01-01T00:00:00Z | 3-way match, invoice before GR | Standard | true | false | G | 1 | G_1 | user_1 | 100 |
| f14 | G_1 | Change Quantity | 2018-01-02T00:00:00Z | 3-way match, invoice before GR | Standard | true | false | Other | 1 | G_1 | user_1 | 100 |

Expected original supports: {"items": 10, "known_documents": 8, "records": 14, "unavailable_item_document_relation": 1}.
null is missing; literal Unknown is supplied nonmissing text. Category classified only when all records carry one identical nonmissing known category. Document relation requires all-record invariant field.
Every selected PO item retains all its original rows. Parent counts are computed before any ordered model or Norm. Each boolean is parsed under an explicit synthetic boolean convention; literal Unknown is never silently turned into null.

### F11 — synthetic independent literal input

Clock: AsF10.

All fields below are literal inputs; null is a missing cell. row_id names the original source row witness, not an inferred invoice ID. Input masks: case_id index1, activity index2, timestamp index3, sequence=null; context indices0 and4–12. Semantic roles use this synthetic table namespace: Item Category4, Item Type5, Goods Receipt6, GR-Based IV7, Purchasing Document8, Item9, original Source Case10, Resource11, Amount12. These are not the native22/prepared29 BPIC19 namespaces. Native category9/prepared category16 require their own explicit role mapping.

| row_id | case_id | activity | timestamp | item_category | item_type | goods_receipt | gr_based_iv | purchasing_document | item | source_case | resource | net_worth |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f01 | D1_1 | Record Invoice Receipt | 2018-01-02T00:00:00Z | 3-way match, invoice after GR | Service | true | true | D1 | 1 | D1_1 | user_1 | 100 |
| f02 | D1_1 | Record Goods Receipt | 2018-01-03T00:00:00Z | 3-way match, invoice after GR | Service | true | true | D1 | 1 | D1_1 | user_1 | 100 |
| f03 | D1_2 | Create Purchase Order Item | 2018-01-01T00:00:00Z | 3-way match, invoice before GR | Standard | true | false | D1 | 2 | D1_2 | user_1 | 100 |
| f04 | D1_2 | Record Goods Receipt | 2018-01-04T00:00:00Z | 3-way match, invoice before GR | Standard | true | false | D1 | 2 | D1_2 | user_1 | 100 |
| f05 | D2_1 | Record Goods Receipt | null | Consignment | Consignment | true | false | D2 | 1 | D2_1 | batch_1 | 0 |
| f06 | D3_1 | Record Invoice Receipt | 2018-01-01T00:00:00Z | 2-way match | Limit | false | false | D3 | 1 | D3_1 | user_1 | 100 |
| f07 | M_1 | Create Purchase Order Item | 2018-01-01T00:00:00Z | null | Standard | true | false | M | 1 | M_1 | user_1 | 100 |
| f08 | C_1 | Record Invoice Receipt | not-a-time | 3-way match, invoice after GR | Standard | true | true | C | 1 | C_1 | user_1 | 100 |
| f09 | C_1 | Record Goods Receipt | 2018-01-03T00:00:00Z | 3-way match, invoice before GR | Standard | true | false | C | 1 | C_1 | user_1 | 100 |
| f10 | U_1 | Create Purchase Order Item | 2018-01-01T00:00:00Z | Unknown | Standard | true | false | U | 1 | U_1 | user_1 | 100 |
| f11 | F_1 | Create Purchase Order Item | 2018-01-01T00:00:00Z | 3-way match, invoice before GR | Standard | true | true | F | 1 | F_1 | user_1 | 100 |
| f12 | B_1 | Create Purchase Order Item | 2018-01-01T00:00:00Z | 3-way match, invoice before GR | Standard | null | false | B | 1 | B_1 | user_1 | 100 |
| f13 | G_1 | Create Purchase Order Item | 2018-01-01T00:00:00Z | 3-way match, invoice before GR | Standard | true | false | G | 1 | G_1 | user_1 | 100 |
| f14 | G_1 | Change Quantity | 2018-01-02T00:00:00Z | 3-way match, invoice before GR | Standard | true | false | Other | 1 | G_1 | user_1 | 100 |
| f15 | D4_1 | Record Invoice Receipt | 2018-01-01T00:00:00Z | 3-way match, invoice after GR | Standard | true | true | D4 | 1 | D4_1 | user_1 | 100 |

Expected original supports: {"items": 11, "known_documents": 9, "records": 15, "unavailable_item_document_relation": 1}.
F10 plus f15; complete rows are included to avoid reliance on another ticket body
Every selected PO item retains all its original rows. Parent counts are computed before any ordered model or Norm. Each boolean is parsed under an explicit synthetic boolean convention; literal Unknown is never silently turned into null.

## Acceptance criteria

### Approved baseline retained

- [ ] **03-B01.** BPIC19 maps the four exact category labels to after-GR, before-GR, two-way and Consignment without inferring type from observed activity order.
- [ ] **03-B02.** Use the invariant case reducer: classified/missing/conflicting/unrecognized state and separate valid/unavailable/flag-disagreement cross-check support. Preserve supplied claims and all witness rows; two different records cannot satisfy a compound case predicate by accident.
- [ ] **03-B03.** The four exclusive item groups plus unresolved membership reconcile as a disjoint union of the frozen parent under the reviewed recipe. Show item/event support and overlapping document support; classification requires no chronology, discovered model or Norm.
- [ ] **03-B04.** Exact full source reconciles15182/221010/1044/14498 items (251734 total);2235 mixed-flow documents remain visible and prevent a single category per document.
- [ ] **03-B05.** From the four-flow overview, open/keep one group, inspect complete evidence, undo to the same parent, save and reopen its reviewed definition and exact membership.

### Exact domain and analyst acceptance

- [ ] **T03-AC01.** Given the complete pinned source, when the reviewed category partition runs, then after_gr=15182, before_gr=221010, two_way=1044, consignment=14498 items, sum 251734; corresponding original record supports 319233/1234708/5898/36084 sum 1595923, and mixed-flow documents=2235. Counts are exact and independent of display ordering.
- [ ] **T03-AC02.** Given F10, when the four-flow partition runs, then after_gr=[D1_1], before_gr=[B_1, D1_2, F_1, G_1], two_way=[D3_1], consignment=[D2_1]; missing=[M_1], conflicting=[C_1], unrecognized=[U_1]. The seven sets are pairwise disjoint and union all ten frozen parent items.
- [ ] **T03-AC03.** Given F10’s reviewed flags, when cross-check support is shown, then valid items=[D1_1, D1_2, D2_1, D3_1, G_1], disagreement=[F_1], unavailable=[B_1, C_1, M_1, U_1]; the three lists are disjoint and union all ten. F_1 stays before_gr despite GR=true/IV=true and B_1 stays before_gr despite a missing GR flag.
- [ ] **T03-AC04.** Given before item X has GR before IR and after item Y has IR before GR, when categories are reviewed, then X remains before_gr and Y remains after_gr. Their observed order may be discussed or assessed separately; it never changes type membership.
- [ ] **T03-AC05.** Given D2_1 is a singleton Consignment item with an invalid or missing timestamp, when the four-flow overview opens, then Consignment support is 1 item/1 record and the case is keepable; neither bad chronology nor a generic minimum 2 threshold erases it. No Norm/model is required.
- [ ] **T03-AC06.** Given before and Consignment both have GR=true/IV=false, when a flag-only historical view is requested, then it is explicitly overlapping and includes both; when typed before is requested, then Consignment IDs are absent. On full source GR=true AND IV=false support 235508 equals 221010 before +14498 Consignment; IV=false alone 236552 additionally includes 1044 two-way. Each predicate has its own stored recipe and denominator.
- [ ] **T03-AC07.** Given literal Unknown, blank category and changing after/before records, when the analyst opens unresolved support, then the three source states remain separate and original rows appear verbatim; unknown values are not silently assigned to the largest flow.
- [ ] **T03-AC08.** Given item K has record 1 GR=true/IV=false and record 2 GR=false/IV=true, when a compound same-record GR=true AND IV=true predicate runs, then K is not matched, because no row satisfies both; an invariant case-level conjunction is unavailable/conflicting. OR and AND semantics, record versus case quantification, and unknown handling are stored explicitly.
- [ ] **T03-AC09.** Given D1_1 after and D1_2 before share document D1, when both flow document supports are shown, then D1 appears in each support, once in mixed-flow documents, and the sum of document supports is not labeled a disjoint total. Item partition totals remain disjoint.
- [ ] **T03-AC10.** Given after_gr is selected in F10, when Keep is invoked, then retained=[D1_1] with both original records, not only category/receipt-matching records; opening its evidence preserves IR Jan 2 and GR Jan 3, and Undo restores all ten items/fourteen records under the same parent identity.
- [ ] **T03-AC11.** Given the analyst changes category binding, label mapping or flag policy after a result, when an old response or error arrives late, then old Keep/Inspect/Save actions cannot publish it under the new definition; the new query needs review and changes identity.
- [ ] **T03-AC12.** Given the F10 partition and selected after flow are saved/exported, when the serving PID exits and a distinct PID reopens the workspace, then all seven memberships, cross-check lists, both D1 siblings, exact recipe and complete D1_1 history reappear unchanged. The current expected revision controls save/export.

### Public behavior, evidence and durability

- [ ] **03-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **03-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **03-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **03-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **03-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **03-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **03-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** category role, four exact label bindings, all-record invariance policy, flag cross-check policy, unresolved treatment, parent membership.

## Required qualification receipts

- Literal fixture is independently authored, with source rows, expected complete-item IDs, row IDs, counts and states; it is not generated by the implementation under test.
- Record candidate source/build digests, original and normalized byte hashes, API and parser versions, definition and frozen-parent identities, actual public HTTP request/response and matching built-browser actions.
- Record keyboard-accessible evidence drill-down, current save/export manifest checksums, first serving process PID and observed exit, distinct fresh process PID, and exact reopened answer. A component reload or service recreation in one PID is insufficient.
- The root engineering E01 – E07 cases apply: typed local refusal, stale-request fencing, immutable revisions, current export, no arbitrary recipe execution, counts/IDs/states exact and finite native numbers within absolute 1e-8.
- Report measured qualification separately from source inspection; retain failed/refused receipts and identify any missing full-source/browser/restart seam.
- Independent F10 expected flow/unresolved/cross-check sets, mixed D1 and same-record compound K fixture.
- full source category/record counts and 2235 mixed docs through candidate public HTTP/browser; raw scan agreement alone does not establish platform behavior.

Each receipt identifies the candidate source/build, input and definition identities, independently expected versus actual values, public HTTP and built-browser actions, stable export/save references, observed first-process exit and distinct second-process reopening. Component or synthetic tests do not establish full-source capacity; report the elapsed time, peak memory and output/payload sizes for each full-source action that this ticket requires.

## Remaining gates and closure rule

- Root workflow must persist category role, exact label map, all-record reducer, flag cross-check and parent recipe, not merely selected IDs.
- Generic overlapping Groups filters are a foundation; qualification must exercise a typed four-flow overview and complete-item Keep/Undo.
- Do not introduce a prerequisite Norm, chronology admission, discovery or broad new predicate-engine issue for 03.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #14, #38, #41, #64, #72. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** #104 — Profile case attributes and business grain

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
