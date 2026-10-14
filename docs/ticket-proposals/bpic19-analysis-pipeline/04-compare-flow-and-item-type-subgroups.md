# 04: Compare flow and item-type subgroups

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [106](https://github.com/feelfine1977/WISE_Platform/issues/106) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst subdivides a selected purchasing flow by Item Type, compares two named subgroups under the same frozen parent and opens a separate investigation with retained criteria and complete evidence.

## Current platform foundation and missing analyst behavior

Named target/comparator selections exist. They need reviewed flow-by-Item-Type predicates, categorical support at item/event/document grains, overlap-aware document membership and durable return to the same parent.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Open the four-flow overview under a frozen item parent.
2. Open the bounded Item Type cross-tab; read known zero and unknown/conflicting subtype support.
3. Choose target after×Standard and comparator after×Service with both predicates visible.
4. Compare item support separately from original record/document support; use declared measure eligibility if count/value/time is added.
5. Open either side and shared document siblings; return to parent or Undo.
6. Save/export both subgroup recipes plus comparison roles and reopen after actual restart.

## Source evidence and limits

- R02 merged PDF 32–33 (printed 7–8): document/type/item attributes and several values per higher-level document.
- R03 merged PDF 55–57, 64 (printed 9–11, 18): BI comparison across four matching categories; Service/SES and goods receipt analysis.
- R04 merged PDF 84–88 (printed 7–11):6 Item Types/3 Document Types; Item Type WSS5.2% and Document Type 12.5% are source-specific discovery evidence, not rules for current table; selected subgroup counts Table 2.
- R05 merged PDF 111–115, 129 (printed 3–7, 21): top 10 Packaging vendors and four flows use different nested scopes.
- R06 merged PDF 135 (Figure 4): Item Category×Item Type×Document Type dimensional distinction, Service only after in this cohort.
- R07 merged PDF 147–149, 153–156 (printed 3–5, 9–12): PR/NPR, Document Type and four flows; amount/time comparisons require named units and eligibility.
- Independent raw scan panel/start-flow-data-scan.json: exact six Item Types and nine nonzero flow×type cells; 2235 mixed-flow documents.

**Source-step cross-reference:** R03.04, R03.05, R03.06, R04.04, R04.05, R04.06, R05.01, R06.04, R06.06, R07.02, R08.01, R09.01, R10.03, R11.02, R11.03, R11.04, R11.05, R11.06, R12.04, R12.05, R12.07, R13.07, R13.08, R14.05, R15.04. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: Item Category identifies four process families; Item Type has Standard, Service, Subcontracting, Third-party, Limit, Consignment; Document Type is a separate 3-valued field. Service is not a fifth flow.
- PANEL default: One exact bounded categorical count cross-tab; use all-record invariant subtype reducers and explicit missing/conflicting/unrecognized rows. Preserve source spellings and canonical display metadata separately.
- PANEL: Target and comparator are independently defined under the same frozen parent; do not implement comparator as every item not in target. If an existing comparison needs complement, create a declared comparison parent equal to target∪comparator and preserve its relation to the larger flow parent and outside support.
- PANEL: Count cells need no Norm or amount/time computation. Adding measure comparisons activates their existing admitted definitions and eligible denominators; unknown values are never filled zero.
- PANEL: whole item selection preserves all original records. Distinct document supports overlap if siblings fall on different sides; record shares, item shares and document supports are labeled independently.
- UNKNOWN: Report correlations about Service/logistics or framework duration do not establish causes or current expected timings. Automatic clustering, SRM discovery and WSS optimization remain finite extensions, not 04 closure conditions.

## Required core and conditional extensions

The approved bounded working behavior is required. Separately gated report methods are not automatically activated by this ticket.

## Extended user stories

### T04-US01

As a purchasing analyst, I want to compare Standard and Service within one purchasing flow so that subgroup differences are interpreted under the same business process.

**Preconditions:** The four-flow profile and Item Type binding are reviewed.

**User actions:**

1. Open after flow.
2. Read its Item Type cells.
3. Choose Standard target and Service comparator.
4. Inspect both predicates and item/record supports.

**Expected outcome:** The two sides have explicit shared parent and distinct source-grounded definitions.

**Acceptance:** T04-AC01, T04-AC02, T04-AC03; the common integration criteria also apply.

### T04-US02

As a process improvement expert, I want the denominator and overlap of each comparison visible so that a high record share is not mistaken for a high purchasing-document share.

**Preconditions:** Two sibling items have different types and different original record counts.

**User actions:**

1. Open both cells.
2. Switch labeled item/record/document supports.
3. Open shared document X.

**Expected outcome:** Shares 1/2 items and 1/3 records coexist with one document union and one overlap.

**Acceptance:** T04-AC05, T04-AC07; the common integration criteria also apply.

### T04-US03

As a data analyst, I want unknown or changing subtypes kept outside known comparison sides so that bad-data recovery does not redefine Service as all non Standard items.

**Preconditions:** F11, an unknown-subtype itemZ and a changing-subtype item are loaded.

**User actions:**

1. Inspect unknown/conflicting support.
2. Open raw cells.
3. Choose Standard versus Service.
4. Check Z outside both.

**Expected outcome:** Unknown support remains separate and the two side predicates remain exact.

**Acceptance:** T04-AC04, T04-AC06; the common integration criteria also apply.

### T04-US04

As an exploratory analyst, I want an independently useful count comparison before timing, value or scoring definitions so that I can understand the population without creating a Norm.

**Preconditions:** A count comparison includes an item with missing amount or invalid timestamp.

**User actions:**

1. View count cross-tab.
2. Open measure eligibility when available.
3. Leave scoring unconfigured.

**Expected outcome:** Known item/record counts remain usable with local amount/time unavailability.

**Acceptance:** T04-AC02, T04-AC07; the common integration criteria also apply.

### T04-US05

As a process-mining reviewer, I want to open either comparison side and return to its original parent so that selecting one branch never loses its comparator or other flows.

**Preconditions:** The F11 target/comparator definition is displayed.

**User actions:**

1. Keep Standard target.
2. Inspect D4_1.
3. Return and keep Service comparator.
4. Inspect D1_1.
5. Undo to the four flow parent.

**Expected outcome:** Both complete histories, roles and original parent remain reviewable.

**Acceptance:** T04-AC03, T04-AC08; the common integration criteria also apply.

### T04-US06

As a returning analyst, I want both subgroup recipes and comparison roles persisted so that I can reopen the same question after an actual restart or swap the question in a separate revision.

**Preconditions:** The F11 comparisonA is reviewed.

**User actions:**

1. Save/export A.
2. Swap roles and save B.
3. Restart in a distinct PID.
4. Reopen A and B.

**Expected outcome:** A and B retain exact memberships, meaning and denominator receipts.

**Acceptance:** T04-AC09, T04-AC10; the common integration criteria also apply.

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

- [ ] **04-B01.** Item Category, six-valued Item Type and three-valued Document Type remain distinct dimensions; Service is not a fifth purchasing flow.
- [ ] **04-B02.** Expose a flow-by-item-type count table with exact item/event/document supports, unknown/conflicting cells and declared overlap.
- [ ] **04-B03.** Both target/comparator definitions persist the flow and subtype predicates, normalization and parent identity, not only an ID list. Standard/Service comparison preserves explicitly named count/value/time denominators.
- [ ] **04-B04.** Both comparison sides and all four parent flow memberships remain inspectable; entering a branch preserves the parent and supports return/undo.
- [ ] **04-B05.** Use one bounded categorical cross-tab and existing comparison/save routes; literal mixed-document/subtype examples and current-source subgroup counts pass API/browser/restart.

### Exact domain and analyst acceptance

- [ ] **T04-AC01.** Given the pinned full source, when the cross-tab uses reviewed Item Category and Item Type, then nonzero item cells are after {Standard 8344, Service 5838, Subcontracting 616, Third-party 384}, before {Standard 211842, Subcontracting 4062, Third-party 5106}, two_way {Limit 1044}, consignment {Consignment 14498}. Their row totals equal 15182/221010/1044/14498 and all cells total 251734.
- [ ] **T04-AC02.** Given the same full source, when column totals are shown, then Standard 220186, Service 5838, Subcontracting 4678, Third-party 5490, Limit 1044, Consignment 14498; Document Type has its own 3-valued role and never appears as an Item Type or flow. The cross-tab displays known empty cells as 0, with unknown support separate.
- [ ] **T04-AC03.** Given F11 is F10 plus D4_1 after×Standard with one record, when the after parent is opened, then after parent IDs=[D1_1, D4_1], 2 items/3 records/2 documents; target after×Standard=[D4_1], 1 item/1 record/1 document and comparator after×Service=[D1_1], 1 item/2 records/1 document. Both recipes store category AND subtype predicates plus frozen parent.
- [ ] **T04-AC04.** Given target after×Standard and comparator after×Service plus an extra after item Z with unknown subtype, when comparison runs, then Z is outside both known sides with its unavailable subtype state visible. It does not enter Service as the target complement; any adapter comparison parent is explicitly{ D4_1, D1_1 }, with Z retained as outside support in original after parent.
- [ ] **T04-AC05.** Given two after items in the same document X, one Standard with 1 record and one Service with 2 records, when cell supports display, then each side has 1 document, union distinct documents=1, overlapping documents=1, target record share=1/3 and target item share=1/2. The sum 2 document supports is not labeled 2 distinct documents.
- [ ] **T04-AC06.** Given a Standard item whose subtype changes Standard→Service or includes blank, when invariant subtype cells are computed, then it appears in conflicting/incomplete support and neither known cell, with all conflicting rows available. all missing is missing and literal unrecognized type retains its own raw value.
- [ ] **T04-AC07.** Given a comparison count table and one item with missing amount or bad time, when the analyst opens count comparison without scoring, then its item/record support remains known; amount/time comparisons separately declare eligible N and unavailable N and cannot show missing as 0.
- [ ] **T04-AC08.** Given the analyst opens target D4_1 or comparator D1_1 and uses Keep, when evidence opens, then the complete one-record or two-record history and target/comparator role are retained. Return/Undo restores the original frozen parent and four flow memberships without changing either comparison recipe.
- [ ] **T04-AC09.** Given saved comparison A, when target/comparator swap, subtype binding/reducer/normalization changes or frozen parent changes, then a new analytical comparison identity B is created and A remains reopenable; changing table sort order preserves identity. Unsupported value/time/discovery extensions refuse explicitly without blocking count table.
- [ ] **T04-AC10.** Given the F11 comparison is executed through public HTTP and built browser, saved and exported, when the old PID exits and distinct fresh PID reopens it, then both predicate recipes, exact IDs, roles, item/record/document denominators, outside/unavailable support and source evidence match. IDs alone without recipes are not a passing saved comparison.

### Public behavior, evidence and durability

- [ ] **04-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **04-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **04-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **04-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **04-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **04-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **04-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** flow definition, item-type role and reducer, target and comparator predicates, frozen shared parent, document-overlap treatment.

## Required qualification receipts

- Literal fixture is independently authored, with source rows, expected complete-item IDs, row IDs, counts and states; it is not generated by the implementation under test.
- Record candidate source/build digests, original and normalized byte hashes, API and parser versions, definition and frozen-parent identities, actual public HTTP request/response and matching built-browser actions.
- Record keyboard-accessible evidence drill-down, current save/export manifest checksums, first serving process PID and observed exit, distinct fresh process PID, and exact reopened answer. A component reload or service recreation in one PID is insufficient.
- The root engineering E01 – E07 cases apply: typed local refusal, stale-request fencing, immutable revisions, current export, no arbitrary recipe execution, counts/IDs/states exact and finite native numbers within absolute 1e-8.
- Report measured qualification separately from source inspection; retain failed/refused receipts and identify any missing full-source/browser/restart seam.
- Record full source nine cells and six column totals independent of application output.
- Record F11 both recipes and shared-document fixture, unknown Z outside both plus actual build/browser save/restart.

Each receipt identifies the candidate source/build, input and definition identities, independently expected versus actual values, public HTTP and built-browser actions, stable export/save references, observed first-process exit and distinct second-process reopening. Component or synthetic tests do not establish full-source capacity; report the elapsed time, peak memory and output/payload sizes for each full-source action that this ticket requires.

## Remaining gates and closure rule

- Existing comparison component may require a target-complement pair; qualify explicit union adapter rather than silently using larger flow complement.
- Raw full source subtotal exactness must use current prepared representation; report filtered subgroups are evidence, not expected current counts.
- Default Item Type reducer must encode known+missing conflicts consistently with 02.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #14, #38, #41, #64, #72. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** #105 — Distinguish the four purchasing flow types

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
