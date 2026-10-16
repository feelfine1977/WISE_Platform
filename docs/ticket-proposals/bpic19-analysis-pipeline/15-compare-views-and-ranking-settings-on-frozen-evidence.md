# 15: Compare views and ranking settings on frozen evidence

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [117](https://github.com/feelfine1977/WISE_Platform/issues/117) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst compares explicit flat/layer-balanced views and gamma/ranking policies on already admitted norm definitions, sees changed score references and shortlist membership/order, then reopens both run identities.

## Current platform foundation and missing analyst behavior

A selected view is not a frozen sensitivity comparison. Analysts need distinct immutable runs for view/mode/gamma/ranking choices, references per view, exact shortlist membership and changed ordering, with evidence held fixed.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Freeze shared raw assessment evidence
2. Review exact per-criterion or historical layer weights
3. Compare mode/view or ranking-policy runs
4. Inspect reference and shortlist membership/order separately
5. Open a moved item/document and unchanged source witness
6. Save/export/reopen comparison pair

## Source evidence and limits

- WISE_12_10_2026.pdf, PDF29,36,39–40: three views, shortlist differences, gamma sensitivity and numerical verification
- WISE_BPIC19_full_analysis.ipynb, one-based cells6,12,14,18 (indices 5,11,13,17): separate historical four views, document overlaps, gamma 20 and weighted explanations

**Source-step cross-reference:** NB.C05, NB.C11, P15. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: paper entries are per-criterion weights, not target layer totals. Balanced fully evaluated flat layer masses are.3/.2/.3/.2.
- PANEL PRODUCT DECISION: alternative layer-balanced scoring retains the actual resolved raw weights and reports native layer masses. Any equal-total-layer reweighting is another declared norm, not merely a mode switch.
- SOURCE: paper view comparison uses top20 positive-priority documents; ranking-policy comparison uses top10 of30 company × spend area groups. They cannot share an unlabeled denominator.
- UNDEFINED INFERENCE GATE: gamma is shrinkage policy, not a confidence interval. No inferential significance or rank-certainty claim is supplied.

## Required core and conditional extensions

The approved bounded working behavior is required. Separately gated report methods are not automatically activated by this ticket.

## Extended user stories

### T15-S01

As a stakeholder analyst, I want to compare the three paper views on the same criterion evidence so that changed priorities can be attributed to reviewed weights.

**Preconditions:** One frozen raw evidence/population

**User actions:**

1. Review weights
2. Execute all views
3. Inspect moved priorities

**Expected outcome:** Evidence is shared while native weights, scores, references and runs are identified by view.

**Acceptance:** T15-AC01, T15-AC02; the common integration criteria also apply.

### T15-S02

As a methodological reviewer, I want flat and layer-balanced modes compared explicitly so that partial applicability cannot conceal a change in scoring meaning.

**Preconditions:** Admitted fixed norm and unequal-evidence fixture

**User actions:**

1. Review resolved raw weights and native layer masses
2. Compare modes
3. Inspect effective weights

**Expected outcome:** The selected mode and actual native normalization are visible and numerically distinct where expected.

**Acceptance:** T15-AC03; the common integration criteria also apply.

### T15-S03

As an analyst, I want gamma sensitivity on frozen scores so that small-group adjustment is distinguishable from changed measurements.

**Preconditions:** Native score run unchanged

**User actions:**

1. Choosegamma 0 and20
2. Read stable means/gaps/PI and reference
3. Compare shortlist

**Expected outcome:** Gamma creates a ranking-policy identity and does not imply statistical uncertainty.

**Acceptance:** T15-AC04; the common integration criteria also apply.

### T15-S04

As a reviewer, I want to compare shortlist membership and rank order separately so that an unchanged topN set is not called unchanged prioritization.

**Preconditions:** Two exact sorted lists with tie/boundary policies

**User actions:**

1. Inspect shared members
2. Read Jaccard and rank movement
3. Open new first-ranked document

**Expected outcome:** Different comparisons retain their distinct group definitions and capacities.

**Acceptance:** T15-AC05, T15-AC06; the common integration criteria also apply.

### T15-S05

As an analyst, I want subset inspection distinguished from subset rescoring so that selecting Packaging does not refit calibration or replace the reference.

**Preconditions:** Shared frozen parent run

**User actions:**

1. Select subset on stored scores
2. Optionally request an explicitly new subset run
3. Compare receipts

**Expected outcome:** Only a newly named assessment can change score/reference population; evidence selection preserves old identities.

**Acceptance:** T15-AC04, T15-AC07; the common integration criteria also apply.

### T15-S06

As a returning analyst, I want both comparison runs reopened after restart so that saved view and ranking choices remain reviewable.

**Preconditions:** Comparison pair and source evidence saved

**User actions:**

1. Export paired settings and common membership
2. Restart
3. Reopen both and inspect differing case

**Expected outcome:** Both run identities and their comparison receipt survive the highest seam.

**Acceptance:** T15-AC08; the common integration criteria also apply.

## Acceptance criteria

### Approved baseline retained

- [ ] **15-B01.** Changes create new norm/run or ranking-policy identities and state which population/assessments stay fixed.
- [ ] **15-B02.** Compare membership and order, including unchanged top-N membership with a different first rank.
- [ ] **15-B03.** Gamma is shrinkage, not uncertainty; subset rescoring is explicit and separate from selecting stored scores.
- [ ] **15-B04.** Existing admitted norms support sensitivity independently; historical29-check profile assembly is a separate slice25.
- [ ] **15-B05.** Unequal applicability, deterministic ties and a comparison with no common eligible support are independently checked.

### Exact domain and analyst acceptance

- [ ] **T15-AC01.** Given all ten paper criteria evaluable, When views are compiled, Then per-criterion layer entries are Balanced(1,1,1,1), Completion(3,2,1,1), Operations(1,1,2,3); raw tables and native effective weights are preserved. Evidence selectors/scopes do not change by view.
- [ ] **T15-AC02.** Given DF2 with only C04 deviation(69.040972-30)/60=d and C09/C10 unavailable, When full flat views score seven evaluated checks, Then Balanced=1-d/7, Completion=1-2d/14, Operations=1-d/10; coverage Balanced=7/9. Raw definitions and unavailable locations are identical.
- [ ] **T15-AC03.** Given DF2 with C02=1, C04=.5, C09/C10 unavailable and remaining five evaluated values 0, When only mode changes with unchanged paper raw weights, Then flat score=1-1.5/7=.7857142857 and native layer-balanced score=.75 (eligible layer raw masses3,2,3). If equal total layers are instead requested, Then a separately declared weight revision is required.
- [ ] **T15-AC04.** Given A=.9 and B=.95 singleton groups, When gamma changes from 0 to 1, Then raw scores and arithmetic reference=.925 stay fixed; A raw PI=.025 and stable PI=.0125. Gamma 20 uses native n/(n+20) shrinkage. No confidence interval is inferred.
- [ ] **T15-AC05.** Given full paper top-20 positive-priority document lists, When membership is checked, Then Balanced/Completion share 18, Balanced/Operations share 10 and Completion/Operations share 8. Jaccard values are 18/22≈.81818,10/30=1/3,8/32=.25. No tie at the selection boundary is claimed without exact rank verification.
- [ ] **T15-AC06.** Given Balanced penalties/reference and the 30 company × spend area groups frozen, When the primary top ten is compared with mean-penalty ranking, total-penalty ranking and gamma-20 PI, Then reported shared counts 6,4,10 are diagnostic source targets. First rank and complete order are also compared. The denominator is not twenty purchasing documents.
- [ ] **T15-AC07.** Given a stored-score subset selection, When it is inspected, Then scoring/calibration/reference identities remain the parent identities. Given an explicitly new subset assessment, Then a new run/definition of reference support records that change; no-common-eligible support is unavailable, not a fabricated correlation/overlap.
- [ ] **T15-AC08.** Given the stated literal fixture, the actual qualified packed Method and API/browser builds from one recorded revision, When the analyst imports through real HTTP, confirms the role/profile/population definition in the built browser, runs, inspects source witnesses, exports and saves, terminates the actual service process, starts a new process and reopens through HTTP and the built browser, Then the stated numeric values and exact identities/missing locations remain equal (numeric maximum absolute error <1e-8), frozen artifacts reopen without silently evaluating a new norm, and changed source/population/definition replies are refused or visibly stale. A React mock, isolated Method test, screenshot or successful pilot alone cannot close this criterion.

### Public behavior, evidence and durability

- [ ] **15-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **15-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **15-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **15-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **15-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **15-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **15-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** native norm and evidence population, view weights, flat or layer-balanced aggregation, gamma, ranking rule, top-N and tie rule.

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

- Source rounded overlaps are targets only after exact group/membership/boundary-tie verification.
- Historical Finance/Logistics/Compliance/Automation belongs to ticket25 and cannot be presented as renamed paper views.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #36, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** #115 — Rank business groups by actual Method priority

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
