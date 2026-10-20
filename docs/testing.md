# Testing and qualification

Tests qualify a named scope. The candidate now has import, selection, comparison, time/explorer, scoring and persistence suites in addition to M0 foundation checks. None alone establishes a Windows release. Follow the development setup for the current commands and [current status](status.md) for the evidence map and remaining gates.

## Test layers

1. **Contracts:** authoritative schema generates both clients; validate optional fields, typed support, version/refusal states and health status. Generated structure alone does not establish analytical semantics.
2. **Pure analytical fixtures:** literal small synthetic records and expected incident IDs/counts/sequences/times precede implementation. No company input is required.
3. **Adapter parity:** compare every supported execution adapter against those expectations. A SQL optimization cannot introduce a second definition.
4. **Application state/storage:** revision guards, failed jobs, cancellation, full evidence pagination, atomic publication and durable save/reopen.
5. **Browser interactions:** common population across chart/map/matrix/variants/evidence, accessible tables/keyboard, and distinguish highlight from committed refinement.
6. **Windows release:** approved runtime/assets, setup/start/stop/restart, offline local use, backup/recovery, declared capacity and a human investigation.

## Required analytical fixtures

- Exact complete-case selection retains all records, including those outside a case-start selection period.
- Repeated transitions separate incident support from passage occurrences. Matrix outgoing shares use a different denominator from cohort support; zero lag differs from unavailable lag.
- Equal timestamps use an explicitly authoritative sequence. Conflicting timestamp/sequence authority is tested or refused. Null activity projection preserves original rows and does not manufacture terminal records or hide supported mapped relations.
- Opening context is not first nonmissing context. Missing values and literal “Unknown” use separate keys; ever-membership can overlap and must not sum as exclusive shares.
- A frozen parent includes retained filters and eligibility. Target/reference roles are stored independently of predicate orientation. Reversal changes ratio/difference direction; inversion changes membership.
- Event-presence complements are binary. Nullable measures/scores expose measured-over, measured-not-over and unevaluable groups with reasons. Missing endpoints never count as passed.
- Paired profiles test exact counts, shares, percentage-point differences, concentration ratios and separately conditioned outcome rates. Zero baseline, tiny/empty support and fixed-by-parent fields have explicit outputs.
- Strict time thresholds include exact-boundary cases. First resolution, final resolution and reopening cycles are distinct named definitions.

Expected results must not be computed by copying the implementation under test. Browser counts are real supplied answers, not mock counters presented as analytical results.

## Recovery and persistence

Issue overlapping queries; deliver obsolete success, error and pagination replies after the current revision and confirm they cannot replace it. A current failure leaves a coherent previous answer marked with its state. Test cancellation, retry and partial publication.

Save an unscored investigation and one with an optional norm/score. Stop the application and reopen in another process. Verify source/preparation/representation, complete membership, target/reference roles, context reducer, bins, measures, notes and witnesses. Changed/moved/corrupt/incompatible sources or artifacts must produce explicit freshness/refusal behavior. Test database-aware backup/restoration rather than a copy of a live file alone.

The implemented adapter is filesystem-based: its safe backup procedure is a complete stopped-workspace copy. `tests/test_capacity_benchmark.py` exercises that procedure through the benchmark CLI, with real HTTP and a new host on a separately restored directory; it checks the original selection, complete evidence and original score run. This is not a live backup, database-backup qualification or power-loss test. See [release qualification](release-qualification.md) for the operator procedure and upgrade exclusions.

## Literal fixtures in the built browser

`tools/qualify_literal_browser.py` qualifies one ticket's literal fixture in the built application. Its scenario in `tools/literal_scenarios.py` imports the literal and saves the reviewed pipeline over public HTTP. The built browser then reopens it, which requests every saved action again, and must show the scenario's expected texts. These are values written in the ticket's HTTP test from the literal rows.

The analyst then saves a revision and downloads both exports. The browser-saved manifest must hold the HTTP-saved outputs unchanged. The service process is then replaced, and a fresh browser must download byte-identical exports.

```text
python tools/qualify_literal_browser.py --scenario issue107 --output receipt.json \
    --node NODE --playwright PLAYWRIGHT_INDEX_MJS --chrome CHROME
```

The web app is rebuilt first. Both browser tools refuse to run on a build older than the web sources. `tests/test_literal_browser_scenarios.py` runs every scenario's HTTP setup in each test run.

## First use, the own workspace and the import wizard in the built browser

These tools take the same arguments and refuse a stale build in the same way. Each starts the service as its own process over temporary folders and writes a receipt of checks and identities only.

- `tools/qualify_first_use.py` (#2, #3): an empty workspace, the packaged example S0 with its counts, one incident opened by keyboard and another by pointer, then an actual restart with the same identities and no second example read.
- `tools/qualify_default_workspace.py` (#47): the service without a workspace, for synthetic users. It covers creation at first launch, reuse, a launch override, a Data-area override with a refused foreign folder, an unwritable default recovered by Try again, and a damaged default recovered by another folder. Every refused folder must keep its bytes.
- `tools/qualify_import_wizard.py` (#4): on a 1366 × 768 window, the guide's synthetic example, then the invented files of `tests/fixtures/import-journey` against their own `expected.json`:
  - a wrong delimiter is corrected;
  - roles are chosen, and the reading and its confirmation are done by keyboard;
  - "What WISE understood" is checked;
  - the incidents and their records are opened;
  - a saved investigation is made, and a corrected reading is published as a new preparation, after which the saved investigation reopens on its own;
  - a malformed file is refused and never published.
- `tools/qualify_chronology.py` (#5): the invented `tests/fixtures/chronology/chronology.csv` against its own `expected.json`, in two phases.
  - Review:
    - the summary names the clock, the order authority, where the cutoff came from, and each policy with its version;
    - by keyboard, the evidence of a tie whose sequence numbers disagree with the times, of records without activity label, and of a date-only time (not readable, never midnight);
    - the path over missing labels says what it passes over, and no end is made after an unlabelled last record;
    - the focus returns to the preparation control;
    - a reading without the sequence number is compared with the first and published as its own preparation.
  - Reopen, after an actual restart: a fresh browser opens the first preparation, which keeps its order.
- `tools/qualify_ymd_slash.py` (#52): the invented `tests/fixtures/ymd-slash/ticketing.csv`, in the year-first slash shape, against its own `expected.json`.
  - It is read first with a format that reads none of its times. The summary and the investigation say why no order, path or variant follows, and lead back to the Data area.
  - There, the year-first format is offered with how many values it reads. The new reading is compared with the first and published; it has paths, and its original cells keep their fractional seconds.

- `tools/qualify_selection.py` (#6): the invented `tests/fixtures/explorer/core-v1.csv` against the hand-written `tests/fixtures/selection-journey/expected.json`.
  - A highlighted path's step is previewed with what it would keep, before anything is taken.
  - Taken, it shows the whole selection's counts, how steps combine and why some incidents are not evaluable. The preview and the step share one identity.
  - An incident is opened by keyboard, and the focus returns to it.
  - A second step keeps nothing and says so.
  - Undo twice restores exactly the earlier identities.

- `tools/qualify_incident_numbers.py` (#57): keeping incidents by their numbers in `core-v1.csv`, against `tests/fixtures/selection-journey/incident-numbers.json`.
  - An unknown or a repeated number refuses the whole entry, and nothing is asked.
  - An entry is previewed and taken: the chip, the counts, and every record of the kept incidents, the unlabelled ones included.
  - Another order of the same numbers gives the same identity.
  - Kept against removed in Compare names the same groups.
  - The investigation is saved, then reopened after an actual restart with the same chip and identity. Clear all and Undo return exactly.

- `tools/qualify_opening_context.py` (#7): the Context panel over `core-v1.csv`, against `tests/fixtures/selection-journey/opening-context.json`.
  - It checks each value, with a missing value apart from the text Unknown.
  - It checks what is said of unreadable and tied first records, of the totals, and of the latest and "ever" choices not offered.
  - A missing value, the text Unknown and a recorded value are kept by keyboard; a kept incident opens with all its context changes.

- `tools/qualify_context_values.py` (#63): context values joined by OR in `core-v1.csv`, against `tests/fixtures/selection-journey/context-values.json`.
  - Values are kept at any raw record and at the first one, with a missing value apart from the text Unknown.
  - A repeated value is refused; an incident holding two of the values counts once.
  - Another condition combines by AND; Undo restores the earlier identity.
  - The investigation is saved, then reopened after an actual restart with the same steps and identity.

- `tools/qualify_category_chart.py` (#8): the category chart of the invented `tests/fixtures/categories` file, against its own `expected.json`.
  - Bars and table are checked at laptop size and at 200 % zoom: every value named as text, a long value whole, a column fixed in the parent.
  - Inspecting a value lists its incidents and opens one without changing the selection.
  - Chosen values are previewed, cancelled and applied; bars and table rows resolve the same incidents.
  - A late reply for an earlier selection does not replace the chart.
  - Undo is exact, and the kept incident keeps every later record.

- `tools/qualify_interval_tail.py` (#10): one supported interval (the first start, then the first response at or after it) over the invented `tests/fixtures/intervals` file, against its own `expected.json`.
  - It names the pairing, clock and cutoff, checks the parent's bins and the incidents without an interval by reason, and tells a measured zero from a missing endpoint.
  - The same inclusive tail is taken from a bin and from the form; it is previewed, cancelled and applied.
  - An incident of the tail opens with both endpoint records, and the focus returns to the button it was opened with.
  - Undo restores the exact parent; the strict tail leaves exactly four hours out.

- `tools/qualify_variants.py` (#13): the actual variants of the invented `tests/fixtures/variants` file (ordinary, repeated, tied-order, missing-label and empty sequences, and an incident of unknown order), against its own `expected.json`.
  - The Variants view is found in the side panel. Every sequence, its counts and shares, and the inventory reconcile with the population.
  - Listing a variant's incidents takes no step. A listed history opens with its unlabelled record, and the focus returns.
  - Each variant is previewed and kept by keyboard with its exact members, the incident of unknown order not evaluable. Cancel takes nothing, and Undo restores the exact parent.

- `tools/qualify_pinned_histories.py` (#19): a supporting and a contrary history of the invented `tests/fixtures/pinned` file, against its own `expected.json`.
  - From the incidents first recorded at one desk, a kept incident is pinned as supporting and a removed one, read in the selection's parent, as contrary.
  - Both are read side by side with every record, row and mark of the oracle, and with the context of both first records; nothing is matched.
  - Returning restores the focus and the selection; a pin opens from the index and returns to it.
  - On a narrow window, after the steps changed, and with one handle refused, both sides stay named, and the readable one stays whole.

- `tools/qualify_path_list.py` (#55): the list of every path of the invented `tests/fixtures/variants` file, against `paths.json`.
  - Each pair and flow carries the oracle's incidents, passages and median lag; the incidents of unknown order are named.
  - At the lowest detail a path the map leaves out is drawn on request, selected, without a step.
  - Whole incidents are kept and removed through it, each undone exactly; a selection without a labelled record lists no path and says so.

- `tools/qualify_parent_places.py` (#56): the places of the activities on the branching map of `tests/fixtures/variants`, then another parent (`tests/fixtures/pinned`).
  - The places are read from the map's own nodes. A preview and its cancel, a step and its Undo, the lowest detail, an activity removed and brought back, and an incident read beside the map move none of them.
  - Rearrange and the way back are explicit, by keyboard, ask for no incident and change no identity; the direction is named; another parent is arranged anew.
  - With `--screenshots DIR` the map is photographed in the parent's places, rearranged, and left to right.

- `tools/qualify_transition_matrix.py` (#12): the transition matrix of the invented `tests/fixtures/matrix` file, against its own `expected.json`.
  - Every measure of every cell equals the oracle; absent pairs and rows no pair leaves are named; a repeat adds passages, not incidents.
  - The bridge and the tie open their incidents with the original rows of the passage marked, and the focus returns.
  - A cell's step is previewed, cancelled and applied with the focus on the cell, and undone; the map's paths under the same relation carry the same numbers; a small window is not widened.

- `tools/qualify_frozen_parent.py` (#14): a comparison within a parent frozen after an eligibility step, on the invented `tests/fixtures/frozen-parent` file, against its own `expected.json`.
  - "Kept against removed" freezes the parent after the earlier steps and splits it by the last: the parent, its eligibility-unknown incident, the role names and the absent-resolution wording are checked.
  - The opening context reconciles with its missing value; a field constant in the parent is labelled fixed; both sides' histories open beside the comparison and the focus returns.
  - A nullable interval clause leaves its unknown in neither side; the way back to every incident is explicit.

- `tools/qualify_concentration.py` (#15): paired category shares and the oriented ratio on the fictional `tests/fixtures/incidents/S0.csv`, against `expected.json`.
  - Paired counts come first; the ratio is shown on request, named A's share ÷ B's share with its direction.
  - After exchanging the roles App is 2/5 against 2/7 = 1.40; an exact zero and no reference support are named and turn over with the roles.
  - A value's incidents are inspected by keyboard down to a complete history without a step; no significance or causal wording appears.

- `tools/qualify_named_outcome.py` (#16): a separately named outcome by opening value on S0, against `expected.json`.
  - "No recorded Resolved" is named apart from the groups, with K = P and the parent rate 5/12; App's rate is 2/4 and its lift 1.20, beside the profile ratio 1.40; every value's rate and lift is the oracle's.
  - App's witnesses open down to a complete history and the focus returns to the same list; exchanging the roles leaves the outcome as it is.

- `tools/qualify_explicit_groups.py` (#17): two explicitly defined groups of the fictional `groups-and-periods.csv`, against `expected.json` and `strata.json` beside it.
  - Two listed, overlapping groups keep their literal memberships; the overlap is declared and the sizes and context policy are said; a side's incident opens and returns.
  - Within the stratum Priority High the listed groups are refused with their recovery; two disjoint condition groups of unequal size compare their Service, the missing value included.

- `tools/qualify_period_followup.py` (#18): two start periods of `groups-and-periods.csv` to the stored cutoff, with a four-hour minimum follow-up and Resolved, against `expected.json`.
  - The shared definitions, the measured, missing and not fully observed supports and the paired profiles are shown.
  - Coverage that is not comparable is said and can be kept as no conclusion; the declared follow-up restriction removes only the incident not fully observed.
  - The cross-period incident opens with its whole history, also after its period, and returns; no survival estimate or improvement claim appears.

- `tools/qualify_saved_finding.py` (#25): a finding of the invented `tests/fixtures/frozen-parent` file saved in one service process and reopened in another.
  - First: the eligibility step and clause, a supporting and a contrary pin, a comparison in the frozen parent, the outcome, and a save with structured notes; its summary and its unsaved draft are checked.
  - After an actual restart: the saved list's lineage, cutoff, folder and unchecked state, and the local guide; the reopened notes, pins, frozen parent and outcome.
  - The question is applied to a refreshed reading (one incident appended), reviewed, and saved as a new revision without the earlier comparison; the earlier revision is listed as earlier and reopens as it was.

- `tools/qualify_backup_restore.py` (#26): a workspace with a saved question is backed up from the Data area; after an actual restart on another workspace, the backup is restored into a new folder, opened with the same identity, and its saved finding reopened with an incident's complete history. The original folder is checked unchanged.

- `tools/qualify_span_gap_list.py` (#58): the kept incidents of the invented `tests/fixtures/span-gap` file listed by time, against its own `expected.json`.
  - Every order (span, longest gap, record count, first record) either way round: equal values by number, unavailable values last as dashes.
  - The incident in focus: first and last records, span, longest gap with its two activities, offset and share, and the chosen context columns' values; its two records open marked. One record spans zero without a gap; tied times are zero gaps.
  - The longest gap is marked on the common axis of the records.
  - The search by number keeps the order and leaves the counts and the distribution unchanged.
  - With `WISE_SCREENSHOT_DIR` set, a picture of the list is written there.

- `tools/qualify_rule_groups.py` (#64): groups by a stated rule over the invented `tests/fixtures/rule-groups` file, against its own `expected.json`.
  - Each of the six rules groups the incidents as the oracle does; the rule is said, with who is eligible among the kept incidents and in the parent.
  - The incident of unknown order is unevaluable only for the rules that read the order. For the shared reference: the incident in no group, the records without a value, and the values too rare to form a group.
  - A chosen group states its rule, its support, its distributions against the whole parent and its shortest and longest incident.
  - Choosing takes no step; keeping takes one with the group's incidents, undone exactly.

- `tools/qualify_measure_range.py` (#89): ranges of records, span and longest gap over the invented `tests/fixtures/span-gap` file, against its `ranges.json`.
  - The range control (from "+ Add step" since #94) says that both bounds are included and which incidents have each measure.
  - Each range is previewed with its not-evaluable count, taken as one step that keeps, removes and leaves unevaluable the oracle's incidents, shown in the incident table, and undone exactly.
  - A reversed range is refused and nothing is applied.

- `tools/qualify_path_lag_range.py` (#90): the step on the lag of a path over the invented `tests/fixtures/path-lag` file, against its own `expected.json`.
  - The card of the path selected in the list of paths, and on the map, offers the step with the path's median lag as a bound.
  - Every range of the oracle, typed with each bound included or excluded, for one or every passage, kept or removed: previewed, taken as one step whose words name its pair and bounds, keeping the oracle's incidents, and undone exactly. On the map it is also typed in days.

- `tools/qualify_sortable_heads.py` (#91): the heads of the incident list over the invented `tests/fixtures/span-gap` file, against its `expected.json` and `heads.json`.
  - A click on the head of Records, Span, Longest gap or First record orders the list as the oracle does; a second click reverses it.
  - The head says the direction (`aria-sort`), and the order is said in words with its ties and its unavailable values.

- `tools/qualify_step_trail.py` (#93): the trail of steps over the invented `tests/fixtures/span-gap` file, against its `trail.json`.
  - Three steps taken from "+ Add step" stand as short chips, the earliest first, each with the incidents kept after it ("kept after step k", supplied by the service). A chip's details open on demand.
  - Choosing a chip shows the state after it, the later steps kept with their counts. The journey goes forward and back to the parent; a new step drops the later steps.
  - With `WISE_SCREENSHOT_DIR` set, a picture of the trail is written there.

- `tools/qualify_step_icons.py` (#92): the actions of the bar of steps at 1280 × 720 and 900 × 700, over the invented `tests/fixtures/span-gap` file.
  - Undo, Redo and Clear all are icon buttons with names and tooltips, disabled in their slots with the reason in their description while unusable.
  - Their places and sizes are the same with no step, while a selection is answered (the answer held back), after a step, after Undo and after Clear all.
  - With `WISE_SCREENSHOT_DIR` set, a picture of the bar at each size is written there.

- `tools/qualify_numeric_context.py` (#85): numbers in a context column over the invented `tests/fixtures/numeric-context` file, against its own `expected.json`, in two service processes.
  - The file is added in the Data area and Confidence and Amount (EUR) are declared numbers; the summary and the preparation say so.
  - The range of a number (from "+ Add step") shows the parent's range, the bins, the incidents without a number by reason and the records that are not numbers.
  - Every range of the oracle (first, latest and any record; half-open; kept and removed) is previewed, taken as one step and undone exactly. A range chosen on the chart takes the parent's exact edges, and the unit and a signed range are shown.
  - After an actual restart the reading opens again with its declaration.

- `tools/qualify_mean_times.py` (#74): the mean beside each median over the invented `tests/fixtures/mean-times` file, against its own `expected.json`.
  - Each activity selected on the map shows the median and the mean from the previous and to the next labelled record, with the passages they rest on; an activity without a passage says why.
  - Each path into Close shows its median and mean lag. Durations are matched in the map library's own format.

- `tools/qualify_lag_classes.py` (#86): the Time measure at 1280 × 720 over the invented `tests/fixtures/lag-classes` file, against its own `expected.json`.
  - The busy path of zero lag is drawn in the neutral grey of the legend's first class, never blue; the 30-hour path is drawn in the second class and the rare 14-day path in the third.
  - The whole legend names the classes with their bounds as durations.
  - With `WISE_SCREENSHOT_DIR` set, a picture of the map is written there.
  - Seeing the classes on a real log is the owner's step: open the log's reading, choose Time on the map, and look at 1280 × 720.

- `tools/qualify_counted_units.py` (#87): the words of what is counted, over the invented `tests/fixtures/span-gap` file.
  - "About this map", "About these charts", "About stages" and "About this data" each open with one line on what the numbers are, what each counts and over which incidents.
  - The time column's charts and the incident, path and matrix tables name incidents, records or passages.
  - The data row's numbers are unchanged.

- `tools/qualify_total_lag.py` (#88): the paths ranked by the time spent on them, over the invented `tests/fixtures/total-lag` file, against its own `expected.json`.
  - The list of paths opens on the total time, the largest first, under the head "Total time (days, all passages)".
  - A line says the share of the time on all paths the first five rows carry.
  - The rare long path comes first in the order by median lag.

- `tools/qualify_gap_pairs.py` (#61): the longest recorded gaps over the invented `tests/fixtures/gap-pairs` file, against its own `expected.json`.
  - A step keeps the incidents of at least ten hours. The Gaps panel lists each pair with its kept and parent incidents, passages, median and 90th percentile, the longest 90th percentile first.
  - The unlabelled endpoint is named, the policies and the incidents of unknown order are said, and no gap is called a working or waiting time.
  - A pair orders the incident list by its longest gap without a step.
  - A path of the map gives its 90th percentile lag and its passages longer than the threshold.

- `tools/qualify_add_step.py` (#94): the one entry of every step by a value, over the invented `tests/fixtures/span-gap` file, at 1280 × 720.
  - The bar is headed "Steps" and has "+ Add step". The side panel holds no filters and names "Variants".
  - The entry lists the six kinds of step with the line that says what a step is, and each kind opens its form alone.
  - Applying adds the step at once, closes the panel and gives the focus back to the entry; Undo takes it back, and Escape closes without a step.
  - The journeys that took steps from the side panel's filters (#11, #57, #60, #61, #63, #85, #89, #92, #93) now take them from "+ Add step" through `tools/add_step.mjs`; those that opened "Patterns" (#13, #55, #56) open "Variants". All twelve pass again on this build.

- `tools/qualify_long_incidents.py` (#60): long incidents of `tests/fixtures/intervals/intervals.csv`, against `long-incidents.json`.
  - The chart of spans keeps at least four hours by keyboard (exactly four included, the order-unknown incident unevaluable).
  - The incident list ordered by span shows the same incidents; the typed filter gives the same identity.
  - Kept against removed are compared.
  - The investigation is saved and reopened after an actual restart.

- `tools/qualify_start_period.py` (#11): a period of first records in the invented `tests/fixtures/starts` file, against its own `expected.json`.
  - It checks what the chart of starts says of anchor, periods, clock, cutoff and short recent follow-up.
  - A week band by keyboard is previewed and cancelled; the expanded table gives the same step and returns the focus on closing.
  - Applied, the step keeps the oracle's incidents with their later records and the cutoff in evidence. Undo is exact.
  - The date form with the same bounds gives the same identity.

- `tools/qualify_start_window.py` (#62): a week band of first records in `tests/fixtures/starts`, against its `expected.json`.
  - The chip names the bounds and the clock; kept and removed are compared.
  - Undo and Redo restore exact identities.
  - The investigation is saved, then reopened after an actual restart with the same window, identity and membership.

- `tools/qualify_first_map.py` (#48, #49): from a first launch over an empty workspace to the map of every incident of the packaged S0, against `tests/fixtures/first-map/expected.json`.
  - First phase:
    - the example is read through the ordinary operations;
    - the data row names the cutoff, and the paths list counts as the oracle;
    - a path step is previewed and applied with exact support; Undo and Redo;
    - the incidents, Compare and the Expectation are reached, and the investigation is saved.
  - After an actual restart, with a stale remembered reading in the browser: the listed reading opens, the example is not read again, and the saved investigation reopens on its view.

`tools/qualify_local_ymd_sample.py` is run by the owner on a local year-first export of their own, such as a public helpdesk benchmark sample, with its three role columns named by header:

- It reads the file through the product's operations in a temporary workspace.
- Its receipt holds the file's SHA-256, the reads of each format, and records, usable times, incidents in a known order, paths and variants, both with the year-first format and with every time unreadable.
- It holds no path, header or value.

## Human release checklist

On the supported Windows target, a novice follows the README, imports the synthetic event-history input, asks a useful question, compares context, switches to map/matrix/variants, opens full evidence, optionally scores, saves, stops and reopens. Repeat using keyboard/table paths and recover from one intentional error.

Record the build/runtime/assets, supported options, actual failures and capacity limits. Measured workloads and their limits are in [Measured capacity](capacity.md). Early Windows CI is required but does not substitute for this human journey. Private company mappings and expectations are validated locally by their owner after release qualification; test inputs and screenshots committed here remain synthetic.

The [release checklist](release-qualification.md) supplies literal browser checks, offline installation, keyboard/error recovery and stopped backup/restore steps. The [capacity tool](capacity.md) records HTTP timings and storage/memory evidence without imposing an invented performance budget. Matrix checks stay not implemented until the matrix exists; do not mark the full first journey passed by exercising a substitute view.
