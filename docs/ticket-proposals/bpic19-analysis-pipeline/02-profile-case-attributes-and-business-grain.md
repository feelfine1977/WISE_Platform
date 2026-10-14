# 02: Profile case attributes and business grain

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [104](https://github.com/feelfine1977/WISE_Platform/issues/104) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst reviews all selected source attributes by PO item, distinguishes static case values from event-varying values, verifies document/item identity and opens missing or conflicting source records before choosing process groups.

## Current platform foundation and missing analyst behavior

Opening context and shared-reference groups exist, but first-record or any-record context is not an all-raw-record invariant case-attribute/grain proof. The analyst needs an inspectable item/document profile with changing/missing/conflicting witness rows.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Open the source’s attribute/grain profile without making a model or Norm.
2. Review each original header, prepared-column role and raw value semantics, especially category/type/flags/document/item/company/spend/vendor/resource/value.
3. Read item invariant/missing/conflicting counts separately from raw event frequencies and distinct document support.
4. Open first different or missing rows from any item/document conflict.
5. Review document membership and mixed-flow siblings; choose an invariant item attribute only after its support is clear.
6. Save the role/reducer/parent definition and reopen the same profile and evidence after restart.

## Source evidence and limits

- R01 merged PDF 5–7 (printed 4–6): PO document/item/event hierarchy and source field roles.
- R02 merged PDF 31–33 (printed 6–8): document-item-event relationships and max-distinct-value table; text says category name varies within item but table says max 1, a source contradiction.
- R03 merged PDF 50–52 (printed 4–6):22 native columns, identifier/resource roles, numeric preparation.
- R04 merged PDF 84–86 (printed 7–9):189584 selected compliant items, 6 Item Types/3 Document Types and split candidates.
- R06 merged PDF 133–135: cumulative amounts are event-associated; 98% source cases one unique value, 4632 multi-value; three distinct process dimensions.
- R07 merged PDF 147–148 (printed 3–4): Item Category, Document Type, PR/NPR spend classification are separate dimensions.
- Independent all-raw source scan panel/start-flow-data-scan.json and panel/start-flow-source-profile.json: prepared role 16 is Item Category; full-source 251734/1595923/76349, item-level invariant case fields and 2235 mixed-flow documents.

**Source-step cross-reference:** R01.01, R02.01, R03.01, R03.04, R03.06, R04.01, R04.07, R05.01, R06.01, R06.02, R06.03, R06.04, R07.02, R08.01, R09.01, R10.01, R10.02, R11.01, R12.01, R12.02, R12.04, R13.01, R13.02, R13.08, R13.09, R14.01, R14.02, R14.05, R14.10, R14.12, R15.02, NB.C02, P01, P02, P03. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: Source row is an event; case is a PO item; Purchasing Document is a higher business grain. Event-varying resource/value fields cannot become case attributes through implicit first-row selection.
- PANEL default: For reviewed static roles, require one nonmissing raw value on every record in an item; all missing→missing, any missing alongside known or multiple distinct values→conflicting/incomplete state with reasons. Do not use timestamp sorting.
- PANEL: Preserve null/blank and literal Unknown separately. Display unrecognized values verbatim; transformation-to Unknown is a separate source profile, not raw truth.
- PANEL: Document membership is admitted only when the item’s document role is invariant; documents shared by several item subgroups overlap. Declare unknown/conflicting document relation instead of silently deriving it by string splitting.
- PANEL: Profile every selected input column. Default bounded UI shows deterministic examples/page limits with exact total supports, never drops low-frequency values or reports example count as unique total.
- UNKNOWN: Report-filtered max-distinct table and prose conflict at R02; company counts 3 versus 4 differ by cohort. Measure this input afresh rather than enforcing a published invariant as a validation rule.

## Required core and conditional extensions

The approved bounded working behavior is required. Separately gated report methods are not automatically activated by this ticket.

## Extended user stories

### T02-US01

As a data analyst, I want to see every input field at its true grain so that I can distinguish a static PO-item attribute from an event-varying amount or actor.

**Preconditions:** F10 and explicit source-role mappings are loaded.

**User actions:**

1. Open attribute profile.
2. Select category, resource and amount.
3. Read item/event/document units.
4. Open a varying item.

**Expected outcome:** Raw field variability and static-role eligibility are shown separately.

**Acceptance:** T02-AC02, T02-AC03, T02-AC08; the common integration criteria also apply.

### T02-US02

As a process-mining expert, I want all raw records to participate in static-attribute review so that an invalid date or late category change cannot disappear through sorting or first-row reduction.

**Preconditions:** C_1 and J have changing or partly missing category cells.

**User actions:**

1. Open their profile states.
2. Inspect each conflicting source row.
3. Compare to an invariant item.
4. Return to the original parent.

**Expected outcome:** C_1 and J are unavailable as invariant classifications and have exact witnesses.

**Acceptance:** T02-AC02, T02-AC04; the common integration criteria also apply.

### T02-US03

As a purchasing analyst, I want to inspect sibling items in a mixed document so that I do not assign one business process to the entire purchasing document.

**Preconditions:** DocumentD1 has classified after/before sibling items.

**User actions:**

1. Open D1 from the profile.
2. Inspect both complete items.
3. Compare raw document variation with reviewed flow memberships.

**Expected outcome:** One document may have multiple flow supports; C_1’s changing value is not a classified second flow.

**Acceptance:** T02-AC05, T02-AC06, T02-AC07; the common integration criteria also apply.

### T02-US04

As a data steward, I want source and normalized header suggestions to be explicit so that I can correct a bad mapping without losing exact original identifiers.

**Preconditions:** Native22 and prepared29 representations, an ambiguous header and distinct identifiers001/1 are available.

**User actions:**

1. Review the category suggestion.
2. Choose the explicit column role.
3. Inspect lineage and exact IDs.
4. Create a corrected profile revision.

**Expected outcome:** Mapped fields and identifiers are explicit, auditable and not guessed from column position alone.

**Acceptance:** T02-AC01, T02-AC09; the common integration criteria also apply.

### T02-US05

As an analyst comparing a small subgroup, I want exact support and rare values to remain visible so that a bounded display does not change my parent population.

**Preconditions:** A two-item parent and a singleton attribute value exist.

**User actions:**

1. Keep the two-item parent.
2. Refresh profile.
3. Page through bounded value examples.
4. Open the singleton evidence.

**Expected outcome:** Totals are 2 items/4 records/1 document and no support disappears due to UI limits.

**Acceptance:** T02-AC10, T02-AC11; the common integration criteria also apply.

### T02-US06

As a reviewer, I want the saved attribute/grain definition to reopen after restart so that the same conflict and source-column evidence supports later flow selection.

**Preconditions:** The role/reducer/parent revision is saved.

**User actions:**

1. Export it.
2. Stop the serving PID.
3. Start a different PID.
4. Reopen G_1 and category profile.

**Expected outcome:** Exact source names, mappings, states and witness rows persist.

**Acceptance:** T02-AC12; the common integration criteria also apply.

## Independent literal inputs

These are explicitly synthetic test inputs, separate from published source totals and real-data qualification. Expand any declared label shorthand using the exact binding legend before import.

### H7 — synthetic independent literal input

Clock: Explicit UTC instants; no machine timezone inference.

All fields below are literal inputs; null is a missing cell. row_id names the original source row witness, not an inferred invoice ID. Input masks: case_id index1, activity index2, timestamp index3, sequence=null; context indices0 and4–12. Semantic roles use this synthetic table namespace: Item Category4, Item Type5, Goods Receipt6, GR-Based IV7, Purchasing Document8, Item9, original Source Case10, Resource11, Amount12. These are not the native22/prepared29 BPIC19 namespaces. Native category9/prepared category16 require their own explicit role mapping.

| row_id | case_id | activity | timestamp | item_category | item_type | goods_receipt | gr_based_iv | purchasing_document | item | source_case | resource | net_worth |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h1 | A | Vendor creates invoice | 1948-01-01T00:00:00Z | 3-way match, invoice before GR | Standard | true | false | D | 1 | A | user_1 | 100 |
| h2 | A | Create Purchase Order Item | 2018-01-01T00:00:00Z | 3-way match, invoice before GR | Standard | true | false | D | 1 | A | user_1 | 100 |
| h3 | A | Clear Invoice | 2020-01-02T00:00:00Z | 3-way match, invoice before GR | Standard | true | false | D | 1 | A | user_1 | 100 |
| h4 | B | Create Purchase Order Item | 2018-01-02T00:00:00Z | 3-way match, invoice before GR | Standard | true | false | D | 2 | B | user_1 | 100 |
| h5 | B | Record Goods Receipt | 2018-01-03T00:00:00Z | 3-way match, invoice before GR | Standard | true | false | D | 2 | B | user_1 | 100 |
| h6 | C | Create Purchase Order Item | 2018-01-02T00:00:00Z | 3-way match, invoice before GR | Standard | true | false | E | 1 | C | user_1 | 100 |
| h7 | C | Clear Invoice | 2018-01-04T00:00:00Z | 3-way match, invoice before GR | Standard | true | false | E | 1 | C | user_1 | 100 |

Expected original supports: {"documents": 2, "items": 3, "records": 7}.
Earliest parsed raw event at item/document grain >=2018-01-01T00:00:00Z; event projection2018-01-01 inclusive to2019-01-01 exclusive; unknown-required clock yields unavailable.
Every selected PO item retains all its original rows. Parent counts are computed before any ordered model or Norm. Each boolean is parsed under an explicit synthetic boolean convention; literal Unknown is never silently turned into null.

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

- [ ] **02-B01.** Show unique values, PO-item/event/document supports and missing/conflicting support with declared grain; avoid event-frequency shares presented as item shares.
- [ ] **02-B02.** Review Item Category, Item Type, Goods Receipt, GR-Based Inv. Verif., document/item, company/spend/vendor and resource/value roles; preserve supplied names/values separately from semantic labels.
- [ ] **02-B03.** A chronology-independent invariant case reducer checks every raw record; inconsistent attributes cannot silently use first or first nonempty.
- [ ] **02-B04.** Purchasing documents may contain several flow types; document membership is overlapping and never automatically a disjoint flow partition.
- [ ] **02-B05.** Independent mixed-header, changing-category, missing-flag and invalid-time fixtures plus actual source-profile counts persist through API/browser/save/restart.

### Exact domain and analyst acceptance

- [ ] **T02-AC01.** Given native 22-column and prepared 29-column representations of the same source, when category is bound in each namespace, then native category index 9 and prepared category index 16 identify the same source field through explicit lineage. Auto-suggestions are reviewable; duplicate or ambiguous normalized headers require an explicit choice and never resolve by first matching label.
- [ ] **T02-AC02.** Given F10’s ten items/fourteen records, including C_1 with category after then before, M_1 all missing and U_1 literal Unknown, when all-record category profiling runs, then item invariant=8, missing=1, conflicting=1; literal Unknown is one invariant raw value, not missing. Invalid timestamps on C_1 and D2_1 do not change those counts.
- [ ] **T02-AC03.** Given F10 raw categories, when event and any-value item supports are shown, then before has 7 records across5 items and after has 3 records across2 items; C_1 contributes to both raw value supports but one conflicting item state. These raw supports differ from disjoint classified-flow counts before=4/after=1.
- [ ] **T02-AC04.** Given item J has two category records after/blank, when the invariant reducer runs, then J is conflicting/incomplete, with the missing row and known row visible; a first-nonempty reducer would return after and must not be used under this definition. An all blank item is missing.
- [ ] **T02-AC05.** Given F10 has G_1 document cells G and Other, when the document relation is profiled, then known document_count=8, unavailable_item_document_count=1 and G_1 is conflicting with both row IDs. No new document is invented from G_1’s case identifier.
- [ ] **T02-AC06.** Given reviewed document D1 has sibling D1_1 after and D1_2 before, when category is summarized at document grain, then D1 is a category-varying document, belongs to both reviewed flow document supports and is counted once in mixed-flow support. A document summary cannot label D1 as only after because its first item is after.
- [ ] **T02-AC07.** Given known document C contains one item with changing after/before records, when document category profiling runs, then the document attribute is varying; when mixed reviewed-flow documents are counted, C is not falsely included as a two-flow document because C_1 has no classified flow. Attribute variation and reviewed mixed-flow support remain separate measures.
- [ ] **T02-AC08.** Given raw resource cells user_1/batch_2 and cumulative value 100/200 on one item, when their attributes are selected, then each has two unique raw values and event-varying support; no static resource identity or case-spend 100 is inferred. Static semantic role admission is separate from raw profiling.
- [ ] **T02-AC09.** Given a source item/document ID is 001 and another is 1, when grain counts run, then both exact string identifiers remain distinct unless a named identity-normalization recipe explicitly says otherwise; scientific notation normalization is confined to numeric amount cells.
- [ ] **T02-AC10.** Given a parent containing only D1_1 and D1_2, when the profile executes, then parent totals 2 items/4 records/1 known document, category invariant 2 and mixed-flow documents 1; siblings outside the parent are reported as outside-scope when requested and do not enter its totals.
- [ ] **T02-AC11.** Given more attribute values than the bounded example limit and one singleton value, when the analyst pages or opens evidence, then exact total unique/support counts stay unchanged and the singleton remains selectable; a minimum-support threshold cannot erase its existence.
- [ ] **T02-AC12.** Given a saved profile with G_1 conflict and native/prepared role lineage, when UI→public HTTP→save/export→actual different-PID reopen is exercised, then exact role indices, reducer, parent membership, totals, conflict rows and original names remain identical. Editing roles invalidates old actions until reviewed and a stale response cannot supply the new save payload.

### Public behavior, evidence and durability

- [ ] **02-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **02-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **02-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **02-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **02-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **02-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **02-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** profiled column roles, all-record reducer, missing/changing/unknown states, document-item relation, parent membership.

## Required qualification receipts

- Literal fixture is independently authored, with source rows, expected complete-item IDs, row IDs, counts and states; it is not generated by the implementation under test.
- Record candidate source/build digests, original and normalized byte hashes, API and parser versions, definition and frozen-parent identities, actual public HTTP request/response and matching built-browser actions.
- Record keyboard-accessible evidence drill-down, current save/export manifest checksums, first serving process PID and observed exit, distinct fresh process PID, and exact reopened answer. A component reload or service recreation in one PID is insufficient.
- The root engineering E01 – E07 cases apply: typed local refusal, stale-request fencing, immutable revisions, current export, no arbitrary recipe execution, counts/IDs/states exact and finite native numbers within absolute 1e-8.
- Report measured qualification separately from source inspection; retain failed/refused receipts and identify any missing full-source/browser/restart seam.
- Use independent F10 /known+missing/001-vs 1 literal rows and expected item/document/event supports.
- Receipt includes full source 16 case-attribute constancy findings, 6 Item Types, 3 Document Types and all-value unique/support totals; do not substitute 189584 selected-report items.

Each receipt identifies the candidate source/build, input and definition identities, independently expected versus actual values, public HTTP and built-browser actions, stable export/save references, observed first-process exit and distinct second-process reopening. Component or synthetic tests do not establish full-source capacity; report the elapsed time, peak memory and output/payload sizes for each full-source action that this ticket requires.

## Remaining gates and closure rule

- Define how mixed known+missing static values are encoded in the existing schema: conflicting/incomplete must remain distinct from entirely missing and from two-known-value conflicts.
- Review derived case_id string joins against explicit source document/item fields; source IDs are not safely inferred by generic underscore splitting.
- Full all-column profile must be qualified with source counts and bounded payload/time/memory; existing case-pilot success is insufficient.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #5, #14, #38, #41, #64, #99. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** None; can start on existing qualified foundations.

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
