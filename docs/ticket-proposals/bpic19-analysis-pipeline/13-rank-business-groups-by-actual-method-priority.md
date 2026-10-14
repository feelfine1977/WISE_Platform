# 13: Rank business groups by actual Method priority

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [115](https://github.com/feelfine1977/WISE_Platform/issues/115) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst ranks a declared company-by-spend-area population by count PI, sees the frozen reference and exact support, and opens the selected group’s full items.

## Current platform foundation and missing analyst behavior

Generic grouping/comparison exists. Public PI consumers must use an actual admitted multi-criterion run, arithmetic scored-item reference, exact scored support, named grouping and deterministic ranking without a browser scorer.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Choose one frozen admitted score run/reference
2. Review company × spend area grouping and missing contexts
3. Rank with actual native PI
4. Inspect support and relative shortfall
5. Open exact group members without rescoring
6. Export/save/reopen rank and reference

## Source evidence and limits

- WISE_12_10_2026.pdf, PDF23–26,35–36,40: arithmetic scored-item reference, PI, gamma, support, ties and leading groups
- WISE_BPIC19_full_analysis.ipynb, one-based cell14 (index 13, saved execution 35): company × spend area gamma 20 historical backlogs
- merged_reports.pdf, Report 12 PDF266–278 (printed 10–22): selected stratum associations are separate from a WISE relative-priority ranking

**Source-step cross-reference:** NB.C13, NB.C20, NB.C25, P10, P11. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: primary paper PI uses all scored PO items as arithmetic reference, gamma 0, company × spend area30 groups and minimum one scored item; missing labels retained.
- PANEL PRODUCT DECISION: drilling/selection is a view of frozen scores. A changed assessment/reference population is a separately identified run, not an implicit effect of selecting a group.
- SOURCE: count PI measures relative assessed shortfall scale, not financial loss, compliance probability or expected savings.
- UNDEFINED OWNERSHIP GATE: company/spend may not identify actual improvement ownership; missing/conflicting context requires a declared reducer/refusal.

## Required core and conditional extensions

The approved bounded working behavior is required. Separately gated report methods are not automatically activated by this ticket.

## Extended user stories

### T13-S01

As a business analyst, I want to rank company-by-spend groups from a declared score run so that size and assessed shortfall both guide my investigation.

**Preconditions:** Admitted native score run and exact reference membership

**User actions:**

1. Review grouping
2. Choose count multiplier and gamma 0
3. Rank

**Expected outcome:** Native PI uses scored-item count times positive arithmetic-reference score shortfall.

**Acceptance:** T13-AC01, T13-AC02; the common integration criteria also apply.

### T13-S02

As an analyst, I want to inspect the arithmetic reference and minimum-support rule so that filtering a table does not silently change the comparison.

**Preconditions:** Reference identity fixed

**User actions:**

1. Read included/unscored support
2. Apply minimum group support
3. Open a row

**Expected outcome:** Reference is computed before group support filtering; evidence selection retains stored scores.

**Acceptance:** T13-AC02, T13-AC03; the common integration criteria also apply.

### T13-S03

As a reviewer, I want missing and conflicting group fields visible so that no original items vanish or migrate to invented ownership.

**Preconditions:** All-record case-context invariance checked

**User actions:**

1. Open missing bucket
2. Inspect conflicts and source values
3. Review refusal or explicit partition policy

**Expected outcome:** Membership and missing/conflict counts are exact and group totals reconcile.

**Acceptance:** T13-AC04; the common integration criteria also apply.

### T13-S04

As an analyst, I want deterministic ranks including ties and zero values so that shortlist membership can be reproduced.

**Preconditions:** Native ranking settings reviewed

**User actions:**

1. Inspect equal PI groups
2. Change minimum support
3. Read zero PI rows

**Expected outcome:** Ties follow recorded policy and zero relative PI does not certify compliance.

**Acceptance:** T13-AC03, T13-AC05; the common integration criteria also apply.

### T13-S05

As a process analyst, I want to open a group’s complete original items so that I can investigate records without resampling or truncating histories.

**Preconditions:** Frozen group membership and source dictionary

**User actions:**

1. Inspect Packaging or a literal group
2. Select all group members
3. Open contrary/unscored cases separately

**Expected outcome:** Scored membership, complete-case histories and calibration/reference identity remain connected.

**Acceptance:** T13-AC04, T13-AC06; the common integration criteria also apply.

### T13-S06

As a returning analyst, I want to reopen ranks and memberships after restart so that the next reviewer sees the same comparison.

**Preconditions:** Group run and source artifacts saved

**User actions:**

1. Export rank/member manifest
2. Restart actual service
3. Reopen and inspect member

**Expected outcome:** Actual native numbers/reference and exact identities survive the highest seam.

**Acceptance:** T13-AC07; the common integration criteria also apply.

## Acceptance criteria

### Approved baseline retained

- [ ] **13-B01.** Use actual Method prioritisation on a named scored-item run, arithmetic item reference and explicit grouping reducers.
- [ ] **13-B02.** Missing groups, unscored items, minimum support, ties and zero PI retain their stated meanings.
- [ ] **13-B03.** Group count and positive reference shortfall explain the priority; a zero PI is not compliance.
- [ ] **13-B04.** Inspect/select the ranked row retains the original run/calibration and exact complete items.
- [ ] **13-B05.** Independent means/counts/gamma0 priorities and saved group membership pass the primary seam.

### Exact domain and analyst acceptance

- [ ] **T13-AC01.** Given scores A=.9 and B=.95 in separate singleton business groups, When native count PI runs with gamma 0, Then arithmetic reference=.925; A gap=.025 and PI=.025; B positive gap=0 and PI=0. Exposure does not weight this reference.
- [ ] **T13-AC02.** Given scores A=.9, B=.95, C=1, with A/B in group G and C in singleton H, When min_cases=2 removes H from the displayed backlog, Then reference remains (.9+.95+1)/3=.95 and G has count=2, mean=.925 and PI=.05. Computing reference only from retained group G would give .925 and wrongly erase its priority.
- [ ] **T13-AC03.** Given an item with no evaluable positive-weight criterion, When ranking runs, Then it is unscored and excluded from native means/count multipliers, with its original membership and reason reported separately. Zero PI rows remain distinguishable from unscored or absent rows.
- [ ] **T13-AC04.** Given missing company/spend and an all-record context conflict, When business grouping is requested, Then missing is an explicit retained category and conflicting context is refused or handled by a reviewed alternative definition; original member sets never silently use the first nonmissing event.
- [ ] **T13-AC05.** Given equal positive PI groups, When ranks are emitted, Then ties use descending scored count followed by ascending declared group keys, with missing-key ordering explicit. Given all mean scores at/above reference, Then their PI=0 and findings make no compliance/safety claim.
- [ ] **T13-AC06.** Given the qualified full paper source/profile, When company × spend area ranks are compared, Then exact source membership is Packaging company 0000 with 109,199 scored items and Logistics company 0000 with 5,242. Rounded source penalties .117624/.228143, reference penalty .101358 and PI 1,776.19/664.61 are checked within their rounding intervals after independent raw/native qualification; thresholds are not tuned to force them.
- [ ] **T13-AC07.** Given the stated literal fixture, the actual qualified packed Method and API/browser builds from one recorded revision, When the analyst imports through real HTTP, confirms the role/profile/population definition in the built browser, runs, inspects source witnesses, exports and saves, terminates the actual service process, starts a new process and reopens through HTTP and the built browser, Then the stated numeric values and exact identities/missing locations remain equal (numeric maximum absolute error <1e-8), frozen artifacts reopen without silently evaluating a new norm, and changed source/population/definition replies are refused or visibly stale. A React mock, isolated Method test, screenshot or successful pilot alone cannot close this criterion.

### Public behavior, evidence and durability

- [ ] **13-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **13-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **13-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **13-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **13-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **13-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **13-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** named existing native run, company/spend reducers, missing-group labels, reference population, minimum scored support, count PI and deterministic tie rule.

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

- The source paper supplies rounded group values; exact comparison requires unrounded current calculation receipts. Do not apply 1e-8 tolerance to rounded printed numbers.
- A different analysis population may have a different arithmetic reference, but must be explicitly named/versioned.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #14, #15, #41, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** #112 — Evaluate a multi-criterion completion norm

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
