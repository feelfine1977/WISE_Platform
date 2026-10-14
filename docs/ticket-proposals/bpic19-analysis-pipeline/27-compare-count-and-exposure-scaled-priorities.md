# 27: Compare count and exposure-scaled priorities

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [129](https://github.com/feelfine1977/WISE_Platform/issues/129) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst selects a reviewed exposure calibration and compares count/exposure multipliers for item groups and documents while holding item score means and the arithmetic reference fixed.

## Current platform foundation and missing analyst behavior

Native exposure support is separate from a reviewed platform workflow. Analysts must select an explicit value/calibration population and compare count/exposure multipliers while preserving scores, scored-item reference and shrinkage-count semantics.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Review the source value field and selected item reducer
2. Choose count or a named reviewed exposure multiplier
3. Freeze calibration on the declared base population
4. Compare multipliers while preserving item scores and the arithmetic reference
5. Inspect document contributions, raw rows and tied value bands
6. Export, save, actually restart and reopen the comparison

## Source evidence and limits

- WISE_BPIC19_full_analysis.ipynb, one-based cells4,11,14,40 (indices 3,10,13,39) and adjacent features/prioritization source: maxabs/P95 proxy; primary historical backlogs actually use count PI
- WISE_12_10_2026.pdf, PDF23–26,36,40: optional volume versus arithmetic reference; primary paper PI is count
- merged_reports.pdf, Report 12 PDF260,266 (printed 4,10): cumulative-value field and selected receipt-sum reducer; Report 13 PDF296–299: cumulative-value matching failed and interval approximation is not financial exposure

**Source-step cross-reference:** NB.C39. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: historical exposure is maximum absolute per-event cumulative net worth per item, divided by global P95 and clipped to [0,1]. The notebook’s primary backlog calls actually use count PI; exposure PI is a declared sensitivity extension.
- SOURCE/PANEL DISTINCTION: Report 15’s unique-event recipe, the panel unique-value recipe, Report 7’s first-creation compatibility and historical maximum-absolute exposure are distinct named definitions. creation_unique_event refuses repeated events even with equal values; creation_unique_value admits repeated equal finite values but refuses conflicts; first creation requires its source occurrence/order recipe. Ticket 27 consumes the exact ticket-9-admitted receipt without silently switching reducers.
- SOURCE/PANEL DISTINCTION: historical missing maximum-absolute exposure is filled with zero only with an explicit compatibility receipt. Reviewed exposure refuses missing/nonfinite measurements instead of letting a native skip-NaN sum yield zero. Negative creation value is refused unless separately admitted; maximum-absolute reduction preserves signed raw witnesses and produces a nonnegative magnitude.
- PANEL PRODUCT DECISION: exposure multiplies the same positive gap against the arithmetic item-score reference. An exposure-weighted reference is another profile. Tie-preserving value bands and historical rank-first bands are separately identified.
- UNDEFINED BUSINESS GATE: cumulative value, actual liability, currency, invoice matching and financial loss cannot be assumed from these proxies.

## Required core and conditional extensions

The approved bounded working behavior is required. Separately gated report methods are not automatically activated by this ticket.

## Extended user stories

### T27-S01

As a finance analyst, I want to choose a named exposure recipe so that priority units are distinguishable from item-count shortfall.

**Preconditions:** Source value meaning, unit and reducer are reviewed

**User actions:**

1. Review unique-event, unique-value, first-creation and maximum-absolute recipes admitted by ticket 9
2. Choose the exact exposure definition identity
3. Inspect raw source witnesses, multiplier units and limitations

**Expected outcome:** The proxy, calibration and value policies are explicit and do not imply financial loss.

**Acceptance:** T27-AC01, T27-AC02; the common integration criteria also apply.

### T27-S02

As an analyst, I want exposure to change only the native multiplier so that score and reference comparisons remain interpretable.

**Preconditions:** Native scores and the base arithmetic reference are frozen

**User actions:**

1. Compare count and exposure backlogs
2. Read unchanged item means
3. Inspect native volumes and priorities

**Expected outcome:** Scores and arithmetic reference are identical; only volume and scaled priority change.

**Acceptance:** T27-AC02, T27-AC03; the common integration criteria also apply.

### T27-S03

As a reviewer, I want calibration preserved across subsets so that opening a group cannot refit every exposure proxy.

**Preconditions:** Full base fit membership and raw values are recorded

**User actions:**

1. Open the calibration receipt
2. Select a stored-score subset
3. Inspect normalized values

**Expected outcome:** The original cutoff is reused; explicit recalibration creates another identity.

**Acceptance:** T27-AC04; the common integration criteria also apply.

### T27-S04

As an analyst, I want missing, negative and nonfinite values exposed so that a sum cannot silently turn unknown money into zero.

**Preconditions:** Complete value witnesses and quality states are available

**User actions:**

1. Inspect invalid-value items
2. Review legacy fill-zero versus reviewed refusal
3. Read unavailable group or refusal

**Expected outcome:** Unknown exposure stays unknown outside an explicit historical compatibility recipe.

**Acceptance:** T27-AC05; the common integration criteria also apply.

### T27-S05

As a procurement analyst, I want document exposure counted once per original item so that repeated cumulative observations do not multiply the scale.

**Preconditions:** Exact document/item membership and item reducer are reviewed

**User actions:**

1. Open the document
2. Inspect each item contribution
3. Compare count and exposure totals

**Expected outcome:** Each admitted item value contributes once; event sums are another definition.

**Acceptance:** T27-AC01, T27-AC06; the common integration criteria also apply.

### T27-S06

As an analyst, I want equal-value bands and historical rank-first bands labelled separately so that tie splitting does not imply distinct financial risk.

**Preconditions:** Band algorithm, fit membership and original order are recorded

**User actions:**

1. Inspect equal-value items
2. Choose a reviewed tie-preserving or historical recipe
3. Read exact band membership

**Expected outcome:** Bands retain explicit tie and proxy semantics without recalibrating scores or exposure.

**Acceptance:** T27-AC07; the common integration criteria also apply.

### T27-S07

As a returning reviewer, I want saved count and exposure results reopened after restart so that recalibration cannot change a priority silently.

**Preconditions:** Both runs and the frozen calibration are saved

**User actions:**

1. Export value rows and calibration membership
2. Stop and restart the actual service
3. Reopen both native backlogs

**Expected outcome:** The same score, reference, calibration, units and native result survive the full application seam.

**Acceptance:** T27-AC08; the common integration criteria also apply.

## Acceptance criteria

### Approved baseline retained

- [ ] **27-B01.** Creation-value and historical max-absolute95th-percentile proxies are distinct named calibrations with finite raw-value witnesses.
- [ ] **27-B02.** Multiplier, unit, calibration population, missing/negative policy and tied value bands are explicit; subset selection never recalibrates.
- [ ] **27-B03.** Exposure changes the multiplier only; an exposure-weighted score reference is a different profile.
- [ ] **27-B04.** Document totals avoid repeated-event double counting; absent valid exposure is unavailable rather than zero.
- [ ] **27-B05.** Independent count/exposure examples, exact member/value receipts and export/restart show the changed priority without changing input scores.

### Exact domain and analyst acceptance

- [ ] **T27-AC01.** Given two Create Purchase Order Item rows with values 100 and 100, When creation_unique_event is selected, Then exposure is unavailable because two source events exist. When creation_unique_value is selected with complete finite equal values, Then exposure=100. With values 100 and 120, unique value is unavailable; an explicitly selected first-creation recipe returns the value of its declared first witness (100 in the specified order). Given one unique creation value 10 followed by cumulative observation 20, unique event/value exposure is 10 while maximum-absolute exposure is 20. The analyst selects the exact ticket-9-admitted recipe identity; none silently substitutes for another.
- [ ] **T27-AC02.** Given native scores A=.9 and B=.95 with arithmetic reference .925 and creation exposures 10/90 EUR, When count and exposure priorities are compared at gamma 0, Then A has count volume 1 and PI .025, exposure volume 10 EUR and exposure PI .25 EUR-score units; B has zero positive gap and PI 0. Item means remain A=.9 and B=.95; only the common arithmetic reference is .925, and all three values stay unchanged. This is not an estimate of financial loss or achievable savings.
- [ ] **T27-AC03.** Given A=.9 and B=.95 in document D, outside item C=1, and creation exposures 10/20/90 EUR, When document priorities are compared, Then item-level reference=.95, D mean=.925, count volume=2, count PI=.05, exposure volume=30 EUR and exposure PI=.75 EUR-score units. Each item value contributes once despite repeated event observations.
- [ ] **T27-AC04.** Given a full calibration population with maximum absolute values 10 and 20, When linear P95 is frozen, Then cutoff=19.5 and normalized values are 10/19.5 and 1. Selecting only the first item keeps cutoff 19.5 and the same normalized value, rather than implicitly fitting cutoff 10. The receipt includes exact fit members, quantile method, unit, source field and missing-value policy.
- [ ] **T27-AC05.** Given a scored item with missing or nonfinite exposure, When reviewed exposure ranking is requested, Then a typed refusal or unavailable result is returned; native sums must not silently skip NaN and turn missing exposure into zero. Negative creation value is refused unless a separately reviewed signed-liability recipe exists. Historical fill-zero compatibility is explicitly labelled with its missing-case counts and original rows. The negative-value refusal applies to creation-value exposure. Maximum-absolute reduction retains a negative signed raw witness and admits its nonnegative absolute magnitude.
- [ ] **T27-AC06.** Given document siblings with creation values 10 and 20 and three cumulative observations of 10 for the first item, When creation-based document exposure is summed, Then document total is 30, not 50. A receipt-sum or event-sum definition is separately named/versioned and does not inherit creation/max-absolute semantics.
- [ ] **T27-AC07.** Given five equal item exposures, When reviewed value bands are requested, Then equal values stay in one band or the requested split is reported as unseparable. A historical rank-first qcut compatibility choice may divide ties only with explicit original-order/tie and population receipts. Selecting a band does not refit calibration or change item scores. This tie policy is a panel product decision, not a supplied universal report algorithm.
- [ ] **T27-AC08.** Given frozen count/exposure runs and their reviewed calibration in the matching built application, When the analyst inspects raw value contributions, exports and saves, actually stops the service, observes exit, starts a fresh process and reopens through HTTP and browser, Then exact item/document membership, raw value rows, scores, arithmetic reference, calibration identity, units and native priorities remain unchanged (finite numerical tolerance 1e-8; identities/states/counts exact). A corrupt/missing receipt refuses and cannot silently fit a new calibration.

### Public behavior, evidence and durability

- [ ] **27-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **27-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **27-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **27-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **27-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **27-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **27-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** named existing run and reference, creation or max-absolute exposure definition, frozen parent calibration and P95 quantile policy, missing/negative/zero exposure treatment, count versus exposure multiplier.

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

- Each creation recipe has its own event/value uniqueness and occurrence policies. Report 15 unique event and Report 7 first creation remain source-specific; unique value is an explicit panel/product choice. No recipe establishes financial liability without business evidence.
- A zero P95 population needs an explicit policy: historical q95-or-1 fallback is compatibility; a reviewed alternative refuses or records its own zero-value policy.
- Approximate weighted-timestamp intervals cannot prove monetary matching or financial-exposure parity.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #14, #38, #41, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** #111 — Review source-witnessed item-value definitions, #118 — Inspect count priorities at document grain

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
