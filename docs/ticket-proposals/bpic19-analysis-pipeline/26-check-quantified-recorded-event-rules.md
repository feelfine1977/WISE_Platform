# 26: Check quantified recorded-event rules

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [128](https://github.com/feelfine1977/WISE_Platform/issues/128) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst evaluates one named occurrence-quantified precedence/response rule, opens each activation and selected partner or violation, and compares occurrence-level results with affected-item support.

## Current platform foundation and missing analyst behavior

Current stated-rule groups are a foundation. Every-occurrence versus some-occurrence response/precedence, direct/eventual, reuse/consumption, ties, vacuity and unknown chronology need explicit inspectable public operators and optional actual Method binding.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Select one named recorded-event rule with exact activator/partner labels and optional explicit flow scope.
2. Review precedence/response, direct/eventual, some/every, tie, vacuity and partner reuse/consumption.
3. Inspect each activation, chosen partner, known nonmatch and unknown chronology with raw row witnesses.
4. Compare occurrence-level support with affected complete original items and existential versus universal results.
5. Keep/inspect counterexamples without converting recorded absence into future obligation or an unreviewed normative breach.
6. Save the rule definition and evidence; only separately admitted actual Method binding may grade it; replay after a fresh process starts.

## Source evidence and limits

- Merged reports PDF pp223–225 (R10): authors Python library explicitly extends default one-occurrence precedence/response to every requesting activity; Table2 single occ.True is default and False is all-occurrence. Responses omitted from reported compliance because open cases can drive apparent violations.
- Merged reports PDF pp181–182 (R08): Disco direct/eventual follower filters, repeat exclusions, invoice-before-GR candidates306, DF2 block-removal candidates291=263premature+28absent, duplicate-clearing626 and cancellation→clearing2,492 with follow-up split769/1,723.
- Merged reports PDF pp138–140 (R06): category-conditional mandatory events and release order; before-GR GR-first does not automatically require block removal.
- Merged reports PDF pp346–347 (R15): every Clear Invoice cycle must satisfy chronological patterns, shared creation reused, other activities matched kth; simultaneous events accepted regardless source position.
- Revised WISE paper AppendixB pp34–36: C05 is earliest-invoice versus earliest-receipt for DF1, not every-occurrence matching; raw descriptive rules and actual Method normative grading remain distinct.

**Source-step cross-reference:** R06.05, R07.06, R08.09, R10.05, R10.06, R14.10, R15.05. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: R08 follower filters are high-level existential/case filters with repeat exclusions; its reported no-violation conclusion is not an occurrence-universal proof. R15 every-cycle timestamp/ordinal pattern is another precise family. Paper C05 independent minima is neither family.
- PANEL DEFAULT: A→B response activates A and seeks later B; A→B precedence activates B and seeks earlier A. The API separately names activation and partner sets so the direction cannot be inferred from a chart label. Finite v1 exposes raw-direct/eventual, some/every, ties, vacuity and reuse/consumption.
- PANEL DEFAULT: eventual response uses earliest eligible timestamp>=activation for allow-equal, >activation for strict; precedence uses latest eligible timestamp<=activation or<activation. Equal-time partners may occur on either raw position because this definition is timestamp-based; distinct raw row required. Tied candidate representatives use reviewed eventID/source position and export every tied candidate. Raw direct instead means next/previous original ordered record, never a filtered projection.
- PANEL DEFAULT: activations process in reviewed timestamp/eventID/source-position order; consume mode greedily marks each chosen partner once, reuse mode allows the same partner. No activation yields knownNotActivated with satisfied=null by default; a separate logical-vacuity version can report vacuously true without claiming observed evidence.
- PANEL DEFAULT: three-valued local evidence is T for a confirmed eligible witness, F for proved recorded nonmatch given complete relevant candidate evidence, U when needed activity/time/assignment remains unknown. Reusable some=T if anyT, otherwiseU if anyU or additional activation support unknown, otherwiseF for nonempty support; every=F if anyF, otherwiseU if anyU or additional activation support unknown, otherwiseT for nonempty support. Empty known support uses NotActivated by default. Missing labels can make total activation count unknown without erasing confirmed witnesses. Unknown potentially closer partners qualify representative status as nearest_unresolved while preserving the confirmed existence witness. Consumptive allocation uncertainty is a separate local assignment state. No future or overdue obligation is inferred; normative grading still requires actual Method admission.

## Required core and conditional extensions

The named finite panel default plus complete reviewed-input→real HTTP→built-browser→raw-evidence/export/save→actual fresh-PID restart acceptance is required. Source-compatible alternatives are separate identified definitions; unavailable source gates cannot be presented as reproduced methods.

## Extended user stories

### 26-US01

As a process analyst, I want some-activation and every-activation results separately so that one valid invoice cycle cannot hide a later unmatched occurrence.

**Preconditions:** Known recorded chronology and exact labels.

**User actions:**

1. Choose eventual response.
2. Compare some/every.
3. Open unmatched activations.
4. Switch direction to precedence and review which activity becomes the activator.

**Expected outcome:** Some=true but Every=false on[A,B,A]; one matched and one unmatched activation.

**Acceptance:** 26-AC01, 26-AC09; the common integration criteria also apply.

### 26-US02

As a process-mining analyst, I want raw direct rules distinguished from eventual or projected rules so that hidden intermediate activities cannot create a direct passage.

**Preconditions:** Raw[A,X,B,A] and an optional label projection.

**User actions:**

1. Run raw direct rule.
2. Run eventual rule.
3. Inspect intervening X.

**Expected outcome:** Direct matches0 versus eventual1; raw X remains a witness and never disappears from direct semantics.

**Acceptance:** 26-AC02; the common integration criteria also apply.

### 26-US03

As a data analyst, I want partner reuse, consumption and same-time choices explicit so that repeated activations do not borrow the same evidence unnoticed.

**Preconditions:** Repeated/tied events exist.

**User actions:**

1. Choose reuse or consume.
2. Compare same-time strict/allow choices.
3. Open selected row IDs.

**Expected outcome:** Deterministic partners/use counts differ under separate identities; valid zero-time partners remain possible.

**Acceptance:** 26-AC03, 26-AC04; the common integration criteria also apply.

### 26-US04

As a process-improvement expert, I want no activation, missing chronology and open-horizon absence separated so that a future obligation is not inferred from a finite snapshot.

**Preconditions:** No-activation and unknown-time fixtures exist.

**User actions:**

1. Open vacuity policy.
2. Inspect unknown activation.
3. Read observation horizon.

**Expected outcome:** Confirmed matches remain T despite unrelated unknown data; existential/universal use the explicit T/F/U table, NotActivated stays distinct, and no future breach is inferred.

**Acceptance:** 26-AC05, 26-AC06, 26-AC10, 26-AC11; the common integration criteria also apply.

### 26-US05

As an investigator, I want per-occurrence witnesses and affected-item support so that I can inspect a rule counterexample in the complete source case.

**Preconditions:** Rule result and full histories retained.

**User actions:**

1. Select unmatched activation.
2. Keep affected item.
3. Inspect all raw rows.

**Expected outcome:** Occurrence count2 differs from affected item count1; all original item records and exact partner/activation IDs remain.

**Acceptance:** 26-AC01, 26-AC02, 26-AC07; the common integration criteria also apply.

### 26-US06

As an analyst returning to a scored investigation, I want the saved descriptive rule and actual Method admission restored so that unsupported normative meaning cannot be replaced on replay.

**Preconditions:** Rule and optional admitted Method binding saved/exported.

**User actions:**

1. Stop original server process.
2. Start fresh process.
3. Reopen rule and optional score.

**Expected outcome:** Exact rule/states/witnesses/members; absent binding returns typed refusal while descriptive evidence stays available.

**Acceptance:** 26-AC08; the common integration criteria also apply.

## Acceptance criteria

### Approved baseline retained

- [ ] **26-B01.** Existential versus every-occurrence, direct versus eventual, vacuity, partner reuse/consumption and tie policies are explicit definitions.
- [ ] **26-B02.** Recorded-event absence, invalid/unknown chronology and a known violation remain distinct; future obligation is not inferred.
- [ ] **26-B03.** Activation, partner and unmatched raw-record identities accompany each answer, with complete original item histories.
- [ ] **26-B04.** Descriptive rule counts remain separate from a reviewed Norm; normative execution requires an admitted actual Method binding.
- [ ] **26-B05.** Multiple-occurrence, equal-time, no-activation, missing-partner and unknown-clock fixtures survive save/restart.

### Exact domain and analyst acceptance

- [ ] **26-AC01.** Given one item rows a1=A@day0,b1=B@day1,a2=A@day2, when eventual-response A→B with reuse runs, then activation IDs[a1,a2], partners[b1,null], matched_activation_count1/recorded_nonmatch_count1, some=true/every=false. Occurrence support2 and affected-item support1 are distinct; full three-row history remains.
- [ ] **26-AC02.** Given raw[a1=A@0,x1=X@0.5,b1=B@1,a2=A@2], when raw-direct-response A→B runs, then partners[null,null], matches0 because x1 follows a1; eventual-response has[a1→b1,a2→null], matches1. An omission projection removing X never turns the original a1→b1 into a raw-direct passage.
- [ ] **26-AC03.** Given a1=A@0,a2=A@1,b1=B@2, when eventual reuse mode runs, then partners[b1,b1], every=true and partner use count2. Consume mode selects[a1→b1,a2→null], every=false and partner use count1. The two definitions and result identities differ; inferred pairing is not native invoice correspondence.
- [ ] **26-AC04.** Given b0=B@timeT source-position1,a1=A@timeT position2,b1=B@timeT position3, when timestamp-eventual allow-equal response runs, then a1 chooses earliest tied representativeb0 with all tied candidate IDs[b0,b1] and lag0; raw-direct response choosesb1, also lag0. Strict timestamp-later mode has no eligible partner. Each definition records the difference; source R15 accepts simultaneous events regardless position while raw direct does not change order.
- [ ] **26-AC05.** Given an item with known labels but no A occurrence, when default rule runs, then activation_count0,stateNotActivated,satisfied=null; it is not an observed satisfying example. Explicit logical-vacuity alternative returns vacuously_true under a distinct identity. A missing activity label makes absence unknown, not activation_count0 certainty.
- [ ] **26-AC06.** Given reusable eventual-response rows a1=A@0,b1=B@1,a2=A@2,a3=A with unknown time, when rules run, then per-activation states[T,F,U], confirmed witnessa1→b1 staysT, some=true/every=false and known activation support3 remains with unknown chronology witness[a3]. Given only[a1,b1,a3], states[T,U] give some=true/every=Unknown. A known end activation without recorded partner is descriptive RecordedNonmatch of the trusted finite snapshot, never an overdue/future/legal breach.
- [ ] **26-AC07.** Given an A/B rule is scoped to exact after-GR category but the item category changes across its raw history, when automatic scope runs, then scope is unknown conflicting_case_attribute; no flow is guessed from sequence and no breach is emitted. Keeping or inspecting a nonmatch retains complete original item history, activation/partner/tied-candidate/unmatched IDs and any unselected Change Price records.
- [ ] **26-AC08.** Given a saved descriptive rule and optional reviewed normative binding, when PID1 exits and a distinct PID2 reopens it, then exact scope/vacuity/tie/reuse/quantifier/direction/horizon, activation/partner/candidate/unknown IDs and item membership are identical. Missing actual Method binding refuses normative grading without a platform scorer, while the supported descriptive result remains available; finite native values use 1e-8 tolerance only.
- [ ] **26-AC09.** Given raw[b0=B@0,a1=A@1,b1=B@2], when rule A→B precedence runs, then activators[b0,b1] have prior A partners[null,a1], some=true/every=false; A→B response activates only[a1], later partner[b1], some=true/every=true. Precedence chooses latest known eligible prior timestamp, response earliest known eligible later timestamp, with saved eventID/source-position tie representatives.
- [ ] **26-AC10.** Given known a1=A@0,b1=B@1 plus an unrelated known-label X row with missing time, when reusable eventual-response runs, then a1→b1 remains T and some/every=true for the only known activation; X does not erase the witness. Given an extra row with missing activity label, total activation support becomes unknown and every=Unknown while some=true and witnessa1→b1 remain. Given known A@0, no known eligible B and B with unknown time, the activation is U, not F; offending candidate row IDs remain.
- [ ] **26-AC11.** Given local activation truth states, when aggregation runs, then some([T,U])=T,some([F,U])=U,some([F,F])=F,every([F,U])=F,every([T,U])=U,every([T,T])=T. Known empty support=[] yields NotActivated/satisfiednull under default policy; unknown additional activation support changes otherwise-all-T universal toU but cannot erase a confirmed existentialT or universalF. The table and vacuity choice are part of the frozen definition.

### Public behavior, evidence and durability

- [ ] **26-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **26-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **26-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **26-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **26-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **26-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **26-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** precedence or response direction, existential versus universal quantifier, activation/partner sets, direct/eventual and ordering policy, reuse/consumption and vacuity, open-horizon treatment.

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

- Full R08 follower-filter reproduction requires the exact repeat/multiple-invoice exclusions and original tool clock/order semantics; the explicit product rule above does not claim those complete results.
- R15 full multi-stage/amount every-cycle normative pattern is separately named, and quantities/payment terms/native invoice IDs are not supplied. Generic response predicates must not silently replace it.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #21, #33, #64, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** #107 — Inspect source-witnessed activity measures, #109 — Inspect declared milestone intervals

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
