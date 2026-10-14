# 01: Review a named source and observation policy

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [103](https://github.com/feelfine1977/WISE_Platform/issues/103) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst reviews one reproduction profile, original-source identity, whole-case inclusion, raw timestamp anomalies and a trusted observation horizon, then saves/reopens that interpretation.

## Current platform foundation and missing analyst behavior

Import/source/preparation identities exist. A named analyst reproduction profile with original-to-normalized lineage, trusted analysis horizon separate from parser cutoff, source-specific inclusion and durable discrepancy review is still required.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Open Data and import the prepared BPIC19 representation; see original source and conversion lineage before an analysis.
2. Review case/activity/time roles, input timezone interpretation, original versus normalized fields and item/document/event totals.
3. Open a 1948/future-date or missing-clock row in its complete original item history.
4. Choose one named source profile; separately declare horizon and evidence or leave horizon unknown.
5. Preview whole-item, whole-document or explicitly named record projection counts and exclusions before keeping a population.
6. Save the reviewed source interpretation, export its declarative recipe, reopen in a distinct serving process and compare revisions without changing raw records.

## Source evidence and limits

- R01 KPMG, merged PDF 5–10 (printed 4–9): three business grains, anomalous 1948/2020 dates, completion and inconsistent selected totals.
- R02 Adaloudis, merged PDF 28–33 (printed 3–8): missing labels→Unknown in its projection; exclude whole purchasing documents starting before 2018; later events retained.
- R03 PwC, merged PDF 51–52 (printed 5–6): numeric conversion; any 2018-event item inclusion plus post 27 Jan 2019 event exclusion.
- R04 Meyer et al., merged PDF 80–82 (printed 3–5):2018–28 Jan 2019 accepted timeframe, completion/compliance distinct.
- R06 Botti, merged PDF 131–132:271 calendar-anomalous items and 3289 blank-classification items, raw 251734/1595923/76349 versus working 248177/74851.
- R07 Jessen, merged PDF 146–147 (printed 2–3): named event-only 2017-01-01–2019-05-25 projection, all traces claimed retained, category subtotal 251347 differs from overview 251734.
- WISE supplied paper PDF 34–36 Appendix B: all 251734 PO items remain; 2017≤selected milestone<2020 is a criterion endpoint gate, not universal source trimming.

**Source-step cross-reference:** R01.01, R01.02, R01.03, R02.01, R02.02, R03.03, R04.01, R05.02, R06.01, R07.01, R08.01, R08.02, R08.07, R09.01, R09.06, R10.01, R10.02, R11.01, R12.01, R12.02, R12.03, R12.04, R13.01, R13.02, R13.04, R14.01, R14.12, R15.01, R15.02, R15.09, NB.C01, NB.C02, NB.C22, NB.C23, P01, P02, P03. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: Report authors use incompatible cleaning rules. Their named projections and reported counts are preserved, not conflated into a universal clean BPIC19 log.
- PANEL default: Start with all original PO items and all original records. A source profile is an immutable declarative definition containing original/normalized hashes, conversion lineage, mapping/parser, clock, inclusion grain, boundaries and horizon provenance.
- PANEL: Trusted observation horizon and maximum parsed timestamp are different fields. A source anomaly after a trusted horizon remains inspectable; a reviewed analysis overlay may be admitted without mutating raw chronology or pretending the future row occurred inside the horizon.
- PANEL: Unknown observation horizon remains unknown. Descriptive raw counts remain usable; due-obligation and horizon-dependent censoring are unavailable until reviewed. Generic parser refusal alone does not qualify the usable paper source path.
- PANEL: Whole-item and whole-document selection retain all selected item records. Event-only projections are explicit derived representations and never silently replace raw histories.
- UNKNOWN: Causes of 1948/2020 dates, actual extraction/observation contract, SAP payment terms and authoritative source timezone are not established by analyst hypotheses. No automatic business diagnosis or timezone repair follows.

## Required core and conditional extensions

The approved bounded working behavior is required. Separately gated report methods are not automatically activated by this ticket.

## Extended user stories

### T01-US01

As a process analyst, I want to understand the original source before choosing a cleaning rule so that a published analysis is reproducible without hiding inconvenient dates.

**Preconditions:** The prepared BPIC19 source and original-source lineage are available.

**User actions:**

1. Import the source.
2. Review roles, totals and clock.
3. Open the 1948 and future records.
4. Keep the all-source interpretation without creating a Norm.

**Expected outcome:** The all-source population and anomaly evidence are available before mining or scoring.

**Acceptance:** T01-AC01, T01-AC04, T01-AC05, T01-AC06; the common integration criteria also apply.

### T01-US02

As a data analyst, I want to compare item-level and document-level inclusion so that selecting an old document cannot leave its later sibling items silently inside the population.

**Preconditions:** H7 is loaded and its explicit item/document relation is reviewed.

**User actions:**

1. Choose whole-document start≥2018.
2. Inspect A and excluded sibling B.
3. Change to whole-item inclusion.
4. Read both retained/excluded receipts.

**Expected outcome:** The two named definitions retain[C] and[B, C] respectively, and both raw histories remain intact.

**Acceptance:** T01-AC02, T01-AC03, T01-AC07; the common integration criteria also apply.

### T01-US03

As a process-mining analyst, I want to inspect a reported event-only projection beside the original log so that I can reproduce its scope without mistaking shortened traces for original histories.

**Preconditions:** H7 and the separately named2018 record projection are available.

**User actions:**

1. Preview the projection.
2. Open item A from the projected view.
3. Toggle the original history.
4. Return to the all-source parent.

**Expected outcome:** The projection has 5 records and 3 items; original A still has its 1948 and 2020 records.

**Acceptance:** T01-AC03, T01-AC04; the common integration criteria also apply.

### T01-US04

As a process improvement expert, I want unknown observation limits and report inconsistencies to remain visible so that missing payment evidence is not presented as proven lateness.

**Preconditions:** No authoritative horizon is established and the reported category subtotal differs from measured source totals.

**User actions:**

1. Inspect the missing-clearing item.
2. Review the horizon field.
3. Open the source discrepancy.
4. Export the limitation with the selected interpretation.

**Expected outcome:** Due assessment remains unavailable and the 387-item report subtotal discrepancy remains explicit.

**Acceptance:** T01-AC05, T01-AC08; the common integration criteria also apply.

### T01-US05

As a data steward, I want to repair a mapping or clock deliberately so that a correction makes a new analytical revision while the prior interpretation remains reviewable.

**Preconditions:** An item has changing document cells or naive timestamps needing reviewed clock interpretation.

**User actions:**

1. Open both conflicting rows.
2. Review a supported corrected binding or clock.
3. Save a new revision.
4. Reopen the old revision and compare identities.

**Expected outcome:** The corrected result is distinct; the conflict is never erased from the original source.

**Acceptance:** T01-AC06, T01-AC07, T01-AC09; the common integration criteria also apply.

### T01-US06

As an analyst returning to the project, I want to reopen the saved source interpretation after a real application restart so that the same cleaning, horizon and exclusion evidence governs my next analysis.

**Preconditions:** The H7 source profile and an exclusion witness are saved and exported.

**User actions:**

1. Stop the serving process and observe exit.
2. Start a different PID.
3. Reopen the workspace and saved profile.
4. Open exclusion A and export the current recipe.

**Expected outcome:** Exact memberships, raw records, identities and horizon limitations survive restart.

**Acceptance:** T01-AC09, T01-AC10; the common integration criteria also apply.

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

- [ ] **01-B01.** Source, raw snapshot and declared CSV/XES export counts/clock remain pinned.
- [ ] **01-B02.** A horizon preceding raw sentinel/future dates is explicitly admitted or refused; raw histories are never silently trimmed.
- [ ] **01-B03.** Whole-item, whole-document and named record projections have distinct exclusion/support receipts.
- [ ] **01-B04.** Conflicting case/document/context mappings and undefined cutoff remain visible; no synthetic fallback.
- [ ] **01-B05.** A reviewed profile with a source discrepancy and witness reopens through the primary behavior seam.

### Exact domain and analyst acceptance

- [ ] **T01-AC01.** Given the pinned complete BPIC19 original and its prepared CSV, when the analyst admits the all-source profile through import and the built browser, then the overview is 251734 PO items, 1595923 original records and 76349 purchasing documents, with original and prepared hashes plus record lineage; no post-horizon event is dropped to make those totals fit.
- [ ] **T01-AC02.** Given H7 has A in document D with vendor row 1948, creation 2018, clearing 2020; sibling B in D has creation 2018 and receipt 2018; C in document E has creation 2018 and clearing 2018, when reviewed whole-document start≥2018 inclusion runs, then retained IDs=[C], excluded=[A, B], retained records=2, excluded records=5 and retained documents=1. All seven raw records remain inspectable.
- [ ] **T01-AC03.** Given the same H7, when whole-item start≥2018 is chosen instead, then retained=[B, C], excluded=[A], records 4/3 and known documents 2/1; when a separately named 2018-only event projection is chosen, then projected records=5 and projected item IDs=[A, B, C], while the raw source stays 3 items/7 records/2 documents. The three definitions have different identities.
- [ ] **T01-AC04.** Given H7 raw maximum 2020 and a reviewed trusted horizon 2019-01-28T00:00:00Z, when source review is saved, then the horizon and its provenance remain 2019-01-28, parser observed maximum remains 2020, A retains its future record and the anomaly is visible. A usable all-source paper path is qualified with an admitted overlay or an explicit implemented equivalent; silently trimming to satisfy parser cutoff is a failure.
- [ ] **T01-AC05.** Given horizon=null and a case without Clear Invoice, when the analyst views its source profile, then horizon_state=unknown, recorded clearing count=0 and due/overdue assessment=unavailable; neither the latest parsed row nor machine current date substitutes for horizon.
- [ ] **T01-AC06.** Given an original naive timestamp and an analyst-declared UTC interpretation, when conversion succeeds, then original cell and converted instant are both retained; when a named timezone is absent or conflicting, the product asks for reviewed interpretation or returns a typed clock refusal. It never invents Europe/Berlin from the workstation setting.
- [ ] **T01-AC07.** Given an original case-to-document mapping changes between records, when a whole-document inclusion is requested, then that item relation is conflicting with both source rows and local document membership unavailable, while raw item/event totals remain known. First nonempty document value is not an implicit repair.
- [ ] **T01-AC08.** Given the raw report claims all 251734 cases yet its four category table totals 251347, when the analyst links that reported profile, then the difference 387 is displayed as a source discrepancy; the raw measured population is not reduced to 251347 to match the publication.
- [ ] **T01-AC09.** Given saved source revision A, when one source byte, clock interpretation, boundary, horizon provenance or inclusion grain changes, then a new source/preparation/definition revision B is created and A remains reopenable. Reordering a table leaves A’s analytical identity unchanged; missing referenced bytes return a typed missing-artifact refusal.
- [ ] **T01-AC10.** Given a saved H7 profile and exclusion witness A, when the actual serving PID exits and a different fresh PID reopens the workspace, then source hashes, raw 7 records, retained/excluded IDs, clock/horizon, projection definition and highlighted source rows exactly match the saved HTTP/browser/export answer. A stale expected revision cannot overwrite it.

### Public behavior, evidence and durability

- [ ] **01-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **01-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **01-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **01-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **01-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **01-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **01-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** source and normalized byte identities, conversion/field-row lineage, mapping and parser, clock policy, analysis horizon and its evidence, inclusion grain and source profile.

## Required qualification receipts

- Literal fixture is independently authored, with source rows, expected complete-item IDs, row IDs, counts and states; it is not generated by the implementation under test.
- Record candidate source/build digests, original and normalized byte hashes, API and parser versions, definition and frozen-parent identities, actual public HTTP request/response and matching built-browser actions.
- Record keyboard-accessible evidence drill-down, current save/export manifest checksums, first serving process PID and observed exit, distinct fresh process PID, and exact reopened answer. A component reload or service recreation in one PID is insufficient.
- The root engineering E01 – E07 cases apply: typed local refusal, stale-request fencing, immutable revisions, current export, no arbitrary recipe execution, counts/IDs/states exact and finite native numbers within absolute 1e-8.
- Report measured qualification separately from source inspection; retain failed/refused receipts and identify any missing full-source/browser/restart seam.
- Use H7’s literal seven source rows; record three different inclusion identities and exact retained/excluded row IDs.
- Full-source admission receipt must include measured import/runtime totals and original-to-prepared hashes; a 15-row pilot does not qualify 251734 items.

Each receipt identifies the candidate source/build, input and definition identities, independently expected versus actual values, public HTTP and built-browser actions, stable export/save references, observed first-process exit and distinct second-process reopening. Component or synthetic tests do not establish full-source capacity; report the elapsed time, peak memory and output/payload sizes for each full-source action that this ticket requires.

## Remaining gates and closure rule

- Authoritative observation horizon and timezone require a reviewed source statement; the raw maximum is insufficient.
- Existing parser admission may currently reject a horizon before future raw records; qualify a non-destructive analysis overlay, not refusal-only closure.
- Report-specific 2018-start/case/calendar choices remain explicitly separate named definitions.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #5, #25, #99. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** None; can start on existing qualified foundations.

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
