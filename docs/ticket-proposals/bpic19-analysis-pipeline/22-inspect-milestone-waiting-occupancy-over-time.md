# 22: Inspect milestone waiting occupancy over time

Status: **approved Priority 1 ticket; acceptance expanded on 14 October 2026; implementation qualification remains open**.

Tracker: [124](https://github.com/feelfine1977/WISE_Platform/issues/124) · Parent: [#102](https://github.com/feelfine1977/WISE_Platform/issues/102) · Labels: `priority: first`, `ready`.

## What to build

The analyst reviews waiting intervals and a recorded-time occupancy peak, inspects exact contributing items and saves the result with its horizon/completion policy.

## Current platform foundation and missing analyst behavior

A time strip/span is not waiting occupancy. The platform needs declared milestone intervals, half-open or otherwise reviewed boundaries, retrospective versus censored purpose, trusted horizon, weighted summaries and exact peak members.

Audited source frontier: `3d76a578`. New working-tree component tests are separate from qualified public behavior; this section does not assert equivalence with a later or installed candidate.

## Analyst journey

1. Choose one retained population, trusted cutoff/clock and the endpoint operator defining a wait.
2. Select retrospective completed-only occupancy or an explicitly named right-censored all-selected-item alternative.
3. Review valid, zero-duration, unknown, reversed and censored intervals with activation/response/cutoff witnesses.
4. Inspect half-open occupancy over time, a selected peak and defined calendar/duration summaries.
5. Keep complete items contributing to a peak and compare their full histories with missing/excluded items.
6. Save the interval population/horizon/summary definition and replay the same temporal selection after new-process restart.

## Source evidence and limits

- Merged reports PDF pp353–354 (R15): backlog is number of cases waiting at a time; Table5 explicitly uses first cycle of completed cases. Before-GR GR-before-IR median/max IR backlog9,249/14,785 and CI22,136/30,533 are reported, not newly rerun.
- Merged reports PDF pp344,346 (R15): first cycle/completion and per-clearing ordinal policy; precise interval boundary/median time weighting is not supplied.
- Merged reports PDF pp32–33 (R02): monthly/time patterns; pp10–11 (R01) and178–180 (R08): open/complete/as-of-age cohorts. These are different populations and not a live operational obligation census.

**Source-step cross-reference:** R01.02, R02.03, R08.07, R15.09. A step can also depend on separately gated extensions; relevance here does not imply full reproduction. PDF pages refer to one-based positions in the merged collection or named WISE paper; notebook cells use zero-based indexing. Original documents remain unchanged.

## Source rules, product decisions and unresolved definitions

- SOURCE: R15 Table5 selects first cycles of complete cases; its backlog is retrospectively observed case occupancy, not the live queue of all open obligations.
- PANEL DEFAULT: first declared activation to first declared response (first-cycle), completed-only source population, half-open[activation,response), end-before-start at ties, zero intervals contribute no occupancy. Earliest peak segment wins deterministic ties.
- PANEL DEFAULT: separate right-censored mode uses known absence of response and explicitly trusted cutoff, never a raw maximum timestamp or current wall-clock today. Unknown response timestamps remain unknown, not eligible censoring.
- PANEL DEFAULT: elapsed-time occupancy sweep with case unit; finite horizon is explicit. Mean uses item-time area divided by horizon duration. Lower duration-weighted median is smallest count whose occupied duration cumulatively reaches half the horizon; sample/event-boundary/daily medians are separate recipes.
- SOURCE-UNDEFINED: R15 exact boundary convention, time sampling/median weighting, repeated-cycle choice and observation horizon cannot be inferred from Table5 numbers. The finite default above is panel-selected and exact table parity remains gated.

## Required core and conditional extensions

The named finite panel default plus complete reviewed-input→real HTTP→built-browser→raw-evidence/export/save→actual fresh-PID restart acceptance is required. Source-compatible alternatives are separate identified definitions; unavailable source gates cannot be presented as reproduced methods.

## Extended user stories

### 22-US01

As a process analyst, I want retrospective complete-case occupancy separated from right-censored waiting so that a published backlog chart is not mistaken for current overdue work.

**Preconditions:** Reviewed completion population and trusted horizon.

**User actions:**

1. Choose Completed only.
2. Choose Right-censored selected items.
3. Compare populations.

**Expected outcome:** Peak2 for complete cases differs from peak3 including one known open interval.

**Acceptance:** 22-AC01, 22-AC02; the common integration criteria also apply.

### 22-US02

As a data analyst, I want interval boundary and equal-time rules visible so that simultaneous completions and arrivals cannot manufacture a peak.

**Preconditions:** End/start ties and one zero-duration case.

**User actions:**

1. Inspect day2 boundary.
2. Open zero-duration support.

**Expected outcome:** Half-open membership excludes ending A, includes starting B and never counts zero-length D.

**Acceptance:** 22-AC01, 22-AC03; the common integration criteria also apply.

### 22-US03

As a process-improvement analyst, I want unknown and reversed waits retained separately so that missing response evidence is not labelled known completion.

**Preconditions:** Unknown response time and reversed endpoints exist.

**User actions:**

1. Open unavailable intervals.
2. Compare with known absent response.

**Expected outcome:** Unknown/reversed are unavailable, known absent response can be censored only in the explicit horizon mode.

**Acceptance:** 22-AC02, 22-AC04; the common integration criteria also apply.

### 22-US04

As a reporting analyst, I want daily snapshots and duration-weighted summaries labelled separately so that the backlog median has a reproducible denominator.

**Preconditions:** Reviewed time bins/horizon and all valid intervals.

**User actions:**

1. Choose event-boundary sweep.
2. Inspect duration-weighted summary.
3. Select daily snapshot definition.

**Expected outcome:** Completed-only area6 item-days over6days gives mean1; lower duration-weighted median1 under the saved convention.

**Acceptance:** 22-AC05; the common integration criteria also apply.

### 22-US05

As an investigator, I want to keep and inspect all items behind a peak so that the time view leads back to complete source histories.

**Preconditions:** Peak support is frozen.

**User actions:**

1. Choose earliest peak segment.
2. Keep its supporting items.
3. Inspect activation/response/cutoff records.

**Expected outcome:** Complete peak members[A,C], censored peak[A,C,E], with full records and interval witnesses.

**Acceptance:** 22-AC01, 22-AC02, 22-AC06; the common integration criteria also apply.

### 22-US06

As an analyst returning to a saved investigation, I want the horizon, interval operator and peak membership restored so that temporal evidence is comparable after restart.

**Preconditions:** Occupancy chart/selection saved and exported.

**User actions:**

1. Stop process.
2. Start a new process.
3. Reopen chart and selected peak.

**Expected outcome:** Same intervals, horizon/clock, peak boundaries and exact complete item IDs.

**Acceptance:** 22-AC07, 22-AC08; the common integration criteria also apply.

## Acceptance criteria

### Approved baseline retained

- [ ] **22-B01.** Use one declared interval convention and endpoint operator; half-open/equal/unknown intervals have explicit treatment.
- [ ] **22-B02.** Retrospective completed-case occupancy and current operational waiting are separate questions and populations.
- [ ] **22-B03.** Clock, horizon, interval/event/case units and calendar bins are visible; missing response never means known completion.
- [ ] **22-B04.** Selecting a peak keeps complete original histories and supplies activation/response/cutoff witnesses.
- [ ] **22-B05.** Boundary/censoring/tie fixtures and saved temporal selection pass the existing seam.

### Exact domain and analyst acceptance

- [ ] **22-AC01.** Given horizon[day0,day6), completed intervals A=[0,2),B=[2,4),C=[1,3),D=[2,2), when completed-only half-open occupancy runs, then segments[0,1):1,[1,2):2,[2,3):2,[3,4):1,[4,6):0; valid interval cases4, positive-duration cases3, zero-duration cases1. Earliest peak_count2, peak_segment[1,2), peak IDs=[A,C]; atday2 membership=[B,C], not[A,B,C,D].
- [ ] **22-AC02.** Given those intervals plus E activationday1 with known absent response, when completed-only mode runs, then E is excluded no_recorded_response. In separately named right-censored mode with cutoffday6, E=[1,6), censored=true, valid cases5, peak3 on earliest segment[1,2), IDs=[A,C,E]; E has no fabricated response row and its cutoff witness is the trusted horizon definition.
- [ ] **22-AC03.** Given same-time D activation/response atday2, when half-open mode runs, then duration0 is valid and contributes occupancy0 at every instant. Given A ends and B starts atday2, then end removal and start addition create count2 with C, not a transient count3 or4.
- [ ] **22-AC04.** Given F has known activation and an existing response record with missing timestamp, when right-censoring is requested, then F remains unavailable unknown_response_time rather than censored. Given G activationday4/responseday2, then G is unavailable reversed_interval with signed difference-2days and no occupancy; local valid intervals remain present.
- [ ] **22-AC05.** Given the completed-only fixture and horizon6days, when the saved duration-weighted summary runs, then area=6item-days, mean occupancy1item, lower duration-weighted median1item and maximum2items. With E censored, area11item-days and mean11/6items. A daily-snapshot median must name its snapshot timestamps and cannot be substituted for this definition.
- [ ] **22-AC06.** Given A and C each have one extra unrelated Change Price row, when the complete-case earliest peak is kept, then selected full items=[A,C], original record count6 (four endpoints plus two changes), not four cropped endpoint records. Peak evidence includes A/C activation and response IDs; selecting censored peak additionally includes complete E history and the cutoff receipt.
- [ ] **22-AC07.** Given a wall-clock source, when an offset/UTC cutoff or a cutoff before a required included event is supplied without a separately admitted horizon projection, then the operation refuses incompatible_clock/horizon rather than comparing naive and zoned times or clipping silently. Changing cutoff or endpoint operator creates a new definition/result identity.
- [ ] **22-AC08.** Given saved occupancy/peak selection, when the actual server PID exits and a fresh PID reopens it, then source clock, trusted horizon, completion/censoring rule, zero/unknown/reversed states, every peak item and activation/response/cutoff witness agree exactly with export; the UI labels retrospective versus censored purpose and does not call either overdue without obligation data.

### Public behavior, evidence and durability

- [ ] **22-E01.** Given a reviewed definition and frozen parent P, when the analyst executes this ticket's action through the public HTTP API and the matching built browser, then both show the same source/preparation/definition/population identity, exact supporting item IDs, units, availability states and analytical values. A literal independently authored fixture supplies the expected IDs and values; testing a helper against itself is insufficient.
- [ ] **22-E02.** Given an unavailable binding, unsupported policy or unknown input needed by this operation, when the action is requested, then the response and browser provide an explicit typed refusal or criterion-local unavailable state with the offending role/policy/evidence reason. They do not replace it with zero, silently choose another operator, or erase unrelated evaluable evidence.
- [ ] **22-E03.** Given two requests for different definitions or populations, when an older successful response, error or page arrives after the current response, then no old table, graph, evidence action or save payload replaces the current coherent answer. Cancellation and an edited but unreviewed definition prevent publishing the old answer as the new result.
- [ ] **22-E04.** Given a saved answer with source rows and analytical definitions, when the serving process is actually stopped, its exit is observed, a distinct fresh process opens the workspace, and the analyst reopens the investigation, then exact item/row/endpoint IDs, availability states, definitions, comparison roles and stable output identities are unchanged. Finite native numbers agree within absolute tolerance 1e-8; literal counts, membership, scopes and evidence states agree exactly. Reloading a React component or recreating a service object in the same process is not this receipt.
- [ ] **22-E05.** Given saved revision A, when any meaning-bearing definition field identified for this ticket changes, then a new definition or run identity is created and A remains reopenable with its previous settings and values. Changing only presentation order, detail or viewport preserves analytical identity. Missing or checksum-corrupt referenced artifacts produce an explicit refusal and never an automatic overwrite of A under current defaults.
- [ ] **22-E06.** Given a result and one selected supporting, excluded or unavailable item, when the analyst uses the table, keyboard-accessible evidence action or exported reference, then the same complete original item history opens with the exact contributing rows highlighted and the reason for inclusion/exclusion visible. Derived episodes, projections and assessment rows retain their original item/record lineage and never replace the raw history.
- [ ] **22-E07.** Given the current run B after another run A in the same workspace, when B is exported and saved using the current expected investigation revision, then the report and declarative recipe contain B's definitions, memberships, support, evidence, limitations and current output manifest only. An outdated expected revision is refused. Replaying an unknown action/schema/version is refused rather than executing arbitrary supplied code or reusing A's figures.

**Meaning-bearing fields for revision-mutation tests:** waiting endpoint policy, whole-item completion/inclusion population, trusted horizon, half-open or other boundary rule, censor treatment, time-bin or duration-weighted summary.

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

- Exact R15 median/max table reproduction needs its unknown sampling/horizon/boundary policy; no numeric result is selected merely to hit a published value.
- Operational queue/deadline or overdue status requires an independent obligation/deadline model; that remains outside the default retrospective/censored descriptive operator.

Every required acceptance box needs a linked receipt before closure. A visible unavailable/omission state can demonstrate a boundary case; it cannot replace this ticket's required working analyst journey or qualify an unimplemented source method. Human usability and realised process improvement remain separate from numerical/software verification.

## Existing ownership and dependencies

Related existing scope: #18, #32, #66, #25. Reuse existing foundations; an open issue is not itself a blocker. No existing-owner scope or parent issue is silently amended.

**Native blockers:** #103 — Review a named source and observation policy, #109 — Inspect declared milestone intervals

[Finite source-method activation ledger](source-method-activation.md) · [Acceptance review index](acceptance-review.md).
