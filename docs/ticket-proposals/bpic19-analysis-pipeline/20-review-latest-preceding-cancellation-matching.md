# 20: Review latest-preceding cancellation matching

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [122](https://github.com/feelfine1977/WISE_Platform/issues/122) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst applies one latest-preceding cancellation policy, inspects included/excluded event values and unmatched references, and saves the reproducible finding.

## Current platform foundation and missing analyst behavior

Source receipts/cancellations are visible, but a public latest-preceding relation and non-destructive projection need exact chronology/tie/consumption/amount rules, candidate/unmatched evidence and explicit limits on financial interpretation.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Review the target receipt and cancellation label sets, original value role, clock and exact item grain.
2. Choose a latest-preceding rule with explicit strict/equal-time, window, amount and one-use policy.
3. Inspect each cancellation link, all equally latest candidates and unmatched or unknown cases.
4. Review a derived exclusion projection beside original records; never delete source events.
5. Compare separately named raw sum, raw mean, creation value and retained-receipt aggregates.
6. Save links, candidate witnesses, value definitions and limitations; export and restore after actual process restart.

## Source evidence and limits

- Merged reports PDF pp198–200 (R09), especially p199: Celonis self-join, deleting clearings immediately after cancellation, most-recent preceding receipt hypothesis, repeat window-sort/rename until counts match; exact time tolerance not supplied.
- Merged reports PDF pp81–82 (R04): cancellation-adjusted counts, average receipt values and PO value; a different financial equation from event sums.
- Merged reports PDF pp155–159 (R07): first creation amount versus sums GR/IR; pp331–335 (R14): document/item reconciliation and radically different creation versus clearing totals.
- Merged reports PDF pp296–297 (R13): value-based many-to-many matching failed despite correction/cancellation events. PDF p347 (R15): anonymisation/quantity uncertainty explicitly prevents certain correctness claims.

**Source-step cross-reference:** R02.06, R03.05, R04.02, R04.03, R05.06, R05.07, R06.03, R07.05, R08.10, R09.02, R09.03, R09.05, R14.10, R15.06. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: R09 explicitly calls the most-recent-receipt interpretation an assumption; insufficient information motivated its removal/renaming heuristic.
- PANEL DEFAULT: same original item, exact selected receipt/cancellation labels, strictly earlier timestamp, latest preceding timestamp, consume target once, no finite window limit, ignore amounts for temporal linking. Equally latest candidates are ambiguous and consume none. No source rows are deleted. These are finite product choices, not all stated R09 choices.
- PANEL DEFAULT: optional equal/opposite-sign amount filter uses finite numeric values and an explicit EUR absolute tolerance (default0 for the optional exact filter); unknown latest value prevents certifying an older candidate when it could change the match. Zero and negative amounts are valid data, not auto-excluded.
- PANEL DEFAULT: independent sums/means/unique-creation reducers disclose contributing records and invalid-value support. Cancellation projection does not equate an unmatched cancellation with a financial breach.
- SOURCE-UNDEFINED: R09 immediately-after-clearing deletion tolerance/window and exact handling of repeated/corrected clearings are absent. The default bounded product does not delete any clearing; a separate explicit proposed time-window projection can be reviewed later.

## Required core and conditional extensions

The named finite panel default plus complete reviewed-input→real HTTP→built-browser→raw-evidence/export/save→actual fresh-PID restart acceptance is required. Source-compatible alternatives are separate identified definitions; unavailable source gates cannot be presented as reproduced methods.

## Extended user stories

### 20-US01

As an invoice analyst, I want each cancellation linked to the latest eligible prior receipt under a reviewed rule so that the source assumption is explicit and auditable.

**Preconditions:** Known item identity and selected receipt/cancellation labels.

**User actions:**

1. Review strict preceding and consume-once.
2. Run matching.
3. Inspect each link.

**Expected outcome:** Two cancellations consume two distinct preceding receipts and a third stays unmatched.

**Acceptance:** 20-AC01; the common integration criteria also apply.

### 20-US02

As a data analyst, I want equally latest candidates and missing clocks retained so that cancellation matching cannot invent an invoice identity.

**Preconditions:** Duplicate-time or missing-time receipt candidates exist.

**User actions:**

1. Open ambiguous candidates.
2. Inspect unknown rows.
3. Compare an explicitly named tie-break alternative.

**Expected outcome:** Ambiguous matching consumes nothing; unknown chronology never becomes unmatched certainty.

**Acceptance:** 20-AC02, 20-AC03; the common integration criteria also apply.

### 20-US03

As a financial analyst, I want amount equality, opposite-sign matching and tolerance saved separately so that cumulative or credit values are not assumed atomic.

**Preconditions:** Finite values, zero, negative and missing samples available.

**User actions:**

1. Select Ignore amounts.
2. Select exact equal or opposite-sign amount policy.
3. Review tolerance and units.

**Expected outcome:** Different definition identities; zero/negative values retained and missing values unavailable only for amount-dependent statements.

**Acceptance:** 20-AC03, 20-AC04, 20-AC05; the common integration criteria also apply.

### 20-US04

As a reporting analyst, I want sum, average and creation-value comparisons displayed independently so that a copied cumulative value is not mistaken for realised spend or loss.

**Preconditions:** Original and derived retained-receipt views exist.

**User actions:**

1. Compare raw and retained receipt aggregates.
2. Compare unique creation value.
3. Open contributing rows.

**Expected outcome:** Raw sum80, mean80/3 and creation100 remain different quantities; no fraud or overbilling assertion.

**Acceptance:** 20-AC05, 20-AC06; the common integration criteria also apply.

### 20-US05

As a process-mining analyst, I want cancellation projections to preserve complete original histories so that renaming or exclusion cannot hide financial evidence.

**Preconditions:** A receipt/cancellation projection is reviewed.

**User actions:**

1. Open excluded receipt and cancellation.
2. Return to full history.
3. Inspect a later clearing.

**Expected outcome:** All original source rows remain; cancelling a receipt does not automatically delete a clearing.

**Acceptance:** 20-AC01, 20-AC06, 20-AC07; the common integration criteria also apply.

### 20-US06

As an analyst returning to a saved investigation, I want exact links, ambiguous candidates and amount policies restored so that cancellation decisions can be re-audited after restart.

**Preconditions:** Links and value receipts saved/exported.

**User actions:**

1. Stop server OS process.
2. Start new process.
3. Reopen and compare.

**Expected outcome:** Same candidates, unmatched/support IDs, included/excluded projection and amount definitions.

**Acceptance:** 20-AC08; the common integration criteria also apply.

## Acceptance criteria

### Approved baseline retained

- [ ] **20-B01.** V1 binds cancellations to eligible latest-preceding records under explicit value/time/window/reuse rules; aggregate balance is a separate extension.
- [ ] **20-B02.** Duplicates, credits, tolerance, zero/negative/missing values and partial matches are explicit source-witnessed states.
- [ ] **20-B03.** Sum, average and creation-value comparisons are distinct definitions; no amount equation is chosen from a label alone.
- [ ] **20-B04.** A declared mismatch is distinct from a proven financial breach; missing quantities/contracts remain limitations.
- [ ] **20-B05.** Exact source totals, cancellation links, refused ambiguity and restart are checked through the analyst seam.

### Exact domain and analyst acceptance

- [ ] **20-AC01.** Given r1=IR@day1(value100),r2=IR@day2(value100),k1=CancelIR@day3,k2=CancelIR@day4,k3=CancelIR@day5 in one item, when strict-preceding/latest/consume-once/ignore-amounts mode runs, then links=[k1→r2,k2→r1], k3 is unmatched, matched_count2/unmatched_count1, retained_target_count0. All five original records remain and no invoice business ID is created.
- [ ] **20-AC02.** Given r1 and r2 are both IR atday2 followed by k1 atday3, when default ambiguity policy runs, then k1 state=ambiguous, candidate IDs=[r1,r2], target=null and consumed_count0. Given equal-time r3@day3 and k2@day3, strict-preceding mode excludes r3; allow-equal/source-order mode is a distinct reviewed definition.
- [ ] **20-AC03.** Given r1=IR with missing time followed by k1 atday3, when temporal matching runs, then k1 is unknown_chronology with witness[r1], not known unmatched. Given an otherwise eligible target has missing amount, ignore-amounts mode can link temporally, while amount-equality mode is unavailable unknown_target_value; unrelated known occurrence counts stay available.
- [ ] **20-AC04.** Given r1=IR@day1 value100 and k1=CancelIR@day2 value-100, when exact equal-amount mode runs, then no match; opposite-sign mode matches becauseabs(100+(-100))=0. Given target100.004 and cancellation100, EUR tolerance0.01 matches but tolerance0.001 does not; definitions differ. Zero0 target/cancellation is valid and can match under the declared filter.
- [ ] **20-AC05.** Given receipt values[100,-20,0] and a unique creation value100, when raw reducers run, then sum=80EUR, mean=80/3EUR, maximum_absolute=100EUR, creation=100EUR; zero_count1/negative_count1. If -20 receipt is linked/excluded by a reviewed cancellation projection, retained sum=100EUR and retained mean=50EUR. Missing/nonfinite amounts make affected monetary statements unavailable with their row IDs, never silent0.
- [ ] **20-AC06.** Given a cancellation is followed immediately by Clear Invoice in the source, when default latest-preceding receipt matching runs, then the clearing is retained unchanged and financial-breach verdict remains absent. A separately selected time-window clearing projection must declare window/ties and display source witnesses; the missing R09 tolerance is not silently filled as a source choice.
- [ ] **20-AC07.** Given links exclude r1/r2 in a derived receipt view, when Inspect is used, then the complete original item still includes receipts, all cancellations, every clearing and unrelated Change Price rows; the UI labels the projection hypothetical and the export carries the raw-to-derived exclusion map.
- [ ] **20-AC08.** Given saved matching and monetary definitions, when the server OS process exits and a fresh process opens the saved investigation, then links/candidate/unknown/unmatched IDs, exact membership, value units/tolerance and raw/derived sums reconcile with the exported receipt; unsupported versions return typed refusal rather than a new default.

### Public behavior, evidence and durability

- [ ] **20-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **20-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **20-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **20-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **20-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **20-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **20-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** receipt/cancellation activity sets, strict preceding and deterministic tie convention, consume or reuse policy, non-destructive derived projection, amount reducer and tolerance.

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

- R09 immediately-after-clearing deletion and missing time/amount/tie/reuse rules require source-code/author evidence for exact reproduction; the complete panel defaults above do not depend on that evidence.
- Aggregate balance, allocation across items or copied-value correction is a separate declared financial model; quantities/contracts/native invoice IDs are absent.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #21, #33, #41, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** #107 — Inspect source-witnessed activity measures, #111 — Review source-witnessed item-value definitions

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
