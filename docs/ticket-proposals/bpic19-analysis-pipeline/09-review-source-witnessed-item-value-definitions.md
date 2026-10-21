# 09: Review source-witnessed item-value definitions

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [111](https://github.com/feelfine1977/WISE_Platform/issues/111) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst compares a PO-creation-event value with the historical notebook’s maximum-absolute event-value proxy, inspects contributing amounts and saves the two explicitly different item measures.

## Current platform foundation and missing analyst behavior

Raw value context alone does not establish item spend/exposure. The analyst needs two distinct source-witnessed reducers—creation-event value and maximum absolute event value—with explicit missing/multiple/negative semantics and units.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Review original amount role, numeric parsing and declared currency/anonymization unit.
2. Choose named creation-event or historical max-absolute definition, with visible selector and multiple/missing/negative policy.
3. Compare the two per-item results and open exact contribution/counterexample amounts.
4. Review frozen P95 calibration population and quantile/interpolation/missing rules if normalization is requested.
5. Inspect ties, known zero, nonfinite/missing and conflicting creation candidates; do not sum repeated cumulative rows as spend.
6. Save/export both definitions and calibration lineage, reopen after actual restart and inspect original values.

## Source evidence and limits

- R02 Adaloudis merged PDF 28, 43–46 (printed 3, 18–21): amount anonymization linear scaling/rounding and source-specific dedup/net/sum financial screen; not a universal reducer.
- R03 PwC merged PDF 51, 65–66 (printed 5, 19–20): scientific notation numeric conversion and derived cumulative amount.
- R04 Meyer merged PDF 81, 94 (printed 4, 17): average/net GR/IR compliance and Create Order net value do not define universal item-spend aggregation.
- R05 merged PDF 122–127 (printed 14–19): avg/median value variation 4632 cases, modulo/rounding and receipt-clearing sums are named financial screens; findings may reflect Service/Logistics characteristics.
- R06 Botti merged PDF 133–134:12 GR rows share cumulative 43312, not 12 atomic payments; 98%one value/4632 multi-value; ETL meaning needs confirmation.
- R07 Jessen, merged PDF148–149,155–156 (printed4–5,11–12): descriptive average then first-creation value versus GR/IR sums. This does not establish the panel unique finite creation VALUE or R15 unique creation EVENT reducer.
- Notebook one-based cell 4 (build_case_features) and cell 40 (value_phase_profile/rank bands), adjacent wise_eval/features.py 52, 55, 76–82: max absolute per case, missing fill 0, linear pandas P95 and clipped exposure proxy. This is adjacent source provenance, not proof notebook fully reran.
- WISE paper PDF 36/40:primary group PI is count-based; historical value/exposure is separate optional profile, not paper primary score.

**Source-step cross-reference:** R02.06, R03.01, R03.04, R03.06, R04.07, R05.05, R05.06, R05.07, R06.03, R07.02, R07.05, R08.06, R08.10, R09.02, R09.05, R09.07, R11.08, R12.08, R12.11, R14.10, R14.11, R15.02, R15.03, R15.06, R15.07, R15.11. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: R07 compares first value at creation; it does not establish a universal unique-creation algorithm. Reports use sums/averages/minima/netting for different financial screens. Cumulative event amounts may repeat and are not atomic costs.
- PANEL primary recipe: unique finite creation VALUE, exact activity selector={Create Purchase Order Item}. Equal-valued repeated creation records are admitted with every witness; two distinct finite numeric values are conflicting. This is distinct from a unique creation EVENT recipe, which refuses every repeated creation event even when amounts agree, and from R07 first creation. The primary 09 recipe is a panel product decision, not a claim that all reports use it.
- SOURCE compatibility: Historical max-absolute value is max(abs(event values)) per item, with missing case proxy filled0. P95 is pandas default linear quantile over frozen case exposures including missing0; divisor is raw q95 or1 and normalized proxy is clip(exp/divisor,0,1). Freeze that dependency explicitly; do not reinterpret it as a financial spend total.
- PANEL: A corrected max-absolute profile preserves all missing as unavailable and refuses nonfinite selected values locally rather than emitting JSON NaN/Infinity. Strict guard and missing policy are panel choices; they must not be attributed to the historical helper.
- PANEL: Currency/unit claim is an explicit source statement. Negative creation preserves sign; maximum absolute loses sign intentionally. No automatic conversion, spent amount, cost-saving or financial compliance conclusion follows from the proxy.
- PANEL: Value-band default uses reviewed fixed numeric boundaries with all same value ties together; historical rank-first bands are a separate compatibility recipe. Subsetting never recalibrates P95 or band boundaries without a new definition.
- UNKNOWN: Actual accounting quantity/payment terms/atomic-versus-cumulative meaning, reliable invoice identities and exact weighted approximate financial algorithm are not supplied by these value definitions. Those remain finite separately gated extensions.

## Required core and conditional extensions

The approved bounded working behavior is required. Separately gated report methods are not automatically activated by this ticket.

## Extended user stories

### T09-US01

As a purchasing analyst, I want to compare creation-value and maximum-absolute proxy so that I can understand why an item’s reported amount differs without summing repeated cumulative events as spend.

**Preconditions:** ItemA and the original amount role are available.

**User actions:**

1. Review currency/unit.
2. Run both named definitions.
3. Compare 100 and 200.
4. Open winner and counterexample rows.

**Expected outcome:** Two explicit item measures remain separate from raw sum 400 and cost claims.

**Acceptance:** T09-AC01, T09-AC11, T09-AC12, T09-AC13; the common integration criteria also apply.

### T09-US02

As a data steward, I want multiple creation candidates and numeric exceptions visible so that a duplicate, scientific notation, negative amount or missing value can be handled without fabricating a unique business value.

**Preconditions:** B/C and explicit numeric edge cases are loaded.

**User actions:**

1. Open creation candidates.
2. Review unique value policy.
3. Inspect raw numeric cells.
4. Compare equal duplicate 100 with conflicting 100/120.

**Expected outcome:** known zero, negative, missing, parse failure and conflict remain distinct with all source witnesses.

**Acceptance:** T09-AC02, T09-AC03, T09-AC04, T09-AC05, T09-AC06; the common integration criteria also apply.

### T09-US03

As a historical-reproduction analyst, I want the notebook’s maxabs/missing 0/ P95 semantics named explicitly so that source compatibility is not silently replaced by a stricter panel policy.

**Preconditions:** The historical helper provenance and frozen calibration are available.

**User actions:**

1. Choose historical compatibility.
2. Read missing 0 and linear quantile.
3. Compare corrected missing/nonfinite profile.
4. Save both definitions.

**Expected outcome:** Historical choices and new quality guards remain separate and auditable.

**Acceptance:** T09-AC05, T09-AC06, T09-AC07, T09-AC09; the common integration criteria also apply.

### T09-US04

As a process improvement analyst, I want a frozen exposure calibration so that zooming into subgroups cannot change an item’s priority proxy unnoticed.

**Preconditions:** The frozen exposure parent[0,10,20,30,40] is reviewed.

**User actions:**

1. Read q95 =38.
2. Select[10, 20].
3. Inspect unchanged normalization.
4. Choose an explicit new calibration revision if needed.

**Expected outcome:** Selection keeps 10/38 and 20/38; only an explicit new definition changes calibration.

**Acceptance:** T09-AC07, T09-AC08, T09-AC09; the common integration criteria also apply.

### T09-US05

As an analyst comparing similar value items, I want equal amounts kept together under named bands and missing support visible so that arbitrary row order or zero-filling does not create false cohorts.

**Preconditions:** Three equal-value10 items, one known-zero and one missing-value item are available.

**User actions:**

1. Set fixed 10/20 boundaries.
2. Select middle band.
3. Reorder table.
4. Inspect missing versus known zero and paper count PI limitation.

**Expected outcome:** All value 10 items match the middle band and unavailable values are not zero.

**Acceptance:** T09-AC10, T09-AC12; the common integration criteria also apply.

### T09-US06

As a returning analyst, I want exact amount definitions and calibration artifacts persisted so that a real restart cannot recompute my proxy with different defaults or current selection.

**Preconditions:** Both value definitions, calibration and conflict witness are saved.

**User actions:**

1. Open complete amount history.
2. Save/export current definitions.
3. Stop old PID/start new PID.
4. Reopen the calibration and 100/120 conflict.

**Expected outcome:** Original cells, policies, calibration and exact memberships remain identical after restart.

**Acceptance:** T09-AC11, T09-AC13, T09-AC14; the common integration criteria also apply.

## Acceptance criteria

### Approved baseline retained

- [ ] **09-B01.** V1 admits only creation-event value and max-absolute proxy, each with event selector, currency/unit and conflicting-value policy; event-sum/netted recipes remain separate extensions.
- [ ] **09-B02.** Zero/negative/missing/non-finite values and duplicate candidates have explicit policies and source witnesses.
- [ ] **09-B03.** The historical max-absolute95th-percentile calibration has a frozen population; selection never recalibrates.
- [ ] **09-B04.** Tied value bands, missing treatment and the distinction between value/proxy/exposure are explicit; no spend or cost claim is inferred.
- [ ] **09-B05.** Definition, calibration and source-value evidence survive export/save/reopen.

### Exact domain and analyst acceptance

- [ ] **T09-AC01.** Given item A has Create PO amount 100, GR amount 200 and Clear Invoice amount 100, when creation and max-absolute measures run, then creation=100 and max_absolute=200 with their exact candidate rows; raw sum 400 is not returned as item spend or cost under either definition.
- [ ] **T09-AC02.** Given B has two Create Purchase Order Item records both 100, when the unique finite creation VALUE recipe runs, then value=100, candidate count=2 and both original rows remain witnesses. Given C has 100/120, then state=conflicting and value=null. Under a separately named unique creation EVENT recipe, both B and C are unavailable because each has two creation events. Definitions and downstream exposure recipes name the chosen reducer explicitly.
- [ ] **T09-AC03.** Given first-creation source compatibility is explicitly requested and two distinct creation amounts share equal timestamp without admitted order, when execution runs, then selection is unavailable unless a finite source-position/display tie recipe is reviewed. The engine cannot silently fall back to unique-value or max-absolute to produce a number.
- [ ] **T09-AC04.** Given amount cell "1.2E+3", when reviewed numeric parsing runs, then value=1200 and original string remains a witness; identifiers "001"/"1" are unmodified. Invalid locale/parse inputs return local numeric-state reasons, not 0 or currency conversion.
- [ ] **T09-AC05.** Given creation amount −5, zero 0 and all missing items, when corrected definitions run, then creation values −5/0/null and max_absolute 5/0/null respectively; zero is available, missing is unavailable. The historical compatibility case-with-missing-amount proxy is explicitly 0 under its own named mode, not misreported as known zero original value.
- [ ] **T09-AC06.** Given any selected candidate amount is NaN, Infinity or −Infinity text, when corrected measure execution runs, then local state=invalid_nonfinite, value=null and raw cell/witness is retained; public JSON contains no floating NaN/Infinity and no invented 0. The original historical helper did not have this guard; compatibility gates must say so.
- [ ] **T09-AC07.** Given frozen calibration exposures [0,10,20,30,40], including one historical missing value filled0, when linear P95 runs, then n=5, h=(n−1)×0.95=3.8, raw q95=38 and divisor=38. Normalized exposures are [0,10/38,20/38,30/38,1]. Counts and memberships agree exactly; finite numbers agree within absolute1e-8.
- [ ] **T09-AC08.** Given the frozen calibration from previous case and selected subset exposures[10, 20], when view changes, then divisor remains 38 and normalized values remain 10/38 and 20/38, not recalculated P95 =19.5. Anew calibration population requires a new identity and the old calibration remains reopenable.
- [ ] **T09-AC09.** Given a nonempty all zero historical calibration parent[0, 0], when P95 runs, then raw q95 =0, fallback divisor=1 and normalized[0, 0]. Given empty calibration parent, then the panel recipe returns explicit empty-calibration refusal and no invented population; this is a panel edge rule, not an executed source finding.
- [ ] **T09-AC10.** Given fixed bands value<10, 10≤value<20, value≥20 and three items all value 10, when band selection runs, then all three are middle band irrespective of row order/IDs; no ties are split across bands. Historical rank-first tie behavior is not silently modified and must have a separate named definition.
- [ ] **T09-AC11.** Given a creation record was excluded from an explicit derived event projection but exists in original history, when creation value is requested, then its source representation is declared: original raw definition may use it with lineage, projection definition must report missing candidate. The engine cannot silently switch representation or search another activity.
- [ ] **T09-AC12.** Given a value comparison has one item missing and one known 0, when distribution/cohort counts display, then eligible known zero=1 and missing=1 are separate; any sum or share denominator states whether unavailable items are excluded. A count-only paper PI is unchanged by choosing value mode unless a separate exposure definition is activated.
- [ ] **T09-AC13.** Given the analyst opens a conflicting creation or max-absolute item, when evidence opens, then every original amount row, selected candidate/winner rows, raw numeric string, currency/unit metadata and counterexample are accessible in the complete item history; Keep/Undo preserves whole items.
- [ ] **T09-AC14.** Given creation/maxabs/calibration definitions and value witnesses are executed through public HTTP/built browser, saved/exported, when the old PID exits and a distinct fresh PID reopens, then exact selector, negative/missing/nonfinite/multiple-value policies, calibration parent/ q95 /divisor, band boundaries, IDs and original cells match. Changing any meaning-bearing field creates a new identity; current export cannot reuse old figures or hidden recalibration.

### Public behavior, evidence and durability

- [ ] **09-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **09-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **09-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **09-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **09-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **09-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **09-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** value role, activity-anchored creation or maximum-absolute reducer, currency/unit claim, multiple/negative/missing value policy, calibration population where requested.

## Required qualification receipts

- Literal fixture is independently authored, with source rows, expected complete-item IDs, row IDs, counts and states; it is not generated by the implementation under test.
- Record candidate source/build digests, original and normalized byte hashes, API and parser versions, definition and frozen-parent identities, actual public HTTP request/response and matching built-browser actions.
- Record keyboard-accessible evidence drill-down, current save/export manifest checksums, first serving process PID and observed exit, distinct fresh process PID, and exact reopened answer. A component reload or service recreation in one PID is insufficient.
- The root engineering E01 – E07 cases apply: typed local refusal, stale-request fencing, immutable revisions, current export, no arbitrary recipe execution, counts/IDs/states exact and finite native numbers within absolute 1e-8.
- Report measured qualification separately from source inspection; retain failed/refused receipts and identify any missing full-source/browser/restart seam.
- Independent A/B/C amount rows, scientific notation, negative/zero/missing/nonfinite, projection loses creation and equal-value band fixtures.
- Frozen[0, 10, 20, 30, 40] calibration receipt with P95 =38 and subset normalization unchanged, through actual HTTP/browser/save/export/distinct PID.

Each receipt identifies the candidate source/build, input and definition identities, independently expected versus actual values, public HTTP and built-browser actions, stable export/save references, observed first-process exit and distinct second-process reopening. Component or synthetic tests do not establish full-source capacity; report the elapsed time, peak memory and output/payload sizes for each full-source action that this ticket requires.

## Remaining gates and closure rule

- The primary 09 unique finite creation VALUE is a panel recipe. R07 first creation needs explicit order/tie admission, and R15 unique creation EVENT refuses all repeated creation events. Each alternative needs a separate identity before claiming source-faithful reproduction.
- Historical missing 0 and lack of finite guard differ from corrected unavailable/finite semantics; preserve both names and never attribute panel guard to source.
- Linear P95, population membership, currency/unit and band tie policies are identity-bearing; rank-first historical ties remain a separate profile.
- Coordinate 27 with the exact 09 creation-value recipe: if 27 retains R15 unique-event refusal, it is a separate named alternative and cannot reuse 09 unique-value identity. Same-value repeated rows are the literal discriminator.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #14, #41, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** None; can start on existing qualified foundations.

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
