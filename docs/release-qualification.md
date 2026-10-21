# Candidate release qualification

This is a procedure, not a completed receipt. Current status is **pending Windows 11 human qualification and supported capacity**. Record pass/fail/not-run for each check against the exact artifact; never carry a pass from another build. This hardening scope does not implement the transition matrix, broader expectations, migrations or general linked categorical brushing.

## 1. Identify the candidate

- Record source commit and local modifications, CI run URL/result, downloaded bundle name and artifact digest, `manifest.json` and `SHA256SUMS`. Preserve the run's installed qualification receipt with the candidate evidence. Do not infer success from workflow configuration alone.
- Record Windows 11 build, x64 CPU, RAM, storage/free space, Python version, browser name/version and display scaling. The first documented runtime is CPython 3.13.16 x64; ARM and free-threaded Python are not covered.
- Use only synthetic inputs. Keep operator evidence outside the repository and private runtime state; never include company records in release receipts or screenshots.
- Confirm that all required automated checks passed for the same commit. `npm test` includes the synthetic benchmark/restore smoke test; `npm run check` includes component/contract checks. Neither substitutes for this human journey.

## 2. Install and prove local/offline operation

Follow [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md) on a disposable Windows user environment, from the actual downloaded bundle, without Node or Git. Obtain this checklist and the capacity procedure from the matching source revision before disconnecting: only the install guide is copied into the bundle. Check the installer's exit code and Python version. Record any security prompt, missing runtime or undocumented action as a failure, not as a step silently worked around.

After download, use approved means to disconnect external network access. Install using the bundle's hash-pinned `--no-index` route and start the CLI. Open the loopback address in a fresh browser tab. Check local assets and API calls in the browser's network panel; reload and perform the journey offline. No external request should be required. Reconnect only when permitted. Record the actual observation, not just the absence of a remote-service dependency in code.

For qualification, stop the default service and restart with an absolute, initially unused synthetic workspace path outside program files, for example:

```bat
"%LOCALAPPDATA%\WISE\env\Scripts\python.exe" -I -m wise_platform_api --port 8765 --workspace "%LOCALAPPDATA%\WISE\qualification-workspace"
```

Do not use or overwrite an analyst's working folder. A newly initialized workspace loads the built-in sample; importing the qualification CSV below is a separate step.

## 3. Browser investigation with literal checks

Use the bundle's `synthetic-inputs\B4-ties-out-of-order.csv`. It contains two incidents and five records; this small input provides independently readable checks, not a capacity test.

| Action | Expected result |
| --- | --- |
| Import in Data | UTF-8, semicolon; incident `Ticket`, activity `Event`, time `At`, sequence `Seq`, context `Desk`; ISO-8601 with offsets read as UTC; cutoff `2026-10-09T12:00:00Z` |
| Review report and open | Two incidents, five records, one record without an activity label; duplicate candidates/ties remain visible and do not silently disappear |
| Open T-01 | All four original records remain: Recorded, Routed, unlabelled, Reviewed in declared order; Routed and the unlabelled record tie on time and sequence, so source position breaks that tie |
| Inspect time | T-01 has a one-hour recorded span and longest gap; T-02 has one record, span zero and no adjacent gap |
| Select the span column starting at one hour | T-01 only, with all four records; Undo restores both incidents and all five records |
| Filter first-record period | From `2026-10-09T09:00:00` included to `2026-10-09T10:00:00` excluded, UTC; keeps T-01 and its later records at 10:00, rather than trimming the history |
| Map and Paths | Counts agree with the current kept population; visual detail changes do not silently select different incidents; switch to Patterns/variants and open the full history again |
| Context and Groups | With all incidents restored, opening Desk is East for T-01 and West for T-02; literal `Unknown` on T-01's later raw record is not missing opening context |
| Compare | With all incidents restored, compare opening East against opening West; one incident each, with their original four/one records and explicit denominators; reverse roles and verify direction changes |
| Expectation | On the whole two-incident reading, define a reviewed UTC target Recorded to Reviewed, 1 hour with width 1 hour, missing activation/response skip; T-01 has observed 1 hour and Method value 0, T-02 has no activation and no measured value; inspect full witness records |
| Save, stop, restart | Save a question with a nonempty selection, note and optional score reference. Record its selected IDs, comparison roles, original run and revision. Stop the host, restart on the same workspace, open Saved and reopen; membership/evidence/roles and original run must not change |

A `recorded span` is not a resolution duration. A library's value zero is its supplied score, not a conclusion that an incident met a company requirement. Leave the unreleased-library notice visible in the evidence.

Repeat the critical select/undo, compare, inspect and save/reopen actions using keyboard/table paths. Check focus enters/exits the inspector, Escape restores usable focus, every button has a meaningful name, and zoom/display scaling does not hide essential controls. Check at a narrow window and normal desktop size. Capture screenshots and actual failures; jsdom style tests cannot establish this result.

Intentionally enter an unknown incident number in Filters: it must refuse the entire entry and preserve the previous population. Stop the service while a view is requested, then restart and retry; no obsolete answer may silently replace the current question. Record how the operator recognizes the failure and recovers.

The matrix and full roadmap journey cannot be marked passed while absent. Record those as not implemented rather than substituting the Paths list for a matrix.

## 4. Stopped-workspace backup and restore

The current workspace is a directory of JSON metadata, original source bytes and immutable records, not a SQLite database. This procedure covers a stopped copy only; do not copy selected files, merge old and new folders, or copy while another CLI process can write.

1. Save the synthetic scored and unscored questions. Record the workspace path, revision identities, selected case IDs and one complete evidence trace. Stop every application process using that workspace; close its browser tabs to avoid confusing the original and restored services.
2. In File Explorer, copy the **whole** `qualification-workspace` folder to a new backup folder outside the application. Keep the original unchanged. Do not omit hidden files or subdirectories. Confirm copy completion and available disk space.
3. Copy the backup to a third, new restore folder. Do not point the application at the only backup copy. Start the same candidate with `--workspace` naming the restored folder, using the same loopback address only after the original host is stopped.
4. Open Saved and reopen both questions. Compare revision identities, exact selected incidents, context/comparison direction, notes/bookmarks, all original source records and the original score run/witness against the recorded evidence. No rescoring should be necessary. Continue editing only in this disposable restored folder.
5. Stop the restored service. Confirm the original and backup still exist unchanged. Preserve all three until qualification evidence has been reviewed.

The application also backs up and restores a workspace itself (Data area → Workspace → Back up or restore; `/api/workspaces/back-up` and `/api/workspaces/restore`). A backup is made while the application runs: it holds the saved-publication lock, so a save in progress makes it wait and then refuse, copies only the files the application wrote with a manifest of their SHA-256 checksums, and is written into a hidden folder that takes its name only when complete. A restore checks every file, refuses a changed, incomplete or other-format backup with what to do, opens the copy as a workspace and checks its sources, records and saved revisions before giving it its name; the restored workspace keeps its identity. The folder of record documents (a path of this computer) is not backed up and is said so. `tools/qualify_backup_restore.py` qualifies this in the built browser across an actual restart; `tests/test_issue26_backup_restore.py` covers a restore in a second process and the refusals. Cross-machine and cross-operating-system restores are not measured.

`tools/benchmark_capacity.py` automates the stopped-copy byte checks and new-process selection/evidence/run verification on its own synthetic data. Human execution here still checks the Windows filesystem, actual artifact and browser experience.

Browser-local stages and last-reading convenience state are not in the workspace. They may be absent in another browser/port even when restoration is correct. Workspace migration and recovery from power loss are unqualified; a live backup is the application's own backup above, not a copy of the folder. On an upgrade, keep an untouched stopped backup and the previous installer/bundle; unsupported formats must be refused, not manually edited. If an upgrade fails, stop it and open a separate untouched pre-upgrade copy using the previous matching candidate; never assume a newer workspace can be downgraded.

## 5. Capacity and receipt

Run the [capacity procedure](capacity.md) on the target Windows machine with the matching source/runtime, and measure the actual browser journey at proposed sizes separately. Record peak process working set, disk use, raw timings, browser latency, timeouts and any limits. Agree acceptance budgets before declaring a tier; passing a tiny correctness fixture is not capacity evidence.

Use this evidence index outside the repository:

| Field | Operator result |
| --- | --- |
| Candidate commit, CI run and artifact digest | Pending |
| Windows/hardware/Python/browser/scaling | Pending |
| Installer/offline/local asset observations | Pending |
| Literal investigation and expectation checks | Pending |
| Keyboard/focus/error/retry checks | Pending |
| Save/restart and stopped backup/restore | Pending |
| Capacity receipts and agreed budgets | Pending; no supported tier |
| Missing capabilities and failures | Record each; do not omit not-run checks |
| Reviewer and date | Pending |

Keep automated, measured and human evidence separate. A candidate stays a candidate until the required gates pass; none is implied by adding this checklist.
