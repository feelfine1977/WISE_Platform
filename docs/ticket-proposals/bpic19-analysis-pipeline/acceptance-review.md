# BPIC19 Priority 1 acceptance review

14 October 2026. All **27 approved delivery tickets, #103–129**, have extended user stories and exact acceptance cases. The **165 ticket-level stories** complement the original 104-story specification. There are **253 domain acceptance cases** and **577 acceptance checks in total**, retaining the approved baseline and seven common integration cases per ticket. The parent specification #102 is reviewed through this companion; its tracker body and status are preserved.

This is a requirements review, not a claim that the tickets are implemented or qualified. Every acceptance box remains unchecked until a receipt establishes the stated behavior. Priority remains first; the approved deadline is tonight, 14 October 2026, Europe/Berlin. That target does not relax the closure criteria.

## How the analyst starts

```mermaid
flowchart LR
  S[Review source and clock] --> G[Verify item and document grain]
  G --> F[Distinguish four supplied flows]
  F --> C[Choose item type and explicit cohort]
  C --> M[Inspect raw counts, intervals, actors and values]
  M --> N[Optionally select a reviewed norm]
  N --> P[Compare priorities and signed drivers]
  M --> E[Inspect full original evidence]
  P --> E
  E --> R[Save, export and reopen the frozen question]
```

The four flow categories are supplied case attributes. They do not come from discovering a model or guessing an observed event order. Four flow types, six Item Types and document-level membership are separate dimensions. A purchasing document may contain several flows. Raw descriptive investigations work before scoring.

## Each ticket's expanded requirements

Each linked ticket specifies source locators, the analyst's ordered actions, extended stories with preconditions/actions/outcomes and acceptance IDs, exact Given/When/Then cases, meaning-bearing fields, evidence/export/restart receipts and remaining gates.

| Local / tracker | Ticket and detailed stories | Stories | Domain cases |
| --- | --- | ---: | ---: |
| 01 / [#103](https://github.com/feelfine1977/WISE_Platform/issues/103) | [Review a named source and observation policy](01-review-a-named-source-and-observation-policy.md) | 6 | 10 |
| 02 / [#104](https://github.com/feelfine1977/WISE_Platform/issues/104) | [Profile case attributes and business grain](02-profile-case-attributes-and-business-grain.md) | 6 | 12 |
| 03 / [#105](https://github.com/feelfine1977/WISE_Platform/issues/105) | [Distinguish the four purchasing flow types](03-distinguish-the-four-purchasing-flow-types.md) | 6 | 12 |
| 04 / [#106](https://github.com/feelfine1977/WISE_Platform/issues/106) | [Compare flow and item-type subgroups](04-compare-flow-and-item-type-subgroups.md) | 6 | 10 |
| 05 / [#107](https://github.com/feelfine1977/WISE_Platform/issues/107) | [Inspect source-witnessed activity measures](05-inspect-source-witnessed-activity-measures.md) | 6 | 12 |
| 06 / [#108](https://github.com/feelfine1977/WISE_Platform/issues/108) | [Review flow-specific analysis and completion cohorts](06-review-flow-specific-analysis-and-completion-cohorts.md) | 6 | 13 |
| 07 / [#109](https://github.com/feelfine1977/WISE_Platform/issues/109) | [Inspect declared milestone intervals](07-inspect-declared-milestone-intervals.md) | 6 | 13 |
| 08 / [#110](https://github.com/feelfine1977/WISE_Platform/issues/110) | [Inspect qualified resource proxies](08-inspect-qualified-resource-proxies.md) | 6 | 12 |
| 09 / [#111](https://github.com/feelfine1977/WISE_Platform/issues/111) | [Review source-witnessed item-value definitions](09-review-source-witnessed-item-value-definitions.md) | 6 | 14 |
| 10 / [#112](https://github.com/feelfine1977/WISE_Platform/issues/112) | [Evaluate a multi-criterion completion norm](10-evaluate-a-multi-criterion-completion-norm.md) | 6 | 6 |
| 11 / [#113](https://github.com/feelfine1977/WISE_Platform/issues/113) | [Evaluate paper timing criteria with endpoint evidence](11-evaluate-paper-timing-criteria-with-endpoint-evidence.md) | 6 | 8 |
| 12 / [#114](https://github.com/feelfine1977/WISE_Platform/issues/114) | [Evaluate paper rework and effort criteria](12-evaluate-paper-rework-and-effort-criteria.md) | 6 | 8 |
| 13 / [#115](https://github.com/feelfine1977/WISE_Platform/issues/115) | [Rank business groups by actual Method priority](13-rank-business-groups-by-actual-method-priority.md) | 6 | 7 |
| 14 / [#116](https://github.com/feelfine1977/WISE_Platform/issues/116) | [Explain priority through signed drivers and witnesses](14-explain-priority-through-signed-drivers-and-witnesses.md) | 6 | 7 |
| 15 / [#117](https://github.com/feelfine1977/WISE_Platform/issues/117) | [Compare views and ranking settings on frozen evidence](15-compare-views-and-ranking-settings-on-frozen-evidence.md) | 6 | 8 |
| 16 / [#118](https://github.com/feelfine1977/WISE_Platform/issues/118) | [Inspect count priorities at document grain](16-inspect-count-priorities-at-document-grain.md) | 6 | 7 |
| 17 / [#119](https://github.com/feelfine1977/WISE_Platform/issues/119) | [Compare exact variants with a named signature](17-compare-exact-variants-with-a-named-signature.md) | 6 | 7 |
| 18 / [#120](https://github.com/feelfine1977/WISE_Platform/issues/120) | [Inspect inferred ordinal invoice episodes](18-inspect-inferred-ordinal-invoice-episodes.md) | 6 | 8 |
| 19 / [#121](https://github.com/feelfine1977/WISE_Platform/issues/121) | [Compare FIFO-consuming invoice matches](19-compare-fifo-consuming-invoice-matches.md) | 6 | 8 |
| 20 / [#122](https://github.com/feelfine1977/WISE_Platform/issues/122) | [Review latest-preceding cancellation matching](20-review-latest-preceding-cancellation-matching.md) | 6 | 8 |
| 21 / [#123](https://github.com/feelfine1977/WISE_Platform/issues/123) | [Explore criterion associations with explicit eligibility](21-explore-criterion-associations-with-explicit-eligibility.md) | 6 | 8 |
| 22 / [#124](https://github.com/feelfine1977/WISE_Platform/issues/124) | [Inspect milestone waiting occupancy over time](22-inspect-milestone-waiting-occupancy-over-time.md) | 6 | 8 |
| 23 / [#125](https://github.com/feelfine1977/WISE_Platform/issues/125) | [Export and replay a frozen analyst pipeline](23-export-and-replay-a-frozen-analyst-pipeline.md) | 6 | 8 |
| 24 / [#126](https://github.com/feelfine1977/WISE_Platform/issues/126) | [Qualify the full BPIC19 paper workflow](24-qualify-the-full-bpic19-paper-workflow.md) | 7 | 9 |
| 25 / [#127](https://github.com/feelfine1977/WISE_Platform/issues/127) | [Assemble the separate historical notebook profile](25-assemble-the-separate-historical-notebook-profile.md) | 7 | 11 |
| 26 / [#128](https://github.com/feelfine1977/WISE_Platform/issues/128) | [Check quantified recorded-event rules](26-check-quantified-recorded-event-rules.md) | 6 | 11 |
| 27 / [#129](https://github.com/feelfine1977/WISE_Platform/issues/129) | [Compare count and exposure-scaled priorities](27-compare-count-and-exposure-scaled-priorities.md) | 7 | 8 |

## Keep the three analytical profiles separate

| Profile | Required interpretation | Acceptance boundary |
| --- | --- | --- |
| Revised WISE paper | All 251,734 PO items; exact C01–C10; four layers; Balanced, Completion and Operations; primary flat mode and count PI at gamma zero | Ticket 24 requires the complete joined definition and real full-source workflow. Independently passing 3-, 5- or 8-criterion slices do not qualify it. |
| Historical notebook | 29 criteria; seven layers; Finance, Logistics, Compliance and Automation; source-compatible layer-balanced mode; historical invoice union, resource classification, value/CV and P95 recipes | Ticket 25 requires all 29 checks for full closure. Partial output is labelled partial. Stored figures and execution counters are historical diagnostics, not fresh-run proof. |
| Fifteen human reports | Named report-specific filters, completion definitions, event representations, interval/matching rules, value reducers and tools | The 27 slices reproduce their explicitly admitted operations. The separate 45-method ledger preserves discovery, model, inference, clustering, prediction and other extensions; coverage by a ticket number is not proof every report step executes. |

Paper C04 selects independent parsed minima before checking the 2017-inclusive/2020-exclusive range and nonnegative interval. C05 is DF1-only and accepts equality. C08's transition width is three, C09's ten and C10's five. Valid batch-only histories give zero effort; unknown attribution makes effort unavailable. These are source-defined rules, not unspecified defaults.

The historical notebook uses different invoice, resource and value rules. Source-compatible behavior and corrected product policies have different identities. First-occurrence signatures preserve no repeated labels; exact variants retain repeats. Source-eventID ordinal matching, timestamp ordinal matching and consuming FIFO are separately named recipes. Cancellation and occupancy edge conventions that the reports omit must be declared as product decisions before execution.

## Required evidence for closure

The approved seam is **real HTTP → matching built browser → exact original evidence → export/save → actual process exit → distinct fresh-process reopening**. It extends existing Investigation, selection, comparison, immutable revision and optional Score run behavior. One shared execution can supply receipts for several tickets if it separately demonstrates each ticket's complete analyst action and exact expected outcomes.

- Literal fixture expectations are authored independently from production helpers. Item/event/document/episode counts and membership, scope and availability states match exactly. Finite native numeric values use absolute tolerance 1e-8 unless a tighter domain case is declared.
- Every result names its source/preparation, parent, definition, units, numerator/denominator and raw-record witnesses. Unknown, outside scope, evaluated zero and positive deviation remain distinct.
- Editing a definition, changing a selected population or receiving a stale response cannot publish another question's answer. Semantic changes create new identities; presentation changes preserve them.
- Reopening uses the actual stopped first process and a distinct second process. Old revisions remain reopenable after defaults change. Missing or corrupt artifacts and unsupported versions are explicitly refused.
- The full workload receipt pins candidate/API/frontend/Method identities and exact input hashes, and records elapsed time, peak memory, payload/export sizes and failures or cancellation. A scan, component test, pilot or older package does not qualify the full application. No undocumented performance SLA is invented.
- Human comprehension and operational benefit are separate evidence. The requirements review neither recruits human experts nor demonstrates realised savings, fraud, authorisation failures or causal improvement.

## Source coverage and unresolved methods

The evidence corpus contains 15 human reports over 374 merged pages, all 44 historical notebook cells and the 44-page WISE manuscript. Earlier full-text and important-figure reviews provide the original step inventory. This second pass re-reads the report text and challenges the ticket-linked definitions; selected table/figure reinspections remain explicitly distinguished from prior rendering receipts. Inputs remain unchanged, and no supplied analyst notebook or helper program is executed.

| Reports | Merged PDF pages | Key requirements challenged |
| --- | --- | --- |
| R01–R07 | 1–160 | Source/grain, date filtering, four categories, completion, values, resource proxies, ordinal rules and financial interpretation |
| R08–R11 | 161–256 | FIFO, cancellation, occurrence quantifiers, scope-specific counts, copied events, completion and missingness |
| R12–R13 | 257–314 | Document/item discrepancies, duration operators, undefined approximation weights, model/statistics and claim limits |
| R14–R15 | 315–374 | Derived iterations, source-specific ordering, value reducers, waiting occupancy, matching and control hypotheses |
| Revised WISE paper | 1–44 in named paper | Exact ten-criterion norm, availability, weights, scoring reference, PI, signed drivers, exemplars and full-source reproduction |
| Historical notebook | Cells 0–43, zero-based | All 29 source-compatible criteria, seven layers/four views, calibration, signatures, associations and fresh output manifests |

All 182 original source steps remain traceable: 139 human-report, 26 notebook code and 17 paper steps. The [finite source-method ledger](source-method-activation.md) retains 45 extension briefs and 20 existing-owner amendments. The R13 weighted many-to-many approximation still lacks a complete source formula/weights. A chosen new formula can form a new reviewed profile; it cannot claim source parity. Disputed source totals and percentages stay in a discrepancy record rather than becoming simultaneous golden targets.

## Dependency frontier and priority

Native blockers remain the 41 approved relationships; all 27 children remain linked to parent #102. Immediate frontier: 01, 02, 05, 07, 08, 09 and 17. The full-paper transitive closure is 01–08, 10–16 and 23–24. A longest explicit chain is 02 → 03 → 10 → 13 → 14/15/16 → 24. Durability must be implemented from each slice's start using the existing save seam; ticket 23 is not an excuse to ship transient answers. Historical and optional report methods retain distinct execution and qualification receipts.

[Approved breakdown](breakdown.md) · [Main specification](../../implementation-specs/bpic19-analysis-pipeline.md) · [Beginning workflow](../../implementation-specs/bpic19-beginning-workflow.md).
