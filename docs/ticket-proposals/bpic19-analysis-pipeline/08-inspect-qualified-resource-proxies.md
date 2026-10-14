# 08: Inspect qualified resource proxies

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [110](https://github.com/feelfine1977/WISE_Platform/issues/110) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst reviews one user/batch/unknown policy and compares per-item user-event counts and distinct-user breadth with original resource records.

## Current platform foundation and missing analyst behavior

Raw resources are inspectable. The platform needs reviewed full-match versus historical-prefix classification, all-record attribution validity, event-count versus distinct-user proxies and exact unknown support.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Choose original resource role and review a named paper or historical attribution policy.
2. Open raw, normalized and classified user/batch/unknown values with item/event support.
3. Inspect per-item user-event count and distinct-user breadth plus local effort readiness.
4. Compare fully attributed/batch-only/unknown-containing items without requiring scoring.
5. Open original actor rows, disclose automation denominator if used and leave SoD/SNA/workload as explicit finite extensions.
6. Save/export the classifier/identity/parent policy and reopen all states after actual restart.

## Source evidence and limits

- R01 KPMG merged PDF 18 (printed 17): automation is batch events/all events, distinct from case rework rate.
- R02 Adaloudis merged PDF 28 (printed 3):607 human/20 batch and NONE/empty means no recorded user, not a human or batch event.
- R03 PwC merged PDF 56, 65–66 (printed 10, 19–20): batch/human automation ratio differs from batch/all share; derived distinct user/event features.
- R04 Meyer et al. merged PDF 94–97 (printed 17–20): distinct users excluding batch/NONE called case handovers; actual event-level handover sequence and SoD/workload are separate features.
- R05 merged PDF 116–117 (printed 8–9): user_NONE attribution and batch-related interpretation remain hypotheses, not labour-time evidence.
- R06 Botti merged PDF 133, 135–137, 140–142: resource specialization/handovers and forced-clear/four-eyes hypotheses need organizational context.
- WISE paper PDF 36: every event must match trimmed/lowercased full user_[0-9]+ or batch_[0-9]+; any unknown including unrelated-event actor makes C09 / C10 unavailable, batch excluded from human effort.
- Notebook one-based cell 4/adjacent wise_eval/data.py 84–89, features.py 45–49: historical trim/lower prefix classifier treats other nonempty labels as human; distinct human resource strings retain original spelling/case.

**Source-step cross-reference:** R01.05, R03.02, R03.04, R03.06, R04.07, R05.03, R06.02, R09.07, R11.07, R11.09, R13.12, R14.01, R14.09, R15.02, R15.08, R15.13, R15.14, NB.C35, P07. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: Actual paper attribution uses full regex after outer trim/lower case for every event; batch-only is valid zero human effort. Unknown attribution makes paper effort unavailable while unrelated count criteria remain evaluable.
- SOURCE: Historical helper excludes trimmed/lower case empty/nan/none/null and prefix batch, and treats other labels human; human breadth uses distinct original raw resource strings. This is a separate historical compatibility profile, not the paper policy.
- PANEL default: For corrected paper-style human breadth, use normalized user identity trim+lower, with raw originals retained. This identity reducer is an explicit panel decision where source text specifies classification but not all identity-equivalence details.
- PANEL: Unknown-containing items expose observed classified user/batch counts as lower-bound evidence and unknown support, but full paper user-event/distinct-user measures are local unavailable. Never equate unknown with batch or zero human effort.
- PANEL: Automation labels describe actor attribution, not autonomous execution, labour minutes or cost. A batch share declares denominator all records, known-attributed records or historical batch/human ratio explicitly; user-event count and distinct-user breadth are not handoff transitions.
- UNKNOWN: Separate actor equality/SoD, SNA and 2/7 day workload operators require finite admitted definitions and source context; existing actor ownership does not automatically implement all such algorithms.

## Required core and conditional extensions

The approved bounded working behavior is required. Separately gated report methods are not automatically activated by this ticket.

## Extended user stories

### T08-US01

As an exploratory analyst, I want user-event counts and resource breadth before scoring so that I can inspect manual-touch proxies without pretending to measure actual work time.

**Preconditions:** The original resource role is reviewed.

**User actions:**

1. Choose corrected paper-style policy.
2. Open A and B.
3. Read user-event/breadth/batch values.
4. Leave Norm unconfigured.

**Expected outcome:** A has 3 events/2 users and B has available 0/0; units are explicit.

**Acceptance:** T08-AC01, T08-AC02, T08-AC07, T08-AC10; the common integration criteria also apply.

### T08-US02

As a data steward, I want raw and normalized actor values visible so that I can distinguish missing attribution from user identity variants or invalid regex labels.

**Preconditions:** Identity-variant itemC and strict regex boundary labels are loaded.

**User actions:**

1. Inspect raw values.
2. Read trim/lower classification.
3. Open unrecognized actors.
4. Review resource role.

**Expected outcome:** Raw labels are preserved and classification/identity choices are explicit.

**Acceptance:** T08-AC03, T08-AC04, T08-AC09; the common integration criteria also apply.

### T08-US03

As a process-mining expert, I want historical and strict paper attribution kept separate so that original notebook outputs can be reproduced without silently making its permissive classifier strict.

**Preconditions:** Historical itemE and identity-variant itemC are available.

**User actions:**

1. Run historical prefix profile.
2. Run strict paper profile.
3. Compare E readiness and C breadth.
4. Inspect both definitions.

**Expected outcome:** robot changes attribution only under an explicit new profile, and raw-string breadth remains historical.

**Acceptance:** T08-AC03, T08-AC06; the common integration criteria also apply.

### T08-US04

As a process improvement analyst, I want unknown actors to affect only the effort result that needs them so that I can still investigate a witnessed invoice count.

**Preconditions:** D has a known receipt and an unknown actor on another labeled activity.

**User actions:**

1. Open D’s resource evidence.
2. Read unknown support and lower bounds.
3. Open IR count.
4. Compare batch-only B.

**Expected outcome:** D effort is unavailable but IR count 1 remains known; B zero effort remains valid.

**Acceptance:** T08-AC02, T08-AC05, T08-AC09; the common integration criteria also apply.

### T08-US05

As an analyst comparing automation, I want the actor-share denominator and handover meaning explicit so that ratios and resource breadth are not mistaken for case rework or labour cost.

**Preconditions:** A/F/G and an additional-unknown-event case are available.

**User actions:**

1. Compare batch/all and batch/human definitions.
2. Read eligible/unknown support.
3. Compare F/G breadth.
4. Inspect the transition extension gate.

**Expected outcome:** Ratios 1/4 and 1/3 are different; breadth 2 does not claim transition counts.

**Acceptance:** T08-AC07, T08-AC08, T08-AC10; the common integration criteria also apply.

### T08-US06

As a returning analyst, I want attribution definitions and zero/unavailable evidence saved so that a real restart does not replace resource policy with current defaults.

**Preconditions:** The resource result and unknown witness are saved.

**User actions:**

1. Keep and inspect complete D.
2. Undo.
3. Save/export.
4. Stop old PID/start new PID and reopen.

**Expected outcome:** Original labels, identity policy, readiness and denominators survive actual restart.

**Acceptance:** T08-AC11, T08-AC12; the common integration criteria also apply.

## Acceptance criteria

### Approved baseline retained

- [ ] **08-B01.** Paper full-match and historical notebook attribution policies are separate named profiles.
- [ ] **08-B02.** Unknown/missing attribution can make effort unavailable without preventing known count criteria.
- [ ] **08-B03.** Event automation, case rework and resource-transition supports have separately named units.
- [ ] **08-B04.** Batch-only valid attribution yields valid zero user effort; no labour-cost or active-time estimate is invented.
- [ ] **08-B05.** Resource evidence, known zero and mixed-case refusal/availability reappear after restart.

### Exact domain and analyst acceptance

- [ ] **T08-AC01.** Given item A actor sequence[user_1, user_1, batch_2, user_2], when corrected paper-style attribution runs, then raw event N=4, known user events=3, distinct normalized users=2, batch events=1, unknown=0 and full-effort state=available. Distinct-user breadth 2 is not reported as 2 handoff transitions.
- [ ] **T08-AC02.** Given item B has[batch_1, batch_2] only, when paper-style effort is computed, then user events=0 and distinct users=0 are valid available values, batch events=2 and unknown=0. Batch-only is not missing effort.
- [ ] **T08-AC03.** Given item C has[" USER_1 ", "user_1", " batch_2 "], when the corrected normalized-identity profile runs, then user events=2, distinct users=1, batch events=1 and unknown=0; original strings remain unchanged in evidence. The historical raw-string identity profile instead has distinct humans 2 and a different definition.
- [ ] **T08-AC04.** Given labels NONE, blank, user_1_extra, robot, batch_x are supplied on separate records, when strict full-match attribution runs, then each is unknown; user_12 and batch_003 are valid. A substring or prefix match must not admit user_1_extra or batch_x.
- [ ] **T08-AC05.** Given item D has known IR actor user_1 and an unrelated event actor NONE, when effort and raw invoice counts are requested, then paper user-event/distinct-user measures are unavailable, unknown support=1 and classified user lower-bound=1 remain visible; raw fully labeled IR count=1 remains available. Dropping the unrelated unknown actor to make effort ready fails.
- [ ] **T08-AC06.** Given item E has robot and user_1, when historical prefix attribution runs, then both are human and full historical user-event count=2; when strict paper attribution runs, then robot is unknown and full effort unavailable. Both named definitions and original raw labels are saved separately.
- [ ] **T08-AC07.** Given two items F actor sequence[user_1, user_1, user_2] and G[user_1, user_2, user_1], when distinct-user breadth is compared, then both breadth=2 and user-event count=3. An optional actor-transition measure would be 1 versus 2 under its own ordered policy; breadth must not be relabeled a transition count.
- [ ] **T08-AC08.** Given A has 3 user events and 1 batch event with no unknown actors, when batch/all event share runs, then ratio=1/4; a separately named batch/human ratio is1/3. Adding one unknown-actor event makes batch/all=1/5 with unknown support=1. Known-attributed denominator4 may only be shown as a different named share, not silently substituted.
- [ ] **T08-AC09.** Given missing resource column rather than one unknown cell, when paper-style effort is requested, then a typed role/local unavailable state identifies the missing binding and original activity counts remain available. It must not classify all rows batch or invent resource NONE strings as original data.
- [ ] **T08-AC10.** Given all known resource labels but one bad timestamp, when actor event count/breadth run, then counts remain available because these proxies do not require chronology; optional handoff/SoD/workload requiring order/time retains its own local gate.
- [ ] **T08-AC11.** Given unknown-containing or batch-only items are selected from the resource table, when evidence opens, then every original actor record, normalized/classification metadata and readiness reason are accessible, and Keep/Undo preserves complete item history and current parent.
- [ ] **T08-AC12.** Given classifier/normalization/identity policy, parent and resource witnesses are saved/exported, when serving PID exits and distinct fresh PID reopens, then exact raw and normalized labels, known 0/unavailable states, counts, breadth and denominators match public HTTP/built browser. Changing attribution mode creates a new identity; stale responses cannot replace current policy.

### Public behavior, evidence and durability

- [ ] **08-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **08-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **08-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **08-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **08-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **08-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **08-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** original resource role, normalization, full-match or historical prefix classifier, unknown attribution policy, event/case denominator.

## Required qualification receipts

- Literal fixture is independently authored, with source rows, expected complete-item IDs, row IDs, counts and states; it is not generated by the implementation under test.
- Record candidate source/build digests, original and normalized byte hashes, API and parser versions, definition and frozen-parent identities, actual public HTTP request/response and matching built-browser actions.
- Record keyboard-accessible evidence drill-down, current save/export manifest checksums, first serving process PID and observed exit, distinct fresh process PID, and exact reopened answer. A component reload or service recreation in one PID is insufficient.
- The root engineering E01 – E07 cases apply: typed local refusal, stale-request fencing, immutable revisions, current export, no arbitrary recipe execution, counts/IDs/states exact and finite native numbers within absolute 1e-8.
- Report measured qualification separately from source inspection; retain failed/refused receipts and identify any missing full-source/browser/restart seam.
- Independent actor fixtures A–G, full regex boundary labels, original-case identity variants, batch-only and unknown-unrelated event.
- Observe local effort refusal beside known IR count through public HTTP/built browser/save/export/actual distinct PID.

Each receipt identifies the candidate source/build, input and definition identities, independently expected versus actual values, public HTTP and built-browser actions, stable export/save references, observed first-process exit and distinct second-process reopening. Component or synthetic tests do not establish full-source capacity; report the elapsed time, peak memory and output/payload sizes for each full-source action that this ticket requires.

## Remaining gates and closure rule

- Corrected normalized user-identity equivalence must be an explicit panel policy; original historical helper uses raw string equality.
- Unknown-resource gating is all events, including unrelated activities; efforts must not be made available by selecting only relevant milestones.
- Paper proxy counts are not actual handoffs, person hours, cost or organizational responsibility.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #7, #23, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** None; can start on existing qualified foundations.

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
