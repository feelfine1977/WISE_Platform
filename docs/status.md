# Candidate status and evidence

This is an implementation inventory, not a release certificate. The [roadmap](roadmap.md) and [requirements](requirements.md) describe the target; passing tests qualifies only their named scope. The current candidate has no declared supported capacity tier and has not completed the Windows 11 human journey.

## Implemented scope

| Capability | Current implementation | Automated evidence |
| --- | --- | --- |
| Local import and preparation | External workspace; unchanged CSV bytes; explicit mapping, clocks, ordering, missingness, report and cutoff proposal | `tests/test_import_acceptance.py`, `tests/test_import_tolerant_acceptance.py`, `tests/test_cutoff_proposal_contract.py` |
| Whole-incident filtering | Activity/path/boundary predicates, exact IDs, opening/any-record context, recorded span/gap and first-record period; explicit unevaluable support | `tests/test_selection_acceptance.py`, `tests/test_explorer_core_http.py`, `tests/test_explorer_core_predicates.py` |
| Map, paths and variants | Supplied counts/times, adjustable visual detail, complete-case actions, parent arrangement option, actual repeated sequences | `tests/test_selection_acceptance.py`, `apps/api/tests/test_population_views.py`, `apps/web/src/map/MapView.test.tsx` |
| Time charts and incident exploration | Span-threshold selection and start-period bands; parent/kept distributions; longest-first lists, record marks and stated-rule groups | `apps/api/tests/test_case_list_v1.py`, `apps/api/tests/test_start_trend_v1.py`, `apps/api/tests/test_rule_groups.py`, `apps/web/src/time/TimeColumn.test.tsx`, `apps/web/src/groups/GroupsPanel.test.tsx` |
| Context and comparison | Opening context, frozen-parent target/reference groups and incident-start periods, exact denominators, missingness and follow-up | `tests/test_comparison_acceptance.py`, `tests/test_comparison_cohorts.py`, `tests/test_comparison_contract.py` |
| Optional expectation | One first-activation/first-response timing definition, reviewed validation, actual Method scoring, applicability and witnesses | `tests/test_scoring_acceptance.py`, `apps/api/tests/test_method_adapter.py`, `apps/web/src/expectation/ExpectationView.test.tsx` |
| Continuity | Saved unscored/scored questions, expected-revision conflicts, original run reads, stop/restart and corruption refusal | `tests/test_saved_investigation_restart.py`, `tests/test_saved_score_restart.py`, `tests/test_saved_result_integrity.py`, `tests/test_stored_run_malformed_json.py` |
| Stopped backup/restore measurement | Synthetic complete-directory copy, restore into a different folder, new CLI process, same saved selection/evidence/original run | `tests/test_capacity_benchmark.py` through `tools/benchmark_capacity.py`; not live backup or power-loss qualification |
| Windows artifact tooling | Locked wheels, built local assets, dependency notices, allowlisted bundle and installed HTTP/restart qualification | `.github/workflows/foundation.yml`, `tools/qualify_installed_bundle.py`, `tests/test_bundle_tools.py`; an actual successful run receipt must accompany an artifact claim |

Browser tests run in jsdom. They test components and coordinators, not actual browser layout, screen-reader behavior or the Windows installer. The generated health response retains `stage: foundation`; it is not the feature inventory.

## Explicit open gates

| Gate | Current state | Required evidence |
| --- | --- | --- |
| Transition matrix | Not implemented | Incident support, passage frequency and lag definitions; accessible pair-to-evidence journey and parity tests |
| Complete linked exploration | Partial | Time charts and filters exist; general categorical brushing, broader duration questions and the full first acceptance journey remain incomplete |
| Full expectation workflow | Partial | Broader expectations and score-to-map projection remain beyond the one timing definition |
| General measured-query selection | Partial | Recorded-span/gap predicates and one endpoint timing score exist; an arbitrary endpoint-duration query with both strict/inclusive partitions is not established by the standalone four-hour fixture |
| Eligible Method/Flow releases | Pending | Exact eligible released artifacts and their integration evidence; current vendored builds are unreleased |
| Windows 11 analyst journey | Pending human qualification | [Release checklist](release-qualification.md), exact bundle/runtime/browser, offline and keyboard recovery evidence |
| Supported capacity tier | Undeclared | [Capacity measurements](capacity.md) plus Windows/browser latency, memory/disk, varied log shapes and agreed acceptance budgets |
| Workspace evolution and recovery | Partial | Version refusal and stopped synthetic copy/restore exist; no migration/refresh command, live backup or power-loss recovery qualification |

Stage definitions and last-reading convenience state live in browser local storage. A workspace copy preserves the saved analytical questions and their stored evidence, not that browser state. A different browser or port can therefore change presentation without changing the saved population.

## Historical pending tests

The four `test_pending_*` placeholders formerly skipped in `tests/test_analytics_acceptance.py` have been removed. They had empty bodies and predated the graph, comparison, time and scoring acceptance suites. Removal does not certify their combined target scope: matrix acceptance, eligible library releases and the remaining release gates are still open in the table above. Executable tests should assert behavior; capability gaps belong in this inventory and the roadmap, not permanently skipped empty tests.
