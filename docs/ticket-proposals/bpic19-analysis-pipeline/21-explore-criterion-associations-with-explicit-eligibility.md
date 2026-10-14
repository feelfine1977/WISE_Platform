# 21: Explore criterion associations with explicit eligibility

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [123](https://github.com/feelfine1977/WISE_Platform/issues/123) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst compares one target group’s criterion prevalence, severity and co-occurrence with its comparator, sees support/dependence limitations and opens affected full items.

## Current platform foundation and missing analyst behavior

Generic context composition does not provide criterion-local or jointly eligible association denominators. Analysts need declared prevalence/severity/co-occurrence statistics linked to the actual run, exact target/comparator membership and raw witnesses.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Choose one frozen native Method run, criterion definitions, target population and explicit comparator.
2. Review criterion-local scope/availability and the positive-deviation threshold before any association table.
3. Compare total-population prevalence, eligible firing, conditional severity, eligible mean and actual contribution.
4. Compute pair overlap/lift only on named jointly eligible items; expose support and dependence.
5. Open intersection, union, missing and comparator counterexample items in full original history.
6. Save formulas, minimum support, run and target/comparator identities, then restore in a new process.

## Source evidence and limits

- Notebook cells27/29/31 (zero-based; executions44/45/46), wise_eval/explain.py:52–116 and122–153: total-case fire rates, eligible mean severity, co-occurrence with N/A as false, minimum support, pooled sample-SD Cohen d.
- Notebook cell29 min_support=max(20,int(selected_case_count*0.02)); cell27 penalty_mass is unweighted eligible-case mean, not view-weighted sum. explain.py:145–148 returns d0 when pooled SD0.
- Notebook cells8/17/25/41 and revised WISE paper pp26–28,36,40–41: descriptive drivers and native score context; paper and notebook scoring profiles are distinct.
- Merged reports PDF pp201–209 (R09), pp279–280 (R12) and pp337–339 (R14): contextual associations/rework/improvement interpretation, without proof of causality.

**Source-step cross-reference:** R04.08, R09.04, NB.C08, NB.C27, NB.C29, NB.C41. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: notebook fire_rate includes all selected items; eligible means exclude N/A. penalty_mass in cell27 helper equals eligible mean, despite its documentation. Notebook pair calculations treat N/A as nonfiring and use total selected n.
- PANEL DEFAULT: fire is bounded native deviation>0. Report eligible/in-scope/unavailable/outside-scope support separately; default pair universe is the intersection of evaluable positive-weight criterion populations. Jaccard and lift use this same joint universe.
- PANEL DEFAULT: minimum jointly firing support20 orfloor(0.02*Ntarget), whichever larger, is the source-compatible production choice; the reviewed small-fixture mode sets threshold1 explicitly. Suppressed pairs are listed with support/reason rather than silently disappearing.
- PANEL DEFAULT: mean finite severity and total severity are unweighted descriptors. View contributions come from the actual named Method result and its applicability renormalisation; there is no parallel platform scorer.
- PANEL DEFAULT: first finite-population contrast is mean difference and firing-proportion difference with exact support, without p-values or causal labels. Optional pooled sample-SD Cohen d is separately named; pooled SD0 yields unavailable rather than source legacy0. Deterministically derived counts/ramps expose a lineage dependency flag.
- SOURCE-UNDEFINED: source prose calling lift a structural mechanism or root cause is interpretation, not validated causal evidence. Corrected jointly eligible calculations are a new product recipe, not a claim to reproduce every saved notebook number.

## Required core and conditional extensions

The named finite panel default plus complete reviewed-input→real HTTP→built-browser→raw-evidence/export/save→actual fresh-PID restart acceptance is required. Source-compatible alternatives are separate identified definitions; unavailable source gates cannot be presented as reproduced methods.

## Extended user stories

### 21-US01

As a process-improvement analyst, I want total and eligible firing rates separately so that missing evidence cannot be presented as a satisfied criterion.

**Preconditions:** Native Method run and criterion states known.

**User actions:**

1. Choose target and comparator.
2. Inspect denominator columns.
3. Open unavailable items.

**Expected outcome:** A target total prevalence0.4 differs from eligible firing0.5; missing states stay separate.

**Acceptance:** 21-AC01; the common integration criteria also apply.

### 21-US02

As a data analyst, I want pair co-occurrence calculated on jointly eligible items so that differing criterion scope does not manufacture overlap or lift.

**Preconditions:** Pair A/B and target five items frozen.

**User actions:**

1. Review joint eligibility.
2. Inspect intersection/union.
3. Compare explicitly labelled legacy whole-population recipe.

**Expected outcome:** Joint lift1.5/Jaccard0.5 differ from legacy lift1.25/Jaccard1/3.

**Acceptance:** 21-AC02; the common integration criteria also apply.

### 21-US03

As a stakeholder, I want raw severity means and actual native view contributions labelled separately so that a high mean is not confused with total weighted impact.

**Preconditions:** Selected run has resolved flat weights0.75/0.25.

**User actions:**

1. Compare criterion means/sums.
2. Open native contribution decomposition.

**Expected outcome:** Unweighted severity sum3 differs from actual summed view penalty1.875.

**Acceptance:** 21-AC03; the common integration criteria also apply.

### 21-US04

As a statistics reviewer, I want support thresholds, zero-support states and descriptive effect formulas visible so that a ranking cannot imply an unsupported causal mechanism.

**Preconditions:** Small or deterministic-related criterion pair exists.

**User actions:**

1. Change minimum support.
2. Inspect zero-support pair.
3. Read dependency receipt.

**Expected outcome:** Below-threshold row is suppressed with reason; undefined ratios remain unavailable and deterministic dependence is disclosed.

**Acceptance:** 21-AC04, 21-AC05, 21-AC06; the common integration criteria also apply.

### 21-US05

As an analyst, I want exact target/comparator and affected-item witnesses so that the same observations can be verified in full histories.

**Preconditions:** Target/comparator definitions and eligibility are frozen.

**User actions:**

1. Select A/B intersection.
2. Inspect an unavailable target.
3. Open a comparator counterexample.

**Expected outcome:** Exact member lists and full source evidence, no inferred event pruning or causal diagnosis.

**Acceptance:** 21-AC01, 21-AC02, 21-AC07; the common integration criteria also apply.

### 21-US06

As an analyst returning to a saved comparison, I want run identity, eligibility and formulas restored so that results remain reproducible after restart.

**Preconditions:** Association table and selections exported/saved.

**User actions:**

1. Stop actual server process.
2. Start distinct process.
3. Reopen and compare values.

**Expected outcome:** Exact counts/states/members and formulas; native finite values agree within 1e-8; legacy mode never silently replaces the reviewed mode.

**Acceptance:** 21-AC08; the common integration criteria also apply.

## Acceptance criteria

### Approved baseline retained

- [ ] **21-B01.** Total-case prevalence and jointly eligible firing/support denominators are distinct; N/A never silently becomes satisfied.
- [ ] **21-B02.** Unweighted eligible mean severity, summed mass and actual view-weighted contribution are named correctly.
- [ ] **21-B03.** Lift/Jaccard and finite-population magnitude retain parameter/support/target/comparator identities.
- [ ] **21-B04.** Deterministically related features and undefined zero support are labelled; no causal root-cause or inferential claim is generated.
- [ ] **21-B05.** Independent eligibility/missing/derived-dependence examples and saved evidence reconcile.

### Exact domain and analyst acceptance

- [ ] **21-AC01.** Given target T=[t1,t2,t3,t4,t5], A=[0.5,0,NA,1,0], B=[1,NA,0.5,0,0], when prevalence runs, then A total support5/eligible4/fired2/unavailable1, total-case prevalence2/5=0.4, eligible firing2/4=0.5, mean eligible severity1.5/4=0.375, mean when fired1.5/2=0.75, unweighted summed severity1.5. B has the same supports/rates/mean but different unavailable member. NA is never exported as satisfied0.
- [ ] **21-AC02.** Given the preceding target, when A/B jointly eligible co-occurrence runs with min_support1, then joint IDs=[t1,t4,t5], N=3, A fire IDs=[t1,t4], B fire IDs=[t1], intersection=[t1], union=[t1,t4], support1, Jaccard1/2=0.5, lift=(1/3)/((2/3)*(1/3))=1.5. Explicit legacy total-case mode has N5, intersection1, union3, Jaccard1/3 and lift1.25, under a different definition.
- [ ] **21-AC03.** Given actual native flat weights A0.75/B0.25 and those criterion-local states, when contributions are requested, then native item penalties are[t1=0.625,t2=0,t3=0.5,t4=0.75,t5=0], summed penalty1.875, A contribution1.125 and B contribution0.75. Unweighted A+B severity sum3 remains separately labelled; no eligible mean is named total weighted mass.
- [ ] **21-AC04.** Given the A/B pair support1, when minimum support2 is chosen, then the pair is omitted from ranked accepted rows but appears in suppressed support with reason support_below_minimum and exact intersection[t1]. Given a jointly eligible criterion never fires, lift and any zero-union Jaccard are unavailable zero_support; they are not manufactured0 or1.
- [ ] **21-AC05.** Given comparator C=[c1,c2] has A=[0.25,0], when finite-population contrast runs, then comparator eligible mean0.125 and target eligible mean0.375 yield mean_difference+0.25; comparator eligible firing0.5 and target0.5 yield0, while total-case prevalence target0.4 versus comparator0.5 yields-0.1. The named denominators accompany each difference and no inferential confidence or cause is claimed.
- [ ] **21-AC06.** Given target feature values all1 and comparator all0, when optional pooled-SD standardised magnitude runs, then mean difference1 is available but pooled SD0 makes Cohen d unavailable zero_pooled_variance; default does not outputd0. Given an input count and its deterministic threshold ramp are associated, then dependency flag deterministic_derived is attached with feature lineage; high lift is not evidence of an independent cause.
- [ ] **21-AC07.** Given the intersection[t1] or missing A member[t3] is selected in the association table, when Keep/Inspect runs, then the selection names complete original item IDs and every original record; the exact native criterion witness, outside-scope/unknown state and comparator membership can be reopened.
- [ ] **21-AC08.** Given saved target/comparator and native Method run, when the actual server OS process exits and a new PID opens the workspace, then denominator populations, positive threshold, support cutoff, statistic formula, recipe mode and member/witness IDs agree exactly with export; finite native values agree within 1e-8 and unavailable native bindings refuse without substitute scoring.

### Public behavior, evidence and durability

- [ ] **21-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **21-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **21-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **21-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **21-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **21-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **21-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** target/comparator membership, named existing norm/run, criterion-positive threshold, criterion and jointly eligible pair denominators, minimum support, descriptive statistic formula.

## Required qualification receipts

- Browser interaction on the matching application host, showing reviewed input fields, population, chosen definition, availability and exact source-witness navigation; screenshot/state receipt is separate from source inspection.
- Actual typed HTTP requests and responses from the registered operation, including source/preparation/representation/case-dictionary/population and query revision; independently hand-worked expected values.
- Complete-history evidence receipt: raw row IDs, original cells and all parent item records remain present when an episode, rule activation, signature or temporal peak is inspected.
- Exported frozen definition, source SHA-256, method/profile/operator IDs and versions, parent/selected member IDs or resolvable membership hash, units, availability/support and current-run outputs.
- Immutable investigation revision saved through the existing persistence seam; no second findings store and no executable notebook text in a recipe.
- Actual server OS process stop, wait for termination, start a new OS process, reopen the same workspace in the browser and compare exact saved memberships/definitions/result values/record witnesses/export hashes. A second TestClient, remount, page refresh or same-process cache miss is insufficient.
- Negative requests (wrong population, altered source, unknown definition/version, malformed roles, stale revision) receive typed refusals and never publish as the currently selected answer.

Each receipt identifies the candidate source/build, input and definition identities, independently expected versus actual values, public HTTP and built-browser actions, stable export/save references, observed first-process exit and distinct second-process reopening. Component or synthetic tests do not establish full-source capacity; report the elapsed time, peak memory and output/payload sizes for each full-source action that this ticket requires.

## Remaining gates and closure rule

- Unreported cohort/dependence, feature selection and multiple-comparison settings gate inferential/root-cause claims, not these explicitly descriptive finite outputs.
- Exact notebook reproduction keeps its legacy total-denominator and zero-variance conventions under a separate version; the corrected default must not overwrite that historical result.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #15, #35, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** #112 — Evaluate a multi-criterion completion norm

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
