# Architecture requirements

This document defines the target application. M0 currently implements the local host, health boundary and foundation screen. Requirements below are completed only by their acceptance evidence, not by the presence of documentation or a type.

## First release outcome

A business analyst starts the application at localhost on Windows 11, imports a private event-history CSV, reviews its interpretation and investigates incidents through linked ordinary charts and process mining. The analyst can compare groups, periods and the kept/removed sides of a selected predicate; inspect complete histories and context; optionally apply locally configured WISE expectations; and save, stop and reopen the same investigation. Data and analytical artifacts stay in a chosen local workspace. No executable, notebook, container, remote service or external assistant is required for this journey.

The first release is case based. One CSV row is a recorded event or change associated with an incident. A snapshot with one row per incident requires a different, explicit interpretation; it cannot silently become event history. Related business objects and advanced models follow a reliable case-based experience.

## Requirements and evidence

| Requirement | Delivery gate | Required behavior and acceptance evidence |
| --- | --- | --- |
| AR01 Source and preparation identity | M1a | Retain source fingerprint, mapping, parser and time/order/null/duplicate policy versions. Changing preparation creates a new revision; old findings keep their meaning. |
| AR02 Exact complete-incident selection | M1a | Resolve exact membership, retain all records, and distinguish kept, removed, unevaluable and out-of-scope populations. Independent synthetic IDs and counts must agree. |
| AR03 One process representation | M1a–b | Map, matrix and variants use the same ordered mapped sequence, including repeats, missing-label gaps and end policy. Detail controls do not change membership or fabricate direct relations. |
| AR04 Anchored context | M1a | Opening context preserves unavailable values at the chosen anchor. Latest and ever are separately named policies with their own availability and overlap behavior. |
| AR05 Typed analytical answers | M1a–b | Each measure identifies unit, raw support, denominator, population, direction and unavailable reason. Composition ratios and outcome rates are different measures. |
| AR06 Unscored exploration | M1b | Charts, map, matrix, variants, profiles and evidence work without a norm or score run. Saving an unscored investigation does not create a dummy definition. |
| AR07 Coherent linked state | M1b | All panels show one query revision. Stale successes, errors and pages cannot replace current evidence. Preview, refine, reverse, invert, undo and rebase are distinguishable. |
| AR08 Renderer boundary | M1b | Flow receives a versioned supplied scene and emits typed intents. The host resolves them; the renderer does not query raw records, score or silently filter cases. Keep activity positions stable across revisions until requested rearrangement, and keep readable filter labels after elements disappear. |
| AR09 Durable investigation | M1c | Persist definitions, populations, roles, notes, bookmarks and complete evidence. Stop/restart restores meaning; missing or changed sources produce understandable refusal or explicit refresh. |
| AR10 Task and publication correctness | M1a–c | Task/cache identity includes source, interpretation, request and implementation versions. Failed, canceled or stale jobs cannot publish partially matched metadata/artifacts. |
| AR11 Compatible release composition | M0–M1d | Ship exact application, asset, schema and external-library versions and applicable notices. An incompatible Method or Flow artifact is refused with a useful diagnostic. |
| AR12 Windows operation | M0–M1d | Start CI with the foundation, then qualify the complete human journey on a named Windows/CPU/runtime tier, including Unicode paths, locked files and restart. |
| AR13 Private local data | M1a–d | Local assets and analytics operate offline after setup. Diagnostics and exports declare their contents and local destination. No automatic data upload or telemetry of record contents. |
| AR14 Measured capacity | M1d | Record supported file/case/event tiers, latency, memory/disk and cancellation behavior. Exact versus sampled/approximate results remain explicit. |
| AR15 Later team adapters | M4 | Require an explicit deployment decision, enforced authorization, tenant/artifact isolation, concurrency, backup and residency qualification before shared use. |
| AR16 Simple maintained structure | M0 and ongoing | One application home, named external libraries and clearly separated runtime workspace. Historical sources are retired only through reviewed, reversible preservation and relocation. |
| AR17 Local expectation authoring | M1c | Human intent becomes a reviewed operational definition with scope, endpoints, clock, target, missingness and version. Method alone validates and evaluates supported norms. |
| AR18 Product/runtime separation | M0 and ongoing | Track product source, ordinary documentation, synthetic tests and legal notices. Runtime data, secrets, environments, caches and private working material stay outside tracked source. |
| AR19 Canonical descriptive analytics | M1a | A pure reusable module owns descriptive meanings. Execution adapters must meet independent parity; browser and storage layers do not invent competing formulas. |
| AR20 Honest release qualification | M0–M1d | Distinguish source setup from a release containing built assets. Windows CI configuration is not a Windows result; fixture arithmetic is not passing product acceptance. |

## First analytical acceptance journey

1. Import synthetic incident history with repeated transfers, reopening, missing resolution and missing context.
2. Confirm mapping, ordering, snapshot cutoff, preserved rows and preparation identity.
3. Select an assignment group and a duration tail through charts; compare exact complete incidents in all views.
4. Open a matrix cell and an actual variant; inspect complete histories and source witnesses.
5. Compare recorded-resolution and no-recorded-resolution cohorts within a frozen eligible parent. Display both profiles, counts, percentage-point differences and concentration ratios, keeping missing categories visible.
6. Compare groups and incident-start periods with common definitions and follow-up coverage.
7. Optionally author a resolution/reassignment/reopening expectation, review applicability and raw measurements, then inspect actual score witnesses.
8. Save a finding and two-case comparison. Stop and reopen the same question, definitions and evidence.

Absence of a recorded resolution is not a business verdict that an incident remains unresolved. A concentration difference is not proof of cause or staff/vendor performance. A threshold change can change classifications without changing the process.

## Qualification and open engineering choices

The synthetic fixtures freeze the currently specified membership, mapped-sequence, missing-context and denominator answers. Additional tests must qualify exact threshold equality, conflicting timestamp/order authorities, duplicate policies, source freshness, asynchronous publication, browser interaction and Windows capacity.

Exact Method/Flow release pins, analytical contract versioning, artifact migrations and capacity tiers are integration decisions backed by tests. A faster storage/query technology is replaceable; it does not change analytical meaning. Existing source is a reuse candidate rather than a compatibility obligation. The new application does not promise to read historical workspace databases.

See [design perspectives](design.md), [architecture decisions](adr/README.md), [roadmap](roadmap.md) and [testing](testing.md).

Scoring qualification also checks selected-from-run versus explicitly rescored-subset identity, population-dependent calibration, Method-owned applicability, raw/graded values, affected support, target/width and missing-response/pairing choices. The map qualification gate includes stable positions and readable removed-activity/attribute filters.
