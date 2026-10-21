# 16: Inspect count priorities at document grain

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [118](https://github.com/feelfine1977/WISE_Platform/issues/118) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst groups scored source items by purchasing document, opens each document’s complete item membership and compares priorities scaled by the number of scored PO items within each document, without rescaling item scores.

## Current platform foundation and missing analyst behavior

Source-linked document membership is a foundation. Document priorities need explicit grouping of existing scored items, the unchanged item reference, a scored-item count multiplier and retained unscored/mixed-flow siblings.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Review item-to-document dictionary
2. Choose frozen item-score run
3. Aggregate documents with scored-item count multiplier
4. Inspect document support and all sibling items
5. Compare concentration/shortlists with named denominator
6. Save/export/reopen exact membership

## Source evidence and limits

- WISE_12_10_2026.pdf, PDF25,29,35–36,39: PO-item scoring, purchasing-document grouping and item-level reference
- WISE_BPIC19_full_analysis.ipynb, one-based cells 11–12 (indices 10–11): document backlog/Pareto and tail membership
- merged_reports.pdf, Report 12 PDF259–262 (printed 3–6) and Report 13 PDF295–299 (printed 14–18): header/item unit distinctions and cardinality-specific intervals

**Source-step cross-reference:** R07.02, R13.09, R14.02, R14.05, R14.11, NB.C02, NB.C10, P03, P15. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: one purchasing document contains one or more scored PO items; native count multiplier is the number of scored PO items in that document, not1 per document.
- PANEL PRODUCT DECISION: mixed-flow documents preserve each item’s scope; no inferred single document-flow label replaces the items. Missing/conflicting headers require disclosed treatment.
- SOURCE LIMIT: R12 Figure1 implies a document count but Tables2/3 are item counts; R13 direct/approximate interval units differ. These cannot serve as interchangeable grouping or score golden targets.
- UNDEFINED SEMANTIC GATE: document liability/spend/obligation status is not supplied by an average of item score proxies.

## Required core and conditional extensions

The approved bounded working behavior is required. Separately gated report methods are not automatically activated by this ticket.

## Extended user stories

### T16-S01

As a procurement analyst, I want purchasing-document priorities built from item scores so that the governance unit can be reviewed without inventing a document score.

**Preconditions:** Validated item/document dictionary and frozen native item run

**User actions:**

1. Choose document grouping
2. Review scored-item multiplier
3. Rank

**Expected outcome:** Means/counts aggregate original items with the unchanged item-level arithmetic reference.

**Acceptance:** T16-AC01, T16-AC02; the common integration criteria also apply.

### T16-S02

As an analyst, I want to open every sibling item of a ranked document so that cross-item evidence is not lost by a row-level filter.

**Preconditions:** Original source/member IDs retained

**User actions:**

1. Open document row
2. Inspect scored and unscored members
3. Open complete item traces

**Expected outcome:** Document membership and score eligibility are separate exact lists.

**Acceptance:** T16-AC03; the common integration criteria also apply.

### T16-S03

As a reviewer, I want mixed-flow documents and conflicting item headers visible so that a document is not forced into one flow or owner from its first item.

**Preconditions:** Whole-case invariance and document dictionary profile

**User actions:**

1. Inspect mixed-flow siblings
2. Read conflict counts
3. Review grouping refusal or explicit recipe

**Expected outcome:** Mixed flow is legal document context; item header conflict is a separate quality gate.

**Acceptance:** T16-AC03, T16-AC04; the common integration criteria also apply.

### T16-S04

As an analyst, I want Pareto concentration labelled with its actual denominator so that a priority share is not described as financial loss or total deviation.

**Preconditions:** Positive PI or penalty-mass definition chosen

**User actions:**

1. Read numerator/unit/denominator
2. Select80%/95% threshold
3. Inspect included document set

**Expected outcome:** Positive PI concentration and summed penalty concentration are distinct outputs.

**Acceptance:** T16-AC05; the common integration criteria also apply.

### T16-S05

As a stakeholder reviewer, I want document shortlists compared under the same item source so that changed first priorities can be traced back to view weights.

**Preconditions:** Paper views or separately admitted historical views

**User actions:**

1. Compare first document and topN list
2. Open moved document
3. Read unchanged item source

**Expected outcome:** View-specific references and document membership remain explicit.

**Acceptance:** T16-AC02, T16-AC06; the common integration criteria also apply.

### T16-S06

As a returning analyst, I want exact document members and counts preserved through export/reopen so that a new reader sees the same governance roll-up.

**Preconditions:** Frozen document run saved

**User actions:**

1. Export full document/item manifest
2. Restart actual service
3. Reopen a sibling case

**Expected outcome:** Document totals and item references survive the highest seam.

**Acceptance:** T16-AC07; the common integration criteria also apply.

## Acceptance criteria

### Approved baseline retained

- [ ] **16-B01.** The multiplier is the number of scored PO items in the document; document means and the arithmetic item reference retain their distinct definitions.
- [ ] **16-B02.** Document grouping aggregates original items; it does not create a new item score or require financial exposure.
- [ ] **16-B03.** Missing/conflicting headers and overlapping perspectives have explicit support or refusal.
- [ ] **16-B04.** Pareto percentages state count-PI or penalty support; zero relative priority is not a compliance result.
- [ ] **16-B05.** Exact document-to-item membership and output units survive export/restart.

### Exact domain and analyst acceptance

- [ ] **T16-AC01.** Given item scores A=.9, B=.95, C=1 with A/B in document D and C in E, When native document count PI runs, Then arithmetic item reference=.95; D has scored-item count=2, mean=.925, gap=.025 and PI=.05; E has count=1, mean=1 and PI=0. Averaging the document means instead yields .9625 and must fail.
- [ ] **T16-AC02.** Given a document with two scored items and one unscored sibling, When its roll-up is read, Then multiplier2 and score mean uses those two, while the original document-member count3 and unscored member/reason are separately visible.
- [ ] **T16-AC03.** Given DF1 and Consignment sibling items in one document, When grouping is evaluated, Then each item retains its own criteria/scopes and the document has exact mixed membership; no first-item flow substitution occurs. Duplicate source events do not multiply the item count.
- [ ] **T16-AC04.** Given an item whose recorded purchasing-document field conflicts across its rows, When document grouping is requested, Then it is refused or uses a newly reviewed explicit recipe with source witnesses; groupby.first is not implicit proof of dictionary integrity.
- [ ] **T16-AC05.** Given document PI values 2,1,0, When concentration uses positive PI, Then total positive mass=3 and the first document’s share=2/3. Zero PI carries no relative-priority mass but the document remains visible. This is not a share of financial loss, savings or all noncompliance.
- [ ] **T16-AC06.** Given full source paper views, When document shortlists are inspected, Then source first Balanced/Completion document 4508073932 and Operations 4507021416 are checked with item-level view references; exact top20 membership and boundary ties are retained as ticket15 comparison receipts.
- [ ] **T16-AC07.** Given the stated literal fixture, the actual qualified packed Method and API/browser builds from one recorded revision, When the analyst imports through real HTTP, confirms the role/profile/population definition in the built browser, runs, inspects source witnesses, exports and saves, terminates the actual service process, starts a new process and reopens through HTTP and the built browser, Then the stated numeric values and exact identities/missing locations remain equal (numeric maximum absolute error <1e-8), frozen artifacts reopen without silently evaluating a new norm, and changed source/population/definition replies are refused or visibly stale. A React mock, isolated Method test, screenshot or successful pilot alone cannot close this criterion.

### Public behavior, evidence and durability

- [ ] **16-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **16-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **16-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **16-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **16-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **16-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **16-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** source document-item relation, named item run, same item-based reference, scored-item count multiplier, unscored sibling visibility.

## Required qualification receipts

- Exact source-byte hash, original record positions/IDs and immutable preparation/mapping/role identities
- Named whole-item population membership/hash, base reference membership/hash, document dictionary, four-flow classification and unknown/conflict/exclusion receipts
- Compiled norm document/fingerprint, requested and admitted criterion IDs, omission manifest, source/profile version, view and actual raw/effective weights
- Actual packed wise-pm artifact hash/version/source commit/qualification state and matching API/browser build identities
- Native scope/reason/deviation/score/penalty/contribution outputs, evidence coverage numerator/denominator and unavailable support
- Grouping keys/reducers, scored-member identities, arithmetic reference, multiplier/unit, gamma/minimum support/tie policy and calibration identity
- Run identity, original endpoint/count/resource/value witnesses, current-run export manifest and persisted case/group artifacts
- Real HTTP request/answer records, built-browser evidence interaction, actual service stop/new-process restart and reopened frozen artifact checks

Each receipt identifies the candidate source/build, input and definition identities, independently expected versus actual values, public HTTP and built-browser actions, stable export/save references, observed first-process exit and distinct second-process reopening. Component or synthetic tests do not establish full-source capacity; report the elapsed time, peak memory and output/payload sizes for each full-source action that this ticket requires.

## Remaining gates and closure rule

- R12 retained 65,200 versus 218,821 units and alignment table partition errors remain a discrepancy register, not silently corrected targets.
- Exposure is optional ticket27; count-only document grouping must work without a mapped monetary field.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #38, #41, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** #104 — Profile case attributes and business grain, #115 — Rank business groups by actual Method priority

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
