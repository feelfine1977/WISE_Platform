# 19: Compare FIFO-consuming invoice matches

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [121](https://github.com/feelfine1977/WISE_Platform/issues/121) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst evaluates an alternative FIFO-consuming match on the same retained item evidence and compares its endpoints, unmatched support and durations with the prior policy.

## Current platform foundation and missing analyst behavior

The platform needs a distinct consuming FIFO pair/triplet operation. Independent minima, ordinals and a DFG cannot reproduce its complete-tuple selection, one-use consumption or unmatched-event support.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Freeze one item population and the existing ordinal result before choosing FIFO.
2. Review relevant labels, flow scope, sorted-vector ordering, tie rule and one-use consumption.
3. Match each first-stage occurrence to the earliest unused later second/third-stage occurrences.
4. Inspect changed pairs and remaining unmatched supply/demand beside the ordinal output.
5. Compare durations and complete versus partial support without treating inferred tuples as invoices.
6. Save both definitions/results and reopen the comparison in a genuinely new process.

## Source evidence and limits

- Merged reports PDF pp172–174 (R08): explicit vectors and consuming FIFO triplets; Table5 positions produce(1,3,5),(2,4,15),(7,11,20); DF2 chooses GR-first or IR-first order; DF3 IR→CI.
- Merged reports PDF pp174–176 (R08): timestamp differences, zero-time examples, completed-invoice duration distributions. Source Java implementation is cited but was not executed or fetched in this review.
- Merged reports PDF pp91–93 (R04): kth source-eventID ordinal pairing for comparison, not FIFO consumption.

**Source-step cross-reference:** R08.05. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: R08 DF1 uses positions strictly increasing between stages, then removes all matched indexes. It computes durations only for completed triples; unpaired occurrences remain incomplete.
- PANEL DEFAULT: sort reviewed timestamps ascending, then reviewed numeric eventID when supplied, otherwise original source position; consume complete tuples only. All chosen stage positions must increase; equal-time records at later stable positions may match and yield0. Missing relevant chronology refuses the local case instead of guessed placement.
- PANEL DEFAULT: default exact stage labels are Goods Receipt, Invoice Receipt, Clear Invoice. Service Entry Sheet is an explicitly different receipt-selector recipe. DF2 auto choice uses its first relevant GR or IR, not any unrelated first raw activity; ties use the saved stable order. This precision is a panel choice.
- PANEL DEFAULT: an incomplete attempted triple does not consume partially selected later stages. Every complete triple consumes each endpoint once; all residual rows and cancellation flags remain inspectable.
- SOURCE-UNDEFINED: published DF2 nonnegative GR→IR tables versus the signed subtraction equation and IR-first cases are not fully reconciled. Keep signed oriented differences and separately selected stage-order durations; exact histogram parity remains gated.

## Required core and conditional extensions

The named finite panel default plus complete reviewed-input→real HTTP→built-browser→raw-evidence/export/save→actual fresh-PID restart acceptance is required. Source-compatible alternatives are separate identified definitions; unavailable source gates cannot be presented as reproduced methods.

## Extended user stories

### 19-US01

As an invoice analyst, I want FIFO as an explicit alternative to kth pairing so that an early unmatched clearing cannot shift every later ordinal interval.

**Preconditions:** Same frozen items and ordinal result.

**User actions:**

1. Choose FIFO.
2. Compare endpoint rows.
3. Inspect skipped clearing.

**Expected outcome:** FIFO selects the earliest eligible unused later endpoints; the early clearing remains unmatched.

**Acceptance:** 19-AC01, 19-AC02; the common integration criteria also apply.

### 19-US02

As a process-mining analyst, I want one-use consumption shown per raw record so that a goods receipt or invoice cannot fund multiple inferred complete cycles.

**Preconditions:** Repeated milestone events exist.

**User actions:**

1. Open use counts.
2. Inspect complete and incomplete tuples.

**Expected outcome:** Every consumed endpoint has use count1; unmatched endpoints retain use count0.

**Acceptance:** 19-AC02, 19-AC03; the common integration criteria also apply.

### 19-US03

As a data analyst, I want flow-specific order and service selectors reviewed so that the before-GR permission is not confused with a requirement that all invoices precede goods.

**Preconditions:** Reviewed Item Category and selected exact labels.

**User actions:**

1. Choose before-GR first-relevant order policy.
2. Inspect first relevant label.
3. Compare fixed-order alternative.

**Expected outcome:** Explicit GR-first/IR-first definition, no guessed category from sequence and no hidden SES union.

**Acceptance:** 19-AC04; the common integration criteria also apply.

### 19-US04

As a process analyst, I want simultaneous, cancelled and unknown-time examples retained so that zero durations remain valid and ambiguous chronology cannot be forced into a pair.

**Preconditions:** Ties, cancellations and bad timestamps are present.

**User actions:**

1. Inspect zero tuple.
2. Inspect unavailable case.
3. Review cancellation policy.

**Expected outcome:** Zero lag0; unknown chronology unavailable; cancellation flag remains evidence with separate exclusion choice.

**Acceptance:** 19-AC05, 19-AC06; the common integration criteria also apply.

### 19-US05

As an improvement analyst, I want the pairing coverage and limitations displayed with each distribution so that changes in sample selection do not look like throughput improvement.

**Preconditions:** Both recipes return matched/unmatched support.

**User actions:**

1. Compare complete tuple count.
2. Compare per-item and per-episode distributions.
3. Open omitted rows.

**Expected outcome:** Coverage difference is visible and no contractual payment lateness or causal improvement is asserted.

**Acceptance:** 19-AC01, 19-AC03, 19-AC07; the common integration criteria also apply.

### 19-US06

As an analyst returning to an investigation, I want the saved ordinal/FIFO comparison replayed exactly so that endpoint consumption and population are stable after restart.

**Preconditions:** Both recipes were exported and saved.

**User actions:**

1. Stop actual process.
2. Start a fresh process.
3. Reopen both results.

**Expected outcome:** Distinct IDs, exact raw use/leftover counts and intervals are restored.

**Acceptance:** 19-AC08; the common integration criteria also apply.

## Acceptance criteria

### Approved baseline retained

- [ ] **19-B01.** Explicit one-to-one consumption and eligible GR/IR/clearing ordering follow the named source policy.
- [ ] **19-B02.** Ordinal and FIFO results have distinct identities and visible event reuse/coverage differences.
- [ ] **19-B03.** A declared tie policy retains legitimate equal-time/zero-duration matches; unresolved ambiguity, unmatched supply/demand, cancellations and impossible intervals have distinct local states.
- [ ] **19-B04.** The comparison retains raw original witnesses and never promotes inferred pairs to native invoice identity.
- [ ] **19-B05.** Independent multi-event examples including a legitimate zero interval, policy-switch/save/reopen prove the difference.

### Exact domain and analyst acceptance

- [ ] **19-AC01.** Given ordered rows c0=CI@day0,g1=GR@day1,i1=IR@day2,c1=CI@day3,g2=GR@day4,i2=IR@day5,c2=CI@day6, when FIFO GR→IR→CI runs, then triples=[g1,i1,c1],[g2,i2,c2], lags[1,1] for both stages, unmatched=[c0]. Ordinal on the same stages pairs[g1,i1,c0],[g2,i2,c1] and retains reversed intervals; its definition/result IDs differ.
- [ ] **19-AC02.** Given source R08 Table5 vector IDs GR=[1,2,7,8,9,10,16,17,18],IR=[3,4,6,11,12,13,14,19],CI=[5,15,20], when FIFO positional consumption runs, then complete triples are exactly[(1,3,5),(2,4,15),(7,11,20)]. Consumed row count9, no row is used twice; remaining GR count6, IR count5 and CI count0.
- [ ] **19-AC03.** Given g1@0,i1@1 with no later clearing and g2@2,i2@3,c1@4, when FIFO runs, then g1 can pair i1,c1 as one complete triple, g2 remains unmatched and i2 remains unmatched; no early incomplete attempt consumes i2. Matched triples1, unmatched GR1, IR1, CI0. Summary units distinguish these event counts from affected items1.
- [ ] **19-AC04.** Given a before-GR item with irrelevant creation atday0, IR i1@day1, GR g1@day2 and CI c1@day3, when first-relevant-label mode runs, then stage orderIR→GR→CI and triple[i1,g1,c1] with lags[1,1]. Explicit GR→IR→CI alternative yields no complete triple. An unrecognized/missing category is unavailable for automatic flow mode and may only use a separately reviewed explicit stage recipe.
- [ ] **19-AC05.** Given ordered g1, i1 and c1 have one identical timestamp and stable source positions1,2,3, when allow_equal FIFO runs, then one complete triple and two available zero-day intervals result. Strict timestamp-later mode is a distinct definition and yields no complete triple; source evidence remains3records.
- [ ] **19-AC06.** Given any selected stage event has an unknown timestamp, when timestamp-order FIFO is requested, then that item is unavailable unknown_chronology, with unknown raw-row witnesses; no source-position guess is labelled a known temporal match. Given a cancellation row, the declared preserve-flag mode retains it, whereas cancellation exclusion creates an explicit excluded-case state under a new definition.
- [ ] **19-AC07.** Given two recipes use the same source/population but produce different complete-tuple supports, when comparison is shown, then both denominators, unmatched stage counts, use counts, aggregation unit and signed/reversed intervals are shown; a smaller selected mean is not reported as a proven process improvement.
- [ ] **19-AC08.** Given the comparison is saved, when the actual server process terminates and a new process loads it, then both definitions, sorting/tie rules, exact complete and unmatched row IDs and duration values match the prior export; an unavailable sorting/operator version returns typed refusal rather than ordinal fallback.

### Public behavior, evidence and durability

- [ ] **19-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **19-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **19-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **19-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **19-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **19-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **19-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** consuming FIFO recipe, flow-conditioned step order, source position and timestamp roles, one-use consumption, unmatched/tied/reversed policy.

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

- Exact R08 discovery/filter projection and Java vector order must be qualified before accepting full report-table parity; the explicit product default above remains executable/testable.
- R08 signed DF2 duration convention needs source clarification for exact reported nonnegative histogram reproduction, not a hidden absolute-value correction.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #38, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** #120 — Inspect inferred ordinal invoice episodes

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
