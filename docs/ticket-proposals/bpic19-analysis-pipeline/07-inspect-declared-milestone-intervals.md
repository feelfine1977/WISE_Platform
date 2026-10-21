# 07: Inspect declared milestone intervals

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [109](https://github.com/feelfine1977/WISE_Platform/issues/109) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst measures independent earliest-to-earliest milestone intervals under the paper policy, compares their distribution and reopens exact endpoints plus the full item history.

## Current platform foundation and missing analyst behavior

Observed adjacent/span timing and one Resolution expectation exist. Neither is the paper's independent earliest-to-earliest operator with minimum-before-admissibility, nonnegative evidence rules and local endpoint witnesses.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Choose the current frozen item parent without making a Norm.
2. Select exact source/target activity sets and the admitted independent-minimum policy.
3. Review the endpoint clock and 2017≤timestamp<2020 admission gate separately from source inclusion.
4. Read per-item signed diagnostic, admitted elapsed value and eligible/unavailable states.
5. Compare target/comparator interval distributions with explicit eligible denominators; open each selected endpoint and a reversed/out-of-range counterexample.
6. Save the definition and exact endpoints, export it and reopen after a distinct-PID restart.

## Source evidence and limits

- R01 KPMG, merged PDF 14–17 and 20–24 (printed 13–16, 19–23): throughput findings, invoice subprocesses, native invoice IDs and payment terms missing.
- R02 Adaloudis, merged PDF 40–42 (printed 15–17): conditional duration/outlier analyses use their own selected population.
- R03 PwC, merged PDF 51, 57–64 (printed 5, 11–18): next-timestamp lead times, floor days and median/average labeling ambiguity; SRM/receipt/clearing interval comparisons.
- R04 Meyer et al., merged PDF 91–93 (printed 14–16): ordinal event ID pairing, cancelled/incomplete case exclusion and category-conditioned order; payment terms/arrival times unavailable.
- R05 merged PDF 115–121 (printed 7–13): direct RIR→CI time under Packaging/top 10 and activity-inclusion scope; duration does not prove late payment.
- R06 merged PDF 132–133, 142, 144: equal timestamps and receipt/service pulling hypotheses; apparent chronological order may reflect recording.
- WISE paper PDF 35–36 Appendix B/Table B2: earliest parsed nonmissing timestamp per selected activity set, chosen before 2017-inclusive/2020-exclusive admissibility; C04 nonnegative IR→CI, DF1 C05 minimum ordering. Notebook cell 4 uses adjacent historical helpers with separate policies.

**Source-step cross-reference:** R01.05, R01.06, R02.03, R03.05, R03.06, R04.06, R05.03, R07.02, R07.05, R08.05, R09.03, R10.07, R11.03, R11.04, R11.05, R12.06, R12.07, R14.08, R15.09, R15.11, NB.C19, P06, P12. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: The actual paper selects independently the earliest parsed nonmissing timestamp in each activity set, then checks selected endpoints for 2017 ≤t<2020 and nonnegative C04 interval. It does not search for the earliest admissible pair, first invoice after goods or first clear after invoice.
- PANEL default: V1 implements only independent minima. Preserve all co-minimum original row IDs; use a deterministic representative for display only, never evidence of causal order. Keep raw signed difference diagnostic beside local admission status.
- PANEL: Unparseable rows remain in source evidence. If another matching row has a parsed timestamp, that parsed minimum may be used under this paper recipe; no parsed matching row means endpoint unavailable. Bad timestamps elsewhere do not automatically forbid independent endpoint measurement.
- PANEL: Elapsed units are exact fractional calendar days from declared instants. This is recorded elapsed time, not active work/service time, contractual lateness or normative severity. Timings are useful before 11 and before a Norm.
- PANEL: Distribution values include only admitted endpoints, with unavailable state counts alongside; an empty eligible set has null median/mean, not 0. Target/comparator recipes and separate eligible N remain saved.
- UNKNOWN: First-to-last, first-after, PwC adjacent/floor, ordinal invoice episodes and weighted approximate durations require separate finite adapters and any missing formula gate. No fallback from unsupported pairing to independent minima is permitted.

## Required core and conditional extensions

The approved bounded working behavior is required. Separately gated report methods are not automatically activated by this ticket.

## Extended user stories

### T07-US01

As an exploratory analyst, I want recorded milestone intervals without a scoring Norm so that I can inspect where elapsed time occurs before deciding whether it is acceptable.

**Preconditions:** A frozen item parent and reviewed clock are available.

**User actions:**

1. Select IR→CI and independent minima.
2. Read raw/admitted per-item values.
3. Inspect the 1 day item and 0.9 day fractional example.

**Expected outcome:** The admitted interval is a descriptive recorded-time measure, not severity or active work.

**Acceptance:** T07-AC01, T07-AC08, T07-AC10, T07-AC11; the common integration criteria also apply.

### T07-US02

As a process-mining expert, I want endpoint selection performed before admissibility so that a 1948 anomaly or earlier reversed pair is not hidden by a later convenient match.

**Preconditions:** The1948/later-valid and reversed-minimum cases are loaded.

**User actions:**

1. Run the paper policy.
2. Open each selected minimum.
3. Inspect later candidate rows.
4. Read the local reason and raw signed value.

**Expected outcome:** 1948 remains out of range and −1 day remains reversed, with no first-after substitution.

**Acceptance:** T07-AC03, T07-AC05, T07-AC07; the common integration criteria also apply.

### T07-US03

As a data steward, I want timestamp ties and parse failures represented explicitly so that a known parsed endpoint remains useful while evidence limitations are preserved.

**Preconditions:** Co-minimum and partially/all-unparseable invoice cases are loaded.

**User actions:**

1. Open co-minimum witnesses.
2. Read representative display policy.
3. Inspect unparseable row.
4. Compare the all-unparseable case.

**Expected outcome:** Co-minima remain source witnesses; parsed 1 day and unavailable-null cases are distinct.

**Acceptance:** T07-AC02, T07-AC04, T07-AC06, T07-AC08; the common integration criteria also apply.

### T07-US04

As a process improvement analyst, I want interval distributions with exact eligible denominators so that a subgroup with many unavailable endpoints is not made to look fast by zero-filling.

**Preconditions:** Target intervals[0,1,2]+missing and comparator[2]+reversed are available.

**User actions:**

1. Choose both cohort recipes.
2. Compare distributions and medians.
3. Open unavailable support.
4. Read empty-cohort behavior.

**Expected outcome:** Eligible support 3/1 and medians 1/2 are shown beside unavailability.

**Acceptance:** T07-AC09, T07-AC10; the common integration criteria also apply.

### T07-US05

As a purchasing analyst, I want to reopen endpoints in their full item history so that elapsed time can be interpreted beside services, cancelled invoices and contract limitations.

**Preconditions:** The receipt union and excluded/reversed endpoint cases are available.

**User actions:**

1. Select a table point.
2. Open exact endpoints and other candidates.
3. Keep the complete item.
4. Undo to parent.

**Expected outcome:** Original history and selector lineage remain available; no invoice-cycle relation is invented.

**Acceptance:** T07-AC03, T07-AC05, T07-AC11, T07-AC12; the common integration criteria also apply.

### T07-US06

As a returning analyst, I want endpoint definitions and unavailable counterexamples durable so that a restart cannot replace the source selection with today’s parser defaults.

**Preconditions:** The interval and comparison definitions are saved.

**User actions:**

1. Export the current answer.
2. Stop serving PID and observe exit.
3. Start a different PID.
4. Reopen co-minima/reversed witnesses.

**Expected outcome:** Exact endpoints, clock gate, eligibility and recipe identity survive actual restart.

**Acceptance:** T07-AC02, T07-AC07, T07-AC09, T07-AC13; the common integration criteria also apply.

## Acceptance criteria

### Approved baseline retained

- [ ] **07-B01.** V1 is the independent-minimum operator; first-to-last, first-after and adjacent/floor policies are explicitly separate admitted extensions.
- [ ] **07-B02.** For this paper policy, parsed minima are selected before admissibility; an invalid earlier minimum is not silently replaced. Other profiles retain their own endpoint policy.
- [ ] **07-B03.** Missing/reversed/out-of-range/tied states and clock/units expose exact eligible support.
- [ ] **07-B04.** The selected-record elapsed value is distinct from service time, contractual lateness and normative severity.
- [ ] **07-B05.** A source-excluded endpoint and counterexample remain navigable after save/reopen.

### Exact domain and analyst acceptance

- [ ] **T07-AC01.** Given item A has invoice rows Jan 1 and Jan 3, clearing rows Jan 2 and Jan 10 (all 2018), when independent minima run for Record Invoice Receipt→Clear Invoice, then selected times are Jan 1/Jan 2, elapsed=1 day and later rows remain visible; first-to-last 9 days and cycle-paired durations are not returned under this definition.
- [ ] **T07-AC02.** Given two invoice rows r1 / r2 share the earliest instant 2018-01-01T00:00Z and one later invoice exists, when minima run, then both r1 / r2 are co-minimum endpoint witnesses. A deterministic display representative does not remove the second source row or imply one preceded the other.
- [ ] **T07-AC03.** Given invoice 1948 and invoice 2018 followed by clear 2018, when minima are selected, then invoice 1948 remains the selected minimum; endpoint_state=out_of_range, admitted elapsed=null and the 1948 plus later counterexample are drillable. Choosing the later 2018 invoice to manufacture availability fails.
- [ ] **T07-AC04.** Given one invoice has unparseable timestamp and another parsed invoice 2018-01-01 followed by clear 2018 -01-02, when the paper recipe runs, then the parsed minimum yields 1 day, unparseable support=1 remains visible and the original item history remains complete. If neither invoice parses, endpoint unavailable and elapsed=null.
- [ ] **T07-AC05.** Given invoice Jan 10, clears Jan 9 and Jan 11 (2018), when independent minima run, then raw signed difference=−1 day, admitted elapsed=null and interval_state=reversed. The engine must not return+1 day from a first-after search under this definition.
- [ ] **T07-AC06.** Given invoice and clear share exactly 2018-01-01T00:00Z, when this nonnegative policy runs, then elapsed=0 days is valid. An equal-time DF1 receipt/invoice ordering diagnostic is 0, not a strict-order violation; no artificial one-second/day offset is inserted.
- [ ] **T07-AC07.** Given selected endpoint exactly 2017-01-01T00:00Z, when admissibility runs, then it is included; selected endpoint exactly 2020-01-01T00:00Z is excluded. The activity set is selected before those boundary checks; the gate does not trim the raw item records.
- [ ] **T07-AC08.** Given source timestamp 2018-01-01T01:00+01:00 and target 2018-01-01T00:00Z, when parsed under the declared instant clock, then elapsed=0 days. A naive timestamp with no admitted interpretation produces a typed clock/local unavailable state, never an invented workstation timezone.
- [ ] **T07-AC09.** Given target cohort has admitted intervals[0, 1, 2] and one missing interval and comparator has[2] plus one reversed interval, when distributions are compared, then target eligible N=3/unavailable N=1/median 1 and comparator eligible N=1/unavailable N=1/median 2. Missing and reversed values are not zero-filled.
- [ ] **T07-AC10.** Given an empty eligible interval cohort, when summary runs, then eligible N=0 and median/mean=null with empty-support reason. Given a 0.9 day admitted interval, then its fractional elapsed value remains 0.9; PwC floor-day 0 requires a separately named operator.
- [ ] **T07-AC11.** Given source set={Record Goods Receipt, Record Service Entry Sheet} and timestamps Jan 3/Jan 2 respectively, when minima run, then receipt minimum is Jan 2 with the SES row witness. The selector’s union is explicit; “receipt” does not silently choose GR only.
- [ ] **T07-AC12.** Given the analyst selects an out-of-range/reversed item from the distribution table, when evidence opens, then the full original history, both selected endpoint records, other candidate records and refusal reason are accessible by keyboard. Keep/Undo acts on whole items and preserves the frozen parent.
- [ ] **T07-AC13.** Given the interval answer and distribution comparison are executed through public HTTP/built browser and saved/exported, when the first PID exits and a distinct fresh PID reopens, then endpoint sets, exact row IDs/co-minima, 2017/2020 clock gate, units, raw signed diagnostic, admitted states and comparison eligibility match. Changing endpoint policy/sets/clock creates a new identity; stale results cannot replace current endpoints.

### Public behavior, evidence and durability

- [ ] **07-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **07-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **07-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **07-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **07-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **07-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **07-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** source and target activity sets, independent minimum selection, admissibility after selection, calendar clock and elapsed unit, negative/tied/missing policy.

## Required qualification receipts

- Literal fixture is independently authored, with source rows, expected complete-item IDs, row IDs, counts and states; it is not generated by the implementation under test.
- Record candidate source/build digests, original and normalized byte hashes, API and parser versions, definition and frozen-parent identities, actual public HTTP request/response and matching built-browser actions.
- Record keyboard-accessible evidence drill-down, current save/export manifest checksums, first serving process PID and observed exit, distinct fresh process PID, and exact reopened answer. A component reload or service recreation in one PID is insufficient.
- The root engineering E01 – E07 cases apply: typed local refusal, stale-request fencing, immutable revisions, current export, no arbitrary recipe execution, counts/IDs/states exact and finite native numbers within absolute 1e-8.
- Report measured qualification separately from source inspection; retain failed/refused receipts and identify any missing full-source/browser/restart seam.
- Literal endpoint fixtures cover independent minima, co-minima, 1948 earliest, partial parse, reversed pair, 2017/2020 boundaries and offset-equivalent instants.
- Match distribution exact eligible/unavailable support and full endpoint row references through HTTP/browser/save/export/distinct PID.

Each receipt identifies the candidate source/build, input and definition identities, independently expected versus actual values, public HTTP and built-browser actions, stable export/save references, observed first-process exit and distinct second-process reopening. Component or synthetic tests do not establish full-source capacity; report the elapsed time, peak memory and output/payload sizes for each full-source action that this ticket requires.

## Remaining gates and closure rule

- Do not make criterion 11/full-score 24 a blocker for descriptive 07; independent endpoints are useful alone.
- Specify whether a saved signed diagnostic is separate from admitted interval value; negative elapsed must not enter nonnegative distributions or vanish from evidence.
- Native causal ordering of equal-time records is not established by timestamp equality; display tie rules are not causal evidence.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #5, #10, #22, #90, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** None; can start on existing qualified foundations.

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
