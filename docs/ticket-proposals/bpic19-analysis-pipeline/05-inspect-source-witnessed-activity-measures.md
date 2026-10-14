# 05: Inspect source-witnessed activity measures

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [107](https://github.com/feelfine1977/WISE_Platform/issues/107) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst defines one presence/count/repetition measure, compares its item cohorts and opens every contributing or absent-record witness without losing full histories.

## Current platform foundation and missing analyst behavior

Activity/rule groups and complete histories exist. Analysts still need separately versioned raw presence/count/repetition definitions with criterion-independent availability, exact contributing or absence witnesses and durable measured cohorts.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Choose an existing current parent item population without requiring typed flow or Norm.
2. Define an exact activity selector and presence/count/repetition operator.
3. Read item level values and selected event witnesses, including known absence.
4. Compare positive/zero/unavailable cohorts and keep the complete items.
5. Inspect combined selectors and grouped activity definition; raw counts remain separate from netting/completion.
6. Save/export the measure/cohort and reopen after actual restart.

## Source evidence and limits

- R01 merged PDF 11–13, 18 (printed 10–12, 17): Change group excludes Approval; rework six-label cases; automation event share is a different unit.
- R02 merged PDF 34–39 (printed 9–14): activity counts support discovery but miner/conformance are separate extensions.
- R03 merged PDF 62–66 (printed 16–20): exact Change Quantity/Price/Cancel presence, repeated statistics/definitions differ; binary activity pivot versus counts.
- R04 merged PDF 94–97 (printed 17–20): per activity count features and rework event/case supports; source rework list duplicates Change Rejection Indicator.
- R06 merged PDF 134, 138: count activities versus matching cumulative amounts; mandatory activity set not sequence.
- R07 merged PDF 146, 159 (printed 2, 15): presence/repetition/deviation flags under a named time projection.
- WISE paper PDF 35–36 Table B2: C01 only Record Invoice Receipt, C02 Clear Invoice, C03 receipt GR or SES in DF1 / DF2; C06 price/quantity, C07 cancellation labels, C08 Record Subsequent Invoice. Notebook cell 4/helper uses different invoice union.

**Source-step cross-reference:** R01.02, R01.05, R02.03, R02.06, R03.04, R03.05, R03.06, R04.02, R04.03, R04.04, R04.07, R05.03, R06.02, R06.05, R07.03, R07.04, R07.06, R08.02, R08.06, R08.07, R08.08, R08.09, R08.10, R09.01, R09.02, R09.06, R09.07, R10.04, R10.05, R10.06, R10.08, R11.03, R11.04, R11.05, R11.08, R12.12, R13.06, R13.09, R13.12, R14.01, R14.03, R14.05, R14.06, R14.10, R15.02, R15.03, R15.05, R15.08, NB.C02, P03, P05, P14. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: Analysts use presence, raw counts, repetition and named activity groupings differently. A case has rework if any selected event exists; event rework count, event automation and case rates are separate measures.
- PANEL default on complete activity labels: exact count is the number of original matching records, presence is count>0, and exact repeat quantity is max(count−1,0). A selector is a reviewed set of exact activity labels, so duplicate query labels do not double-count a record. Incomplete-label binary/quantity behavior is declared separately below.
- PANEL: Exact selected-activity counts remain known with bad timestamps or unknown resources when every activity label is readable. Missing activity labels create explicit lower-bound evidence and can make exact quantity unavailable; neither a numeric0 nor absence is invented.
- PANEL: Invalid activity binding or unsupported operator is a typed query refusal, not 0. Empty parent has 0 items/0 records and undefined rate null; all-known-zero parent has valid 0 counts/rate 0.
- PANEL: Netting cancellations, financial value aggregation, invoice episodes and quantified order rules are separate admitted operators; raw receipt count does not decrease when a cancel record appears.
- UNKNOWN: The historical invoice union includes Vendor creates invoice, but actual paper C01 uses only Record Invoice Receipt. The shared word invoice cannot select a profile implicitly.
- PANEL finite incomplete-label policy: expose known matching lower bound and unknown-label support. Any known match proves presence=true; zero known matches plus unknown labels gives presence=unknown. Exact count and repeat quantity remain unavailable where missing labels could match the selector. Binary repeated-presence is true once two known occurrences exist, false only with complete labels and fewer than two matches, unknown otherwise. These finite indicators may feed presence-based Norms; a lower bound must never be mislabeled an exact quantity.

## Required core and conditional extensions

The approved bounded working behavior is required. Separately gated report methods are not automatically activated by this ticket.

## Extended user stories

### T05-US01

As an exploratory analyst, I want a simple activity measure on my current item population so that I can investigate work without first setting up flows or a scoring Norm.

**Preconditions:** The literalA/B/C source rows and a current frozen parent are available.

**User actions:**

1. Select Record Invoice Receipt.
2. Choose count, presence and repeat views.
3. Read known zeros.
4. Leave Flow/Norm unconfigured.

**Expected outcome:** Raw activity measures remain independently usable.

**Acceptance:** T05-AC01, T05-AC05, T05-AC08, T05-AC11; the common integration criteria also apply.

### T05-US02

As a process-mining expert, I want exact selector and grouping definitions so that vendor-invoice and recorded-invoice counts are not mistaken for the same criterion.

**Preconditions:** Paper IR-only and historical invoice-union definitions are listed separately.

**User actions:**

1. Run IR only.
2. Run historical union.
3. Compare B.
4. Open both saved definitions.

**Expected outcome:** B changes from 0 to 1 only under the explicit union recipe.

**Acceptance:** T05-AC01, T05-AC02, T05-AC04; the common integration criteria also apply.

### T05-US03

As a process improvement analyst, I want receipt and cancellation evidence kept separate so that a cancellation does not hide raw work or pretend to resolve an invoice pairing problem.

**Preconditions:** A has two receipts and one cancellation.

**User actions:**

1. Open raw IR count.
2. Inspect r1 / r2 / r6.
3. Read the netting operator gate.
4. Compare event count versus case presence.

**Expected outcome:** Raw 2 receipts and 1 cancel remain visible without an implicit net result.

**Acceptance:** T05-AC03, T05-AC04, T05-AC09; the common integration criteria also apply.

### T05-US04

As a data steward, I want missing labels and invalid bindings distinct from zero so that I can recover bad data without fabricating absence.

**Preconditions:** D has a blank activity cell and an invalid-binding query is available.

**User actions:**

1. Run known activity count on D.
2. Read coverage warning.
3. Attempt invalid binding.
4. Review and correct the binding.

**Expected outcome:** Missing labels retain coverage evidence; invalid binding returns a refusal, not 0.

**Acceptance:** T05-AC05, T05-AC06, T05-AC07; the common integration criteria also apply.

### T05-US05

As an analyst focusing on repeated work, I want to keep positive items with full histories so that the context and rework evidence are not removed by the activity filter.

**Preconditions:** The A/B/C measure and positive/zero cohorts are displayed.

**User actions:**

1. Keep repeat-positive A.
2. Open all six original records.
3. Highlight IR witnesses.
4. Undo to the original parent.

**Expected outcome:** Complete item history and exact cohort selection remain intact.

**Acceptance:** T05-AC08, T05-AC09, T05-AC10; the common integration criteria also apply.

### T05-US06

As a returning analyst, I want the exact measure/cohort definition and zero/unavailable evidence saved so that I can reopen and export the same answer after a real restart.

**Preconditions:** Measure definitions and recorded-absence witnesses are saved.

**User actions:**

1. Save/export.
2. Change query and check fencing.
3. Restart in a distinct PID.
4. Reopen A and B source evidence.

**Expected outcome:** No old query or silent selector fallback changes the saved answer.

**Acceptance:** T05-AC02, T05-AC07, T05-AC12; the common integration criteria also apply.

## Acceptance criteria

### Approved baseline retained

- [ ] **05-B01.** Event selectors, count unit and source/preparation/population identities are versioned.
- [ ] **05-B02.** Known absence and zero differ from invalid bindings, missing context and unavailable evidence.
- [ ] **05-B03.** One count/presence/repetition cohort on an explicit current parent exposes selected and unknown support. Flow-specific completion activates separately through03/06; raw counts remain independently useful.
- [ ] **05-B04.** Table/graph selection retains exact complete items and Undo; source-derived activity grouping is explicit.
- [ ] **05-B05.** Save/reopen and literal count/identity tests pass; reuse existing rule-group selection.

### Exact domain and analyst acceptance

- [ ] **T05-AC01.** Given A has receipt rows r1/r2, clearing r3, Change Price r4, Change Quantity r5 and cancellation r6; B has only Vendor Creates Invoice b1; C has one unrelated fully labeled record with missing time, when selector={Record Invoice Receipt} runs, then exact counts are A=2/B=0/C=0, presence A=true/B=false/C=false and exact repeats A=1/B=0/C=0. Receipt witnesses are A=[r1,r2]. B’s vendor-invoice record does not match paper C01.
- [ ] **T05-AC02.** Given A/B/C from T05-AC01, when the separately named historical invoice union {Record Invoice Receipt,Vendor creates invoice} runs, then exact counts A=2/B=1/C=0. It has a different definition identity from paper IR-only and every exact selector appears in the exported recipe.
- [ ] **T05-AC03.** Given A contains 2 IR and 1 Cancel IR, when raw IR count runs, then value=2; a separately named net-count operator would be 1 only if its matching/reduction is admitted and explicit. Raw count never quietly nets cancellation.
- [ ] **T05-AC04.** Given A has one Change Price and one Change Quantity and selector contains both plus Change Price twice, when count runs, then value=2, witnesses=[r4, r5], presence=true, repetition=1; selector duplicate entries are deduplicated semantically and no record counts twice.
- [ ] **T05-AC05.** Given C has complete available activity labels but missing clock/resource/context, when counting Record Invoice Receipt, then exact count=0 and presence=false with the complete C history as the recorded-absence witness. Missing context or clock does not make this independent activity count unavailable.
- [ ] **T05-AC06.** Given D has one blank activity label and one unrelated known activity, when invoice count/presence is requested, then known matching lower bound=0, unknown labels=1, exact count=null, exact repeat quantity=null, presence=unknown and repeated-presence=unknown. Given E has one known Record Invoice Receipt plus one blank activity label, then lower bound=1, exact count/repeat quantity=null, presence=true with its witness, and repeated-presence=unknown. Given F has two known receipts plus one blank label, then lower bound=2, presence=true and repeated-presence=true, but exact count/repeat quantity remain null. Missing labels must not erase witnessed presence or manufacture proven absence.
- [ ] **T05-AC07.** Given activity role points to an unavailable column or selector version is unsupported, when measure execution is requested, then HTTP/browser return typed role/operator refusal with no calculated count; existing other admitted measure answers remain available and are not overwritten with 0.
- [ ] **T05-AC08.** Given an empty frozen parent, when count cohort summary runs, then item N=0/record N=0 and case presence percentage=null with reason empty denominator; given[A, B, C], then selected presence cases=[A], absent=[B, C], case presence fraction=1/3 and repetition-positive fraction=1/3.
- [ ] **T05-AC09.** Given two identical IR records at the same timestamp with different original row IDs, when raw count runs, then both count and both witnesses remain; a deduplication projection requires its own named recipe and lineage. Equal-times are not duplicates by themselves.
- [ ] **T05-AC10.** Given presence-positive A is kept, when evidence opens, then all six A records remain, including price/quantity/cancellation, not only r1 / r2. Undo restores[A, B, C]; the rule/cohort predicate and support identity are saved.
- [ ] **T05-AC11.** Given this measure is run on a current parent without Flow profile or Norm, when it executes, then count/presence/repetition and source evidence work; flow-specific completion remains a separate 03/06 activation and is not an independent count gate.
- [ ] **T05-AC12.** Given the saved A/B/C measures and cohorts, when actual old PID exits and fresh PID reopens, then exact selector, operator, raw counts, zero/coverage/refusal states, witness row IDs, complete histories and current export manifest match public HTTP/browser results. Changing selector or parent creates a new identity; stale responses cannot save again the old query.

### Public behavior, evidence and durability

- [ ] **05-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **05-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **05-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **05-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **05-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **05-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **05-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** activity selector, presence/count/repetition operator, count unit, unknown-label policy, selected parent.

## Required qualification receipts

- Literal fixture is independently authored, with source rows, expected complete-item IDs, row IDs, counts and states; it is not generated by the implementation under test.
- Record candidate source/build digests, original and normalized byte hashes, API and parser versions, definition and frozen-parent identities, actual public HTTP request/response and matching built-browser actions.
- Record keyboard-accessible evidence drill-down, current save/export manifest checksums, first serving process PID and observed exit, distinct fresh process PID, and exact reopened answer. A component reload or service recreation in one PID is insufficient.
- The root engineering E01 – E07 cases apply: typed local refusal, stale-request fencing, immutable revisions, current export, no arbitrary recipe execution, counts/IDs/states exact and finite native numbers within absolute 1e-8.
- Report measured qualification separately from source inspection; retain failed/refused receipts and identify any missing full-source/browser/restart seam.
- Literal A/B/C/D rows with expected exact count/presence/repetition, union selector, duplicate labels and equal-time original records.
- Public measure/cohort Keep/Undo and all zero/empty denominator states must be observed through built browser and fresh PID reopen.
- Mixed known receipt+missing label E: presence=true, lower bound 1 and exact count=null. No known receipt+missing label D: presence=unknown, lower bound 0 and exact count=null. Two known receipts+missing label F: repeated-presence=true while exact repeat quantity=null. Presence-based C01/C03 availability in 10 is compatible with these witnessed indicators.

Each receipt identifies the candidate source/build, input and definition identities, independently expected versus actual values, public HTTP and built-browser actions, stable export/save references, observed first-process exit and distinct second-process reopening. Component or synthetic tests do not establish full-source capacity; report the elapsed time, peak memory and output/payload sizes for each full-source action that this ticket requires.

## Remaining gates and closure rule

- Resolve whether existing measure contract encodes recorded count plus label coverage separately from business absence; do not make unknown labels look known complete.
- No new blocking dependency 03/06/Norm for independent count family.
- Raw sequence/duplicate preservation must remain explicit; historical financial deduplication operator belongs in a finite extension, not 05 mandatory scope.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #16, #64, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** None; can start on existing qualified foundations.

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
