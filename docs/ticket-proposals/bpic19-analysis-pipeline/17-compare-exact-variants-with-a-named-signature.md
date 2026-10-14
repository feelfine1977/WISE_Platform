# 17: Compare exact variants with a named signature

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [119](https://github.com/feelfine1977/WISE_Platform/issues/119) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst compares one named simplified activity representation with exact repeated sequences and can return to all original occurrences and supporting items.

## Current platform foundation and missing analyst behavior

Exact ordered variants exist. The notebook's global first-occurrence activity signature and its scored-support mass must be admitted as a different representation with raw suppressed-occurrence lineage; generic abstraction remains separately bounded.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Open the retained raw PO-item population and choose a named sequence representation beside the exact baseline.
2. Review the label map, suppression and ordering/tie policy before recomputing support.
3. Compare exact and simplified group membership, repeated-event witnesses and case/event/variant coverage.
4. Inspect a signature member in its complete original item history, including hidden steps and repeated occurrences.
5. Join only the selected native Method score run and keep total versus scored support separate.
6. Save the representation/comparison recipe and reopen the exact membership and raw witnesses in a new process.

## Source evidence and limits

- Notebook cell37 (zero-based; execution49), variant_severity_table in wise_eval/explain.py:253–277: pd.unique removes all repeated labels, including nonconsecutive loops; cases×mean penalty is used for mass.
- Merged reports PDF pp149–152 (R07): unique ordered paths, top15, separate case/event/variant coverage. PDF p343 footnote4 and pp344–347 (R15): equivalence collapses repetitions at exactly the same instant; first-cycle maps and Service repetition analysis.
- Merged reports PDF pp165–167 (R08): removing external/rework/rare activities changes discovery input; original and filtered activity paths have distinct meaning.

**Source-step cross-reference:** R15.12, NB.C37. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- CORE BOUNDARY: Exact plus FirstOccurrence is mandatory core17. AdjacentSameTimeCollapse and selected-label omission are conditional separately admitted definitions; they are not arbitrary general abstraction activated by this ticket.
- SOURCE: notebook calls its pd.unique result a variant; the actual operation is global first-occurrence label deduplication, not exact variants.
- SOURCE: R15 collapses repeated same-label events at the same moment; it does not specify a complete rule for separated equal-time repeats.
- PANEL DEFAULT: stable reviewed baseline order; first-occurrence dedup removes later occurrences globally. Same-time recipe v1 collapses only consecutive same-label runs with identical interpreted timestamps. This adjacency restriction is a panel choice and is not attributed to R15.
- PANEL DEFAULT: analytical projection preserves suppressed raw-row paths and raw-gap/directness evidence. Case membership never changes merely by selecting a representation.
- PANEL DEFAULT: total penalty is sum over scored members, mean denominator is scored members, and unscored support is separately reported. Source-compatible legacy size×mean is an explicitly labelled optional reproduction, not the default.

## Required core and conditional extensions

Core closure is Exact baseline plus globally first-occurrence signature, their support/scored-support/witness comparison and actual fresh-process save/reopen. Same-time collapse, label grouping and omission projections are named separate admission extensions under ledger X01/X28 and #31/#5 amendments; showing unsupported state is not reproducing those analyst methods.

## Extended user stories

### 17-US01

As a process analyst, I want exact and first-occurrence paths side by side so that I can see which loops simplification removes.

**Preconditions:** Prepared, reviewed event order and full original histories.

**User actions:**

1. Choose Exact baseline.
2. Choose First occurrence.
3. Open suppressed-row evidence.

**Expected outcome:** Exact [A,B,B,B,A] differs from signature [A,B]; all five rows remain.

**Acceptance:** 17-AC01, 17-AC02; the common integration criteria also apply.

### 17-US02

As a process-mining analyst, I want same-time repetition collapse as a separate selectable recipe so that burst logging is not confused with later rework.

**Preconditions:** Core17 is ready; a specifically named SameTimeCollapse definition is independently admitted under the ledger amendment, or the UI shows its unsupported state.

**User actions:**

1. Inspect admission status of the named AdjacentSameLabelSameTime v1 recipe.
2. When admitted, select it and compare with core FirstOccurrence.
3. Otherwise retain the source-method gate and continue exact/signature analysis.

**Expected outcome:** When admitted, SameTime=[A,B,B,A] differs from FirstOccurrence=[A,B]; if not admitted, typed unsupported state and source locator are shown without fabricated output or full R15 parity claim.

**Acceptance:** 17-AC01, 17-AC02; the common integration criteria also apply.

### 17-US03

As a data analyst, I want hidden intermediate steps and gaps to stay traceable so that a projected arrow is not presented as an observed direct transition.

**Preconditions:** Core17 plus an independently admitted selected-label omission definition under ledger X01/#31; otherwise visible unsupported state.

**User actions:**

1. Review the projection that suppresses X.
2. Inspect the A→B projected connection.

**Expected outcome:** A→B is projected; raw direct support for A→B is zero; raw witnesses rA,rX,rB are available.

**Acceptance:** 17-AC03; the common integration criteria also apply.

### 17-US04

As a process-improvement analyst, I want signature rankings to separate total support from scored support so that unscored items do not inflate penalty mass.

**Preconditions:** Native Method run with two scored and one unscored signature members.

**User actions:**

1. Join the frozen score run.
2. Sort by summed penalty.
3. Open the unscored-member list.

**Expected outcome:** Total support3, scored support2, mean penalty0.5 and mass1.0; no fabricated mass1.5.

**Acceptance:** 17-AC04; the common integration criteria also apply.

### 17-US05

As a data analyst, I want missing labels or unknown event order to be reported separately so that a partial path is not counted as a complete exact variant.

**Preconditions:** One case has a missing timestamp; another has a missing activity.

**User actions:**

1. Open representation availability.
2. Inspect unresolved cases.

**Expected outcome:** Neither becomes the empty path or an exact known variant; raw case/record membership stays unchanged.

**Acceptance:** 17-AC05; the common integration criteria also apply.

### 17-US06

As an analyst returning to a saved investigation, I want the representation and current-run score join restored so that the same groups and witnesses can be audited after a restart.

**Preconditions:** A representation comparison is saved and exported.

**User actions:**

1. Stop the server process.
2. Start a fresh process.
3. Reopen and compare the export.

**Expected outcome:** Same representation IDs, source members, suppressed row IDs and score-run identity; no stale charts.

**Acceptance:** 17-AC06, 17-AC07; the common integration criteria also apply.

## Acceptance criteria

### Approved baseline retained

- [ ] **17-B01.** Exact variants retain every repeated activity and raw-gap semantics.
- [ ] **17-B02.** First-occurrence signatures and same-time repetition collapse are labelled transformations with different identities.
- [ ] **17-B03.** One admitted projection reports what it suppresses; no hidden step becomes an observed direct passage.
- [ ] **17-B04.** Groups and selection preserve full original item histories, distinct support and reversible baseline.
- [ ] **17-B05.** Loop/tie counterexamples and changed representation identities survive save/reopen.

### Exact domain and analyst acceptance

- [ ] **17-AC01.** Given one item r1=A@00:00,r2=B@01:00,r3=B@01:00,r4=B@02:00,r5=A@03:00, when core17 runs, then Exact=[A,B,B,B,A] and FirstOccurrence=[A,B], signature suppressed rows=[r3,r4,r5]. The raw item still contains five records and the two derived representations have distinct identities.
- [ ] **17-AC02.** Given two items [A,B,B] and [A,B], when exact support is compared with first-occurrence support, then exact has two variants each with one item, signature has one group with two distinct items; total original record support remains5 and repeated membership never doubles a case.
- [ ] **17-AC03.** Given raw rA=A@0,rX=X@1,rB=B@2 and a specifically named selected-label omission extension independently admitted under X01/#31, when removing X is requested, then projected A→B has raw-direct support0/projected support1, raw_order_distance2/intervening_record_count1 and witness[rX]. Inspect opens all three raw rows. If the extension is not admitted, return typed unsupported_definition; core exact/signature support continues and no projected arrow is fabricated.
- [ ] **17-AC04.** Given a signature with native Method penalties[0.2,0.8,null], when ranking runs, then total_case_support=3, scored_case_support=2, unscored_case_support=1, mean_penalty=0.5, summed_penalty_mass=1.0. No value1.5 is labelled actual penalty mass.
- [ ] **17-AC05.** Given item U has one missing timestamp and item V has one missing activity label, when exact/signature computation is requested, then U is order_unknown and V is missing_activity_label; both remain in unavailable support and raw evidence. A literal blank context value remains missing and does not infer a flow from the path.
- [ ] **17-AC06.** Given a saved exact/signature comparison, when the actual server OS process is terminated and a fresh server process starts, then opening the existing investigation restores the same selected IDs, raw/suppressed row IDs, recipe versions and native score-run ID; no recomputation from a different source or current global directory is substituted.
- [ ] **17-AC07.** Given unchanged source rows, when core definition changes from Exact to FirstOccurrence, then derived representation identities differ and previous saved revisions remain immutable. Changing to AdjacentSameLabelSameTime requires its separate admission; if admitted its identity differs and output[A,B,B,A] suppresses only[r3], otherwise visible unsupported_definition and retained source gate are required. Viewport-only changes do not change analytical identity.

### Public behavior, evidence and durability

- [ ] **17-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **17-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **17-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **17-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **17-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **17-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **17-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** exact representation or first-occurrence signature, ordered occurrence policy, raw-to-derived lineage, ranking metric, total versus scored support.

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

- R15 nonadjacent equal-time equivalence remains an exact source-reproduction gate; the panel adjacent-run default is complete and testable now.
- Miner-specific use of projected paths is an independently admitted operation; a simplified group alone does not qualify discovered-model equivalence.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #13, #31, #68, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** None; can start on existing qualified foundations.

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
