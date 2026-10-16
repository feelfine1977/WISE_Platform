# 06: Review flow-specific analysis and completion cohorts

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [108](https://github.com/feelfine1977/WISE_Platform/issues/108) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst declares the whole-item period and recorded-completion policy for each purchasing flow, reviews closed/open-recorded/unknown and retained/excluded populations, then saves the selected cohort before comparing timing or rework.

## Current platform foundation and missing analyst behavior

Whole-case selections/comparisons exist. A complete visible workflow must declare each report's inclusion, recorded-completion and unknown policy without imposing completion filtering on the paper's all-item population or calling absence overdue.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Start from original overview or one four flow parent.
2. Choose whole-item/doc period recipe and review inclusion boundary/horizon.
3. Select recorded completion rule per flow, presence versus ordered-ending semantics and whether completion filters analysis at all.
4. Preview retained/excluded/unknown items and original record/document counts at each stage.
5. Inspect an open item, Consignment/two-way exceptions and equal-time ending counterexample; do not call missing clear overdue.
6. Keep a qualified cohort, compare alternatives, Undo, save/export and reopen exact definitions after restart.

## Source evidence and limits

- R01 merged PDF 9–10, 18 (printed 8–9, 17):last activity Clear Invoice or Delete PO Item defines complete 189587; category table 189574 differs by 13; Consignment 100%rework is selection artifact.
- R02 merged PDF 29–31 (printed 4–6):whole-document start filter before 2018, separate whole-item analysis not universal 2018 event trim.
- R03 merged PDF 52, 66 (printed 6, 20):2018 activity selection with 27 Jan 2019 projection; 191971 completed/59299 unfinished is source-specific.
- R04 merged PDF 80–82 (printed 3–5):category-sensitive end/nets, Consignment GR ending, two-way no GR; figure complete 190283 including 699 incompliant versus 189584 compliant model training.
- R05 merged PDF 115–118 (printed 7–10):Packaging top 10 plus RGR/RIR and CI inclusion, 20%reported subset; RGR/RIR slash logic not fully specified.
- R06 merged PDF 137–140:mandatory presence sets explicitly not sequence; before allows both GR/IR orders and conditional Remove Payment Block; two-way/Consignment different activities.
- R07 merged PDF 146–147, 155 (printed 2–3, 11):event projection before classification, invoice-only projection different from whole-source.
- WISE paper PDF 34–36:explicit all 251734 items including open/missing-clearing items; C03 receipt criterion only DF1 / DF2.

**Source-step cross-reference:** R01.02, R01.03, R02.02, R02.03, R03.03, R04.01, R04.02, R04.03, R04.04, R04.06, R05.02, R05.03, R06.01, R06.05, R07.01, R07.04, R08.02, R08.07, R09.06, R09.07, R10.02, R10.05, R10.06, R11.01, R12.03, R12.09, R13.04, R13.05, R14.03, R14.06, R15.01, R15.03, R15.05, R15.09, NB.C22, NB.C23, P01, P14. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: Completion definitions differ:KPMG last Clear/Delete; Meyer Consignment GR and others Clear plus receipt balance; Botti mandatory presence set; paper retains all items. Completion is not identical to compliance, maturity, payment received or business closure.
- PANEL default: Supply an investigation usable all-items/no-completion-exclusion recipe and a finite presence-based recorded completion recipe:non Consignment Clear Invoice presence; Consignment GR presence. This is a panel default, not claimed identical to all reports. Show required milestones per flow and save recipe.
- PANEL: Additional finite source-compatible last-ending and mandatory-set profiles need their own exact definition and tie/admissibility policy; undefined financial net/matching algorithms remain separately gated. Unsupported reported recipes refuse explicitly, but the usable default/paper all-source path must work.
- PANEL: observed_closed means admitted recorded milestones present; open_recorded means known required recorded milestones absent; unknown means the recipe’s required type/order/evidence not admitted. Due-obligation remains separate and unknown without authoritative horizon/terms.
- PANEL: Each inclusion stage has before/after items/records/documents, exact excluded/unknown IDs and reasons; whole item/document filters retain all original histories and do not become event trim.
- UNKNOWN: Unnamed RGR/RIR slash could mean OR or AND; reporting 20%is not an equivalence proof. Do not auto select an operator from the reported count. Historical end-at-tie conventions must be explicit.

## Required core and conditional extensions

The approved bounded working behavior is required. Separately gated report methods are not automatically activated by this ticket.

## Extended user stories

### T06-US01

As a process analyst, I want to retain open items under the named paper profile so that my missing-milestone analysis uses the intended all-source population.

**Preconditions:** The source and four-flow parent are reviewed.

**User actions:**

1. Choose paper all-items.
2. Display completion statuses.
3. Inspect a missing-clearing item.
4. Keep all items without a Norm.

**Expected outcome:** Missing clearing is visible and none of the 251734 items is excluded by completion.

**Acceptance:** T06-AC01, T06-AC07, T06-AC08; the common integration criteria also apply.

### T06-US02

As a purchasing expert, I want flow-specific recorded completion requirements so that Consignment and two-way processes are not penalized for activity messages outside their business scope.

**Preconditions:** ConsignmentK, two-wayL and before itemsM/N are loaded.

**User actions:**

1. Review per-flow milestones.
2. Open K/L histories.
3. Inspect both before orders.
4. Choose presence completion.

**Expected outcome:** K/L and both before orders are closed under the declared presence recipe.

**Acceptance:** T06-AC02, T06-AC03, T06-AC06; the common integration criteria also apply.

### T06-US03

As a process-mining reviewer, I want to compare presence and last-ending completion so that the population change between analyst reports is explained by a definition rather than hidden as preparation.

**Preconditions:** P/Q/R and an explicitly admitted last-ending recipe are available.

**User actions:**

1. Run Clear presence.
2. Run last Clear/Delete.
3. Inspect counterexamples P/Q.
4. Read both definition identities.

**Expected outcome:** Known alternative population changes are explicit and the complete histories remain.

**Acceptance:** T06-AC04, T06-AC05, T06-AC09; the common integration criteria also apply.

### T06-US04

As a data steward, I want unknown category/order and inclusion exclusions drillable so that I can recover bad data without calling it open or late by default.

**Preconditions:** H7 plus unknown-category and equal-time-ending cases are loaded.

**User actions:**

1. Preview whole-document inclusion.
2. Open excluded B.
3. Open unknown completion and tie cases.
4. Review needed bindings/policy.

**Expected outcome:** Exclusion, recorded absence and unavailable completion are separate states with witnesses.

**Acceptance:** T06-AC08, T06-AC09, T06-AC10; the common integration criteria also apply.

### T06-US05

As a process improvement expert, I want completion distinct from compliance and due obligation so that an observed closed item or long open framework order does not trigger an unsupported business conclusion.

**Preconditions:** The reportedR04 figure and observed-open itemS are available.

**User actions:**

1. Read reported complete/compliant subtotals.
2. Inspect S’s missing CI/horizon.
3. Keep cohort and open counterexamples.

**Expected outcome:** Reported 189584 compliant and 190283 complete are distinct; S’s due judgement stays unknown.

**Acceptance:** T06-AC07, T06-AC11, T06-AC12; the common integration criteria also apply.

### T06-US06

As a returning analyst, I want cohort recipes and excluded witnesses durable so that the exact period and completion population underlies tomorrow’s comparisons.

**Preconditions:** A flow cohort and an alternative completion recipe are saved.

**User actions:**

1. Save/export both.
2. Undo and verify parent.
3. Stop old PID/start new PID.
4. Reopen cohorts and excluded witnesses.

**Expected outcome:** Definitions, states and exact memberships remain identical after restart.

**Acceptance:** T06-AC10, T06-AC12, T06-AC13; the common integration criteria also apply.

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

- [ ] **06-B01.** Separate original-data overview, whole-item period inclusion, observed completion and due-obligation judgement; each step shows before/after item/event/document counts and exact exclusion witnesses.
- [ ] **06-B02.** A selected source recipe declares required milestones per flow: Consignment has no expected item invoice/clearing; two-way does not require goods receipt; GR/SES substitution and Clear/Delete endings are reviewed alternatives.
- [ ] **06-B03.** Before-GR allows invoices before or after GR; type assignment and business expectation do not relabel an unusual observed trace into a different flow.
- [ ] **06-B04.** A missing clearing means absence in the observed history. The actual paper explicitly retains all251734 items, including missing-clearing/open histories: no completion exclusion is a reviewed choice. Other source recipes retain their named exclusion/horizon rules.
- [ ] **06-B05.** Inspect retained/excluded/unknown complete histories and scope decisions, undo to source/flow parent and reopen the exact cohort recipe after restart.

### Exact domain and analyst acceptance

- [ ] **T06-AC01.** Given complete pinned BPIC19 and paper all-items profile, when completion is displayed but no exclusion is selected, then analysis retains 251734 items/1595923 records/76349 documents including missing Clear Invoice items; completion statuses do not implicitly filter later paper count criteria.
- [ ] **T06-AC02.** Given Consignment K has PO+GR and no IR/CI, and two-way L has PO+IR+CI and no GR, when the panel presence-completion recipe runs, then K and L are observed_closed. K has no expected item invoice/clearing and L has no expected GR. A DF1/DF2 receipt criterion is scoped separately and does not replace those business requirements.
- [ ] **T06-AC03.** Given before item M has PO→IR→GR→CI and before item N has PO→GR→IR→CI, when flow-specific completion presence is assessed, then both are observed_closed and both remain before_gr. Remove Payment Block only becomes an extra requirement if a declared conditional-source/Norm recipe activates it.
- [ ] **T06-AC04.** Given item P has PO→Clear Invoice→Change Quantity, when Clear presence completion runs, then P is observed_closed; when KPMG last Raw Clear/Delete recipe with admitted order runs, then P is open_recorded. These two statements store separate recipe identities; neither proves P was actually unpaid.
- [ ] **T06-AC05.** Given items Q contains PO→Delete and R contains PO→GR without Clear in a before flow, when KPMG last Clear/Delete runs, then Q is observed_closed and R is open_recorded; when panel Clear presence runs, then both are open_recorded. This difference is visible as definition choice, not reported as an engine error.
- [ ] **T06-AC06.** Given source recipe completion requires PO, GR, Vendor Creates Invoice, IR, CI as an unordered set, when all five records are present but their order differs, then presence-complete=true; process-order compliance is not computed by this set. A service GR/SES substitute only applies when explicitly reviewed and stored.
- [ ] **T06-AC07.** Given before item S has PO+IR but no CI and horizon unknown, when completion is reviewed, then S is open_recorded under Clear presence and due/overdue judgement is unavailable. A selected analysis cohort may retain S; the product cannot label it late from absence alone.
- [ ] **T06-AC08.** Given category unrecognized or conflicting, when a per-flow completion rule is requested, then status=unknown with category reason and complete histories remain available; an independent Clear presence count may still be known. Unknown category does not delete an item from original overview.
- [ ] **T06-AC09.** Given two end records Clear and Change have equal parsed timestamp and there is no source order evidence, when a last-ending recipe is requested, then its causal ending assessment is unknown/unavailable unless an explicit presentation/source-position tie convention is reviewed. Under presence Clear the record is still known present. Tie convention is part of definition, not causal proof.
- [ ] **T06-AC10.** Given H7 from ticket 01, when whole-document start≥2018 inclusion then panel completion is previewed, then first stage retains[C] with 2 records and 1 document, excludes[A, B] with 5 records; C is observed_closed. Original 3 items/7 records/2 documents remain inspectable, and exclusion of B is shown as sibling-document rule, not missing clearing.
- [ ] **T06-AC11.** Given R04 figure on PDF 82, when a reported source profile is linked, then compliant model-training=189584, complete-but-incompliant=699, total complete=190283 are separate reported figures. The product must not name 189584 the complete population or force any figure to raw 251734.
- [ ] **T06-AC12.** Given the analyst keeps observed_closed under one flow, when viewing its cohort, then all source records of retained items remain and open/unknown exclusion witnesses are inspectable; Undo restores the same flow parent with the original closed/open_recorded/unknown statuses and outside inclusion receipts.
- [ ] **T06-AC13.** Given a saved cohort and its alternative ending/presence comparison, when the old PID exits and fresh PID reopens, then period grain/boundaries, flow milestones, completion inclusion choice, tie policy, exact retained/excluded/unknown IDs, raw histories and due limitations match API/browser/export. Changing any field creates a new definition; stale result cannot replace saved membership.

### Public behavior, evidence and durability

- [ ] **06-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **06-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **06-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **06-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **06-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **06-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **06-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** whole-item or whole-document inclusion, clock and declared period boundaries, per-flow completion milestones, end-activity versus presence policy, recorded-open and unknown treatment.

## Required qualification receipts

- Literal fixture is independently authored, with source rows, expected complete-item IDs, row IDs, counts and states; it is not generated by the implementation under test.
- Record candidate source/build digests, original and normalized byte hashes, API and parser versions, definition and frozen-parent identities, actual public HTTP request/response and matching built-browser actions.
- Record keyboard-accessible evidence drill-down, current save/export manifest checksums, first serving process PID and observed exit, distinct fresh process PID, and exact reopened answer. A component reload or service recreation in one PID is insufficient.
- The root engineering E01 – E07 cases apply: typed local refusal, stale-request fencing, immutable revisions, current export, no arbitrary recipe execution, counts/IDs/states exact and finite native numbers within absolute 1e-8.
- Report measured qualification separately from source inspection; retain failed/refused receipts and identify any missing full-source/browser/restart seam.
- Literal P/Q/R/K/L/M/N/S and equal-time Clear/Change cases; H7 whole-document excluded sibling B.
- Usable paper all-source no-exclusion journey and explicit complete-versus compliant reported subtotal receipt; refusal-only source path fails qualification.

Each receipt identifies the candidate source/build, input and definition identities, independently expected versus actual values, public HTTP and built-browser actions, stable export/save references, observed first-process exit and distinct second-process reopening. Component or synthetic tests do not establish full-source capacity; report the elapsed time, peak memory and output/payload sizes for each full-source action that this ticket requires.

## Remaining gates and closure rule

- Actual completion-admissibility clock and last-ending tie policy must be reviewed; presentation sort order cannot claim causality.
- R04 net-cancellation/full financial compliance profiles depend specific 20/matching/value extensions; do not force complex financial verification into finite presence cohort.
- Missing CI is recorded absence; real payment terms, due horizon and obligation are not supplied.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #5, #16, #18, #21, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** #103 — Review a named source and observation policy, #105 — Distinguish the four purchasing flow types, #107 — Inspect source-witnessed activity measures

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
