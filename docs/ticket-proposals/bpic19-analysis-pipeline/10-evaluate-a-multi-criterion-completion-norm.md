# 10: Evaluate a multi-criterion completion norm

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [112](https://github.com/feelfine1977/WISE_Platform/issues/112) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst reviews a three-criterion Completion norm, evaluates it with real Method scope/value/coverage and inspects known absence beside criterion-local unavailability.

## Current platform foundation and missing analyst behavior

Optional scoring currently admits the bounded Resolution journey. The platform still needs public typed admission and durable review of the three-criterion Completion norm with flow scope and criterion-local evidence availability.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Choose the original PO-item base and four-flow profile
2. Review the completion-only draft and source rationale
3. Inspect original counts and known/unknown evidence
4. Evaluate the admitted three checks with actual Method
5. Read score beside coverage and mandatory-control context
6. Save/export and reopen the exact staged assessment

## Source evidence and limits

- WISE_12_10_2026.pdf, one-based PDF25 and35–36: ten-criterion application, completion scope, known absence/evidence distinction and weights
- WISE_12_10_2026.pdf, PDF34 and40: screening choices and scope of numerical verification
- merged_reports.pdf, Report 12 PDF260–262 (printed 4–6), Report 13 PDF282–285 (printed 1–4): four-flow/item-document context; repeated cycles and absent approvals

**Source-step cross-reference:** NB.C03, P04, P05, P08, P09, P14. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: C01 invoice and C02 clearing apply non-Consignment; C03 receipt applies DF1/DF2 only; activity labels are exact and recorded absence is not proven overdue work.
- PANEL PRODUCT DECISION: completion, completion_timing, completion_rework_effort and full are separately compiled native norms, not an all ten norm with seven unavailable placeholders.
- PANEL PRODUCT DECISION: unknown flow scope is three-valued; coverage is unavailable when the full in-scope denominator is unknown. Mandatory safeguards remain separately visible and are not waived by an aggregate score.
- UNDEFINED BUSINESS GATE: due-obligation status, observation sufficiency and justified absence are not established by the paper. They need separately supplied business meaning before compliance/outcome claims.
- PANEL PRODUCT DECISION: C01–C03 consume binary minimum-presence inputs: 1 after any known selected row, 0 only after no match with complete labels, otherwise unavailable. Exact counts remain separately unknown with incomplete labels. No platform score formula or generic bound engine is added.

## Required core and conditional extensions

The approved bounded working behavior is required. Separately gated report methods are not automatically activated by this ticket.

## Extended user stories

### T10-S01

As a purchasing analyst, I want to choose the three-criterion completion profile so that I can assess recorded milestones before timing and resource measures are ready.

**Preconditions:** Named original-item population and reviewed flow field

**User actions:**

1. Choose completion
2. Review C01–C03 and the omitted seven IDs
3. Evaluate

**Expected outcome:** A distinct native three-check norm is executed; a full-paper result is not claimed.

**Acceptance:** T10-AC01, T10-AC02; the common integration criteria also apply.

### T10-S02

As a purchasing analyst, I want to inspect each count and the complete item history so that known recorded absence is distinguishable from a missing or unreliable activity field.

**Preconditions:** Original records retained

**User actions:**

1. Open C02
2. Inspect counted labels and the full item trace
3. Read the evidence reason

**Expected outcome:** Witnessed binary presence stays separate from exact multiplicity. Absence requires complete label coverage; Method grades the presence indicators while raw counts and lower bounds remain visible.

**Acceptance:** T10-AC02, T10-AC03; the common integration criteria also apply.

### T10-S03

As a process-control reviewer, I want to see scope across all four flow types so that the researcher criterion does not silently become a universal business obligation.

**Preconditions:** DF1/DF2/two-way/Consignment classifications reviewed

**User actions:**

1. Compare flow cases
2. Open out-of-scope and unknown-scope items
3. Read separate mandatory-control flags

**Expected outcome:** C03 is evaluated only DF1/DF2; paper C03 excludes Consignment even when a separately reviewed goods-receipt control applies.

**Acceptance:** T10-AC01, T10-AC04; the common integration criteria also apply.

### T10-S04

As an analyst, I want to review scope, thresholds and actual raw/effective weights before evaluating so that I can explain how a partial assessment is assembled.

**Preconditions:** Source-labelled draft available

**User actions:**

1. Review researcher threshold/minimum-count settings
2. Choose a view
3. Read effective weights after evaluation

**Expected outcome:** Balanced completion-only weights normalize to thirds for a fully evaluable DF1 item; source rationale and control role remain explicit.

**Acceptance:** T10-AC01, T10-AC02, T10-AC05; the common integration criteria also apply.

### T10-S05

As an analyst, I want to read unavailable, outside-scope and unscored outcomes beside coverage so that a high score cannot hide evidence gaps.

**Preconditions:** At least one missing-label, unknown-flow and Consignment fixture

**User actions:**

1. Open item states
2. Read raw-weight numerator/denominator
3. Compare scored/unscored support

**Expected outcome:** A Consignment completion-only item is unscored; unknown scope cannot yield falsely complete coverage.

**Acceptance:** T10-AC03, T10-AC04; the common integration criteria also apply.

### T10-S06

As a returning analyst, I want to reopen a saved completion run so that later timing work does not overwrite the original definition or evidence.

**Preconditions:** Completion run saved

**User actions:**

1. Export
2. Stop and restart service
3. Reopen old run
4. Open later five-, eight- and ten-criterion run separately

**Expected outcome:** Three-, five-, eight- and ten-check identities and omission manifests remain separate.

**Acceptance:** T10-AC06; the common integration criteria also apply.

## Acceptance criteria

### Approved baseline retained

- [ ] **10-B01.** Reuse local draft/reviewed authoring and actual qualified Method; no parallel application scorer.
- [ ] **10-B02.** First supported profile admits C01–C03 with exact matching-flow scope and positive criterion weights.
- [ ] **10-B03.** Outside scope, in-scope unavailable, evaluated and unscored are separate; a bad time in one case does not block a known presence result.
- [ ] **10-B04.** Raw/effective weights, weighted coverage, Method/norm/run identity and mandatory-control flags are visible.
- [ ] **10-B05.** Unequal eligibility and missing timing fixtures, validation refusals and restart preserve existing Resolution behavior.

### Exact domain and analyst acceptance

- [ ] **T10-AC01.** Given the requested completion family, When the actual native norm is compiled, Then it contains exactly THREE constraints: C01, C02 and C03. Its provenance/omission manifest references the original ten-criterion paper catalogue and seven intentionally excluded checks; the API does not force evaluation of ten constraints. Native schema is 3 and the staged norm/run fingerprint is distinct. C01/C02 apply to DF1, DF2 and two-way; C03 applies to DF1/DF2 only.
- [ ] **T10-AC02.** Given a DF1 item with invoice=1, clearing=0, goods/SES=1 and unusable timestamps, When Balanced completion is evaluated, Then deviations=(0,1,0), raw weights=(1,1,1), effective weights=(1/3,1/3,1/3), score=2/3 and coverage=3/3=1. Bad time must not suppress these known counts.
- [ ] **T10-AC03.** Given a DF1 item with one known Record Invoice Receipt, one known GR/SES, an unrelated record with missing activity and no known clearing, When native Completion evaluates witnessed binary presence indicators, Then C01/C03 deviations are 0, C02 is unavailable, positive effective weights are 1/2 each, score=1 and coverage=2/3. Invoice/receipt presence indicators are 1 because their positive rows prove presence; clearing is unavailable because missing labels prevent proving absence. Exact multiplicities remain unavailable and lower bounds plus positive/unknown row IDs remain visible. Given no matches with complete activity labels, the presence indicator is 0; given no matches with incomplete labels, it is unavailable. This finite panel policy adds no application score formula and no generic bound-inference engine; actual BPIC19 labels are complete.
- [ ] **T10-AC04.** Given a Consignment item, When only completion is evaluated, Then all three checks are outside scope, score and coverage are unavailable and scored support=0. Given an unknown/conflicting flow, Then flow-specific scope is unknown and full coverage is unavailable, with known raw totals and unknown-scope support exposed.
- [ ] **T10-AC05.** Given the completion draft, When the analyst reviews or switches stakeholder view, Then the source rationale, minimum presence 1, exact activity sets, flow scope and per-criterion weights are visible before Evaluate. Effective weights are supplied by Method. Any separately supplied mandatory-control flag remains visible. Editing an analytical meaning creates a new definition identity.
- [ ] **T10-AC06.** Given the stated literal fixture, the actual qualified packed Method and API/browser builds from one recorded revision, When the analyst imports through real HTTP, confirms the role/profile/population definition in the built browser, runs, inspects source witnesses, exports and saves, terminates the actual service process, starts a new process and reopens through HTTP and the built browser, Then the stated numeric values and exact identities/missing locations remain equal (numeric maximum absolute error <1e-8), frozen artifacts reopen without silently evaluating a new norm, and changed source/population/definition replies are refused or visibly stale. A React mock, isolated Method test, screenshot or successful pilot alone cannot close this criterion.

### Public behavior, evidence and durability

- [ ] **10-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **10-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **10-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **10-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **10-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **10-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **10-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** three-criterion Completion family, per-flow scope, raw count availability, native norm revision, criterion/layer weights, view and aggregation mode.

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

- The source supplies researcher screening criteria, not a contractual completion policy. No ticket acceptance may infer overdue liability or breach solely from a recorded absence.
- A tolerance against full-paper scores does not apply to the staged three-check run.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #21, #22, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** #105 — Distinguish the four purchasing flow types, #107 — Inspect source-witnessed activity measures

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
