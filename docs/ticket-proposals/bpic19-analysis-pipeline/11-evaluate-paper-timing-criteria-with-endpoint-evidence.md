# 11: Evaluate paper timing criteria with endpoint evidence

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [113](https://github.com/feelfine1977/WISE_Platform/issues/113) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst adds the paper’s independently selected C04/C05 criteria, reads graded timing and precedence values, and opens their exact records and refusal reasons.

## Current platform foundation and missing analyst behavior

Native numerical functions are a foundation, not a public paper timing workflow. C04/C05 need the actual source endpoint rules, exact ramps/scope, raw witnesses and separately compiled partial versus complete norm identities.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Review completion_timing assembly
2. Review exact invoice/clearing/receipt selectors and parsed-minimum policy
3. Inspect selected and rejected endpoint rows
4. Evaluate native grades and DF1 order
5. Compare timing evidence without dropping incomplete items
6. Save the five-check run and qualify the named exemplar endpoint

## Source evidence and limits

- WISE_12_10_2026.pdf, PDF25–27 and35–36: C04/C05 definition, selected minima, range, missing-state and exemplar
- WISE_12_10_2026.pdf, PDF26 and29: Packaging and DF2-stratified duration comparisons
- merged_reports.pdf, Report 13 PDF295–299 (printed 14–18): accurate/approximate interval families differ from independent item minima

**Source-step cross-reference:** NB.C03, P04, P06, P08, P09, P12, P13, P14. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: C04 uses Record Invoice Receipt only, Clear Invoice only, earliest parsed nonmissing timestamps independently; C05 uses earliest GR / SES and invoice; range applies after choosing minima.
- SOURCE: an unparsable candidate can be omitted when another parsed endpoint exists, but an earlier parsed out-of-range candidate cannot be replaced. C04 requires nonnegative lag; C05 equality satisfies.
- PANEL PRODUCT DECISION: 5-check stage has its own fingerprint and explicit omissions C06–C10; exact full-paper exemplar score belongs to ticket24.
- UNDEFINED METHOD GATE: Report 13 weighted-mean approximate interval weights are not fully supplied. They cannot substitute for C04 or acquire numerical-parity claims.

## Required core and conditional extensions

The approved bounded working behavior is required. Separately gated report methods are not automatically activated by this ticket.

## Extended user stories

### T11-S01

As an accounts-payable analyst, I want to add the paper timing checks to completion so that I can inspect delay without losing items lacking clearing.

**Preconditions:** Completion admitted and raw endpoint measures available

**User actions:**

1. Choose completion_timing
2. Review only C01–C05
3. Evaluate

**Expected outcome:** Five native criteria are compiled; C02 absence and C04 unavailability remain distinct.

**Acceptance:** T11-AC01, T11-AC02; the common integration criteria also apply.

### T11-S02

As an analyst, I want to inspect the earliest parsed timestamps and rejected candidates so that I can verify that the platform did not silently use first-after matching.

**Preconditions:** Original timestamp cells and positions retained

**User actions:**

1. Open invoice and clearing candidates
2. Inspect earlier invalid minimum
3. Read selected/rejected row IDs

**Expected outcome:** Independent minima, range and reversal states are explained exactly.

**Acceptance:** T11-AC03, T11-AC04; the common integration criteria also apply.

### T11-S03

As a flow reviewer, I want to compare receipt/invoice order in DF1 and DF2 so that permitted invoice-before-receipt behavior is not wrongly penalized.

**Preconditions:** Reviewed matching-flow classification

**User actions:**

1. Inspect DF1 tie and strict earlier invoice
2. Inspect same DF2 history

**Expected outcome:** C05 has deviation 0 for equality,1 for earlier invoice in DF1 and outside-scope in DF2; DF2 permission is not a requirement to invoice early.

**Acceptance:** T11-AC05; the common integration criteria also apply.

### T11-S04

As an analyst, I want to read partial grade values in days so that the 30-to-90-day researcher scale is transparent.

**Preconditions:** Usable nonnegative selected endpoints

**User actions:**

1. Inspect intervals30,60,90days
2. Read native deviation and units

**Expected outcome:** C04 deviations are0,.5,1 and raw endpoints remain source witnesses.

**Acceptance:** T11-AC02, T11-AC06; the common integration criteria also apply.

### T11-S05

As a process-improvement reviewer, I want a deterministic representative case and a counterexample so that I can test the group finding against the records.

**Preconditions:** Timing admitted and frozen eligible population

**User actions:**

1. Compute the median of all C04-evaluable Packaging items
2. Compare all C04-evaluable items outside Packaging
3. Repeat the comparison within DF2 with exact eligible support
4. Restrict exemplar candidates to positive deviations and select nearest to the all evaluable median
5. Open the original records

**Expected outcome:** Exemplar rules and ties are explicit; timing endpoint qualification is separate from full ten score qualification.

**Acceptance:** T11-AC06, T11-AC07; the common integration criteria also apply.

### T11-S06

As a returning analyst, I want to export and reopen the timing definition and endpoints so that a later matching algorithm cannot rewrite the result.

**Preconditions:** Frozen five-check timing run

**User actions:**

1. Save/export
2. Restart actual service
3. Reopen endpoint and source rows

**Expected outcome:** The occurrence/range/nonnegative policies and native values are unchanged.

**Acceptance:** T11-AC08; the common integration criteria also apply.

## Acceptance criteria

### Approved baseline retained

- [ ] **11-B01.** C04 uses independent earliest parsed invoice/clearing minima and30d/60d saturation, not generic first-after substitution.
- [ ] **11-B02.** C05 applies only DF1, admits equal times and exposes selected receipt/invoice witnesses.
- [ ] **11-B03.** The2017-inclusive/2020-exclusive policy, reversed intervals and minimum-first invalid evidence are explicit.
- [ ] **11-B04.** C02 absence can be evaluated while C04 is unavailable; score/coverage/effective weights follow actual Method.
- [ ] **11-B05.** Named exemplar qualification here covers C04 endpoints,69.040972days and deviation0.650683; full ten-criterion score0.907045/coverage7of9 parity waits for joined24.

### Exact domain and analyst acceptance

- [ ] **T11-AC01.** Given completion_timing selected, When Method compiles the actual norm, Then it contains exactly C01–C05, with five compiled constraints and an omission manifest for C06–C10 from the original paper ten. Full-paper parity is false. Neither missing invoice nor unavailable timing triggers a global time gate.
- [ ] **T11-AC02.** Given a DF1 item with known invoice presence 1, clearing presence 0 and receipt presence 1, unusable C04 interval and usable nonviolating C05, When Balanced five-criterion scoring runs, Then C02 deviation=1, C04 unavailable, other three evaluated deviations=0, effective weights=1/4, score=.75 and coverage=4/5=.8.
- [ ] **T11-AC03.** Given invoice at 2018-01-02, clearing at 2018-01-01 and later clearing at 2018-02-02, When C04 selects independent minima, Then lag=-1 day and C04 is unavailable; the later clearing is not substituted. Given invoice at 1948-01-01 plus a later invoice at 2018-01-01, Then the earlier parsed minimum makes C04 unavailable despite the later valid timestamp.
- [ ] **T11-AC04.** Given an unparseable invoice timestamp and a separate parsed 2018 invoice, When the minimum is selected, Then the parsed invoice may supply the endpoint while the invalid raw row remains retained. Minimum 2017-01-01 is admissible; minimum 2020-01-01 is outside the declared range.
- [ ] **T11-AC05.** Given invoice and GR/SES at the same admissible time in DF1, When C05 evaluates, Then deviation=0. A strictly earlier invoice gives deviation=1. The same before-receipt history in DF2 is outside C05 scope: permission to invoice early is not a requirement to do so.
- [ ] **T11-AC06.** Given usable nonnegative C04 durations 30, 60 and 90 days, When native Metric runs with target 30 and width 60, Then deviations are 0, .5 and 1; raw endpoint rows and units are retained. Source item 4507005472_00040 has selected invoice/clearing dates 16 February/26 April 2018, duration 69.040972 days and deviation (69.040972−30)/60≈.6506828667. Its full ten-criterion score is not a five-criterion result.
- [ ] **T11-AC07.** Given all 76,608 C04-evaluable Packaging items, When the target median is computed, Then its rounded source target is 69.04 days. The exemplar candidate set is subsequently restricted to the 64,068 positive-deviation items, and the candidate nearest the ALL-evaluable median is chosen using a declared deterministic item-ID tie rule. Compare Packaging with ALL groups outside Packaging (106,661 C04-evaluable items; rounded median 28.93 days), then repeat within DF2 only (rounded medians 70.14 versus 29.10 days), retaining exact eligible memberships and computed DF2 support. The scope count is 100,635 Packaging items and the scored group contains 109,199 items; those denominators are distinct. Rounded medians are diagnostic publication targets after independent qualification, not values to obtain by tuning. Full exemplar score 0.907045 and coverage 7/9 are qualified only in ticket 24 with exact C01–C10.
- [ ] **T11-AC08.** Given the stated literal fixture, the actual qualified packed Method and API/browser builds from one recorded revision, When the analyst imports through real HTTP, confirms the role/profile/population definition in the built browser, runs, inspects source witnesses, exports and saves, terminates the actual service process, starts a new process and reopens through HTTP and the built browser, Then the stated numeric values and exact identities/missing locations remain equal (numeric maximum absolute error <1e-8), frozen artifacts reopen without silently evaluating a new norm, and changed source/population/definition replies are refused or visibly stale. A React mock, isolated Method test, screenshot or successful pilot alone cannot close this criterion.

### Public behavior, evidence and durability

- [ ] **11-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **11-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **11-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **11-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **11-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **11-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **11-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** admitted C01–C05 family, C04 endpoint selection and nonnegative admissibility, 30-day target and 60-day width, DF1-only C05, selected view/mode.

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

- Paper elapsed time is not a matched invoice-cycle duration, contractual lateness, active work time or an avoidable waiting estimate.
- Clock parsing/timezone provenance must be explicit; CSV/XES source choices and sentinel handling may yield different cohorts.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #21, #22, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** #109 — Inspect declared milestone intervals, #112 — Evaluate a multi-criterion completion norm

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
