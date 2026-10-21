# 18: Inspect inferred ordinal invoice episodes

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [120](https://github.com/feelfine1977/WISE_Platform/issues/120) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst applies one reviewed ordinal episode policy, inspects its matched/unmatched events and intervals, and returns to the complete original item.

## Current platform foundation and missing analyst behavior

Original histories exist, but there is no public inspectable source-specific ordinal invoice-iteration operator with explicit original-eventID/time order, exclusions, unmatched support and durable inferred identity.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Review original item identity, category, original eventID column and clock before numbering occurrences.
2. Choose source-eventID ordinal pairing or a separately named time-order/close-on-clearing alternative.
3. Inspect each kth tuple, available local interval and unmatched stage occurrence.
4. Separate a diagnostic tuple from source-profile scope/exclusion and business invoice identity.
5. Compare item-weighted and episode-weighted duration summaries with exact support.
6. Save pairing definition, derived episode IDs and all witnesses, then replay after a fresh process starts.

## Source evidence and limits

- Merged reports PDF pp91–93 (R04): SQL ROWNUMBER partitioned by original item and exact activity, ordered by eventID ascending; same iteration joined; item means; complete-only, cancellation and reversed-order exclusions.
- Merged reports PDF pp327–329 (R14), especially numbered occurrences 001/002/003: derived invoicing iteration, distinct from original purchasing item/document.
- Merged reports PDF pp344,346–347 (R15): time-order kth GR/IR/release, reuse one creation across cycles, check every clearing, simultaneous activities accepted regardless log position.
- Merged reports PDF pp20–24 (R01): close-on-clearing heuristic is a different construction, with missing invoice IDs explicitly acknowledged.
- Merged reports PDF p338 (R14): 50% of derived iteration IDs reportedly have zero throughput; valid zero-duration evidence must not be thrown away solely for being zero.

**Source-step cross-reference:** R01.06, R04.06, R08.05, R09.03, R14.02, R14.05, R14.06, R14.07, R14.08, R14.12, R15.05. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: R04 eventID ascending is explicit; substituting timestamp order would change its method. R15 time-order ordinal linkage is another recipe, not interchangeable.
- PANEL DEFAULT: numeric original-eventID kth pairing, exact labels Record Goods Receipt/Record Invoice Receipt/Clear Invoice; eventID must be a reviewed original column with valid unique ASCII integer values within each item. No timestamp fallback. The initial finite product recipe pairs only selected stage labels, without claiming native invoice identity.
- PANEL DEFAULT: retain unmatched and reversed tuples diagnostically; source-compatible R04 display exclusions are a separately saved profile (complete cases, no GR/IR cancellations, source date window and order exclusions). Exclusions preserve raw histories.
- PANEL DEFAULT: equal timestamps produce legitimate zero local lag. Missing endpoint time affects only that interval; no approximate timestamp or inferred monetary balancing is introduced.
- SOURCE-UNDEFINED: R04 mixed GR-first/IR-first episodes within one before-GR item do not have a fully specified whole-case classification predicate. The bounded product can execute explicit fixed GR→IR→CI or IR→GR→CI stage choices; exact R04 cohort replication remains gated.

## Required core and conditional extensions

The named finite panel default plus complete reviewed-input→real HTTP→built-browser→raw-evidence/export/save→actual fresh-PID restart acceptance is required. Source-compatible alternatives are separate identified definitions; unavailable source gates cannot be presented as reproduced methods.

## Extended user stories

### 18-US01

As an invoice-process analyst, I want kth receipts and clearings paired using a reviewed ordering field so that repeated deliveries are not reduced to one earliest interval.

**Preconditions:** Original eventID field is reviewed.

**User actions:**

1. Choose numeric eventID ordering.
2. Number exact activities per item.
3. Open each tuple.

**Expected outcome:** Two distinct inferred tuples retain row witnesses and independent lags.

**Acceptance:** 18-AC01, 18-AC02; the common integration criteria also apply.

### 18-US02

As a data analyst, I want source-eventID and timestamp-order recipes to be separate so that their different pairings remain visible.

**Preconditions:** Event IDs and timestamps disagree in a literal fixture.

**User actions:**

1. Run original-eventID recipe.
2. Run time-order recipe.
3. Compare selected endpoints.

**Expected outcome:** New recipe identity and changed tuples; no silent fallback.

**Acceptance:** 18-AC03; the common integration criteria also apply.

### 18-US03

As a process analyst, I want unmatched, cancelled, reversed and tied tuples to stay inspectable so that incomplete evidence is not discarded as noise.

**Preconditions:** Repeated stage counts differ and a cancellation exists.

**User actions:**

1. Inspect local tuple states.
2. Review the cancellation exclusion switch.
3. Open the full item.

**Expected outcome:** Known zero lag stays0; reversed lag is unavailable with signed difference; cancellation exclusion does not delete the item.

**Acceptance:** 18-AC02, 18-AC04, 18-AC05; the common integration criteria also apply.

### 18-US04

As a reporting analyst, I want item-weighted and episode-weighted averages labelled separately so that repeat-heavy items do not change the reported unit unnoticed.

**Preconditions:** Two items contribute three valid IR→CI episodes.

**User actions:**

1. Select per-item means.
2. Select all-episode mean.
3. Open support IDs.

**Expected outcome:** Item-average7d and episode-average6d are distinct defined outputs.

**Acceptance:** 18-AC06; the common integration criteria also apply.

### 18-US05

As a process-improvement expert, I want derived episode identifiers distinguished from native invoices so that an inferred correspondence is not mistaken for accounting proof.

**Preconditions:** No native invoice ID exists in the reviewed source.

**User actions:**

1. Open an episode.
2. Read identity and limitation.
3. Inspect original rows.

**Expected outcome:** Derived episode ID plus original item/raw IDs, native invoice ID unavailable, full history retained.

**Acceptance:** 18-AC01, 18-AC07; the common integration criteria also apply.

### 18-US06

As an analyst returning to a saved run, I want the exact ordinal recipe, exclusions and tuples restored so that I can audit the same repeated-event analysis after restart.

**Preconditions:** Recipe and result were saved and exported.

**User actions:**

1. Terminate the server.
2. Start a new process.
3. Reopen and compare tuples.

**Expected outcome:** Exact definition/member/episode/witness/interval identities are restored.

**Acceptance:** 18-AC08; the common integration criteria also apply.

## Acceptance criteria

### Approved baseline retained

- [ ] **18-B01.** V1 pairs kth occurrences under an explicit ordering/tie policy; close-on-clearing is a separately activated extension and is not silently equivalent.
- [ ] **18-B02.** Derived episode IDs, native business IDs, item IDs and raw event IDs stay distinct.
- [ ] **18-B03.** Ambiguous, cancelled, missing, reversed and legitimate zero-duration outcomes have support/witness receipts; approximate intervals are not guessed.
- [ ] **18-B04.** All item records remain retained; Inspect highlights an episode without cropping analytical case membership.
- [ ] **18-B05.** Repeated-invoice literal fixtures and retained policy/episode identities pass the full seam and restart.

### Exact domain and analyst acceptance

- [ ] **18-AC01.** Given item A eventID rows g1=1 GR@day0,g2=2 GR@day1,i1=3 IR@day2,i2=4 IR@day3,c1=5 CI@day4,c2=6 CI@day9, when numeric-eventID ordinal pairing runs, then tuples=[g1,i1,c1],[g2,i2,c2], GR→IR days=[2,2], IR→CI days=[2,6], per-item IR→CI mean=4. Native invoice IDs remain null and six raw records remain.
- [ ] **18-AC02.** Given a third goods receipt g3=7@day10 without a third IR/CI, when ordinal pairing runs, then tuple3=[g3,null,null], state=unmatched, unmatched IDs=[g3], no tuple3 duration is0, and tuple1/2 intervals retain availability.
- [ ] **18-AC03.** Given eventID-ordered i1=1 IR@day4,i2=2 IR@day1,c1=3 CI@day2,c2=4 CI@day5, when original-eventID and time-order ordinal IR→CI recipes run, then original pairs(i1,c1),(i2,c2) with signed differences[-2,4], first unavailable reversed; time-order pairs(i2,c1),(i1,c2) with differences[1,1]. Identities differ. Duplicate/missing eventID returns ambiguous_event_id/invalid_event_id with raw witnesses; no order fallback.
- [ ] **18-AC04.** Given GR,IR,CI endpoints all at the same interpreted instant with unique eventIDs, when the nondecreasing-time recipe evaluates their tuple, then both local intervals are available with value0days. If IR time is missing, GR→IR and IR→CI are unavailable unknown_endpoint_time; any other complete tuple remains evaluable.
- [ ] **18-AC05.** Given item A additionally contains cancellation k1=Cancel Invoice Receipt, when source-compatible cancellation exclusion is enabled, then item A is retained in excluded support with reason cancellation_case and witness[k1]; disabling that exclusion in a separate diagnostic recipe restores tuples and does not relabel cancellation as proven financial correctness.
- [ ] **18-AC06.** Given A has valid episode lags[2,6] and B has one valid lag[10], when summaries are requested, then mean of per-item means=(4+10)/2=7days, all-episode mean=(2+6+10)/3=6days; item support2 and episode support3 are both explicit.
- [ ] **18-AC07.** Given an item includes an unselected Change Price row x between i1 and c1, when an inferred episode is inspected, then selected endpoint IDs highlight i1,c1 while complete item evidence still includes x and every source record; no new native invoice ID or case membership cropped to endpoints is created.
- [ ] **18-AC08.** Given saved ordinal definition and source-compatible exclusion profile, when the server OS process is stopped and a fresh process reopens it, then eventID role, labels, tie policy, exclusions, selected items, all derived episode IDs, signed differences and witness rows are unchanged; unknown profile/version causes typed refusal.

### Public behavior, evidence and durability

- [ ] **18-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **18-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **18-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **18-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **18-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **18-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **18-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** source-specific ordinal recipe, eventID/time ordering and tie policy, relevant activity sets, shared-creation and unmatched policy, derived iteration identity.

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

- Original R04 before-GR mixed-cycle partition, exact completion equation and any eventID duplicates must be resolved before claiming exact reported cohort totals.
- R01 close-on-clearing is a separate future admitted recipe; weighted many-to-many R13 approximation is not an ordinal substitute and its full formula remains a source gate.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #38, #66, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** #107 — Inspect source-witnessed activity measures, #109 — Inspect declared milestone intervals

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
