# Domain glossary

| Term | Meaning |
| --- | --- |
| Incident / case | A case is the selected process instance; incident is the first domain’s word for it. A case selection retains its complete recorded history. |
| Record / event | One original recorded event or change. Record count and distinct incident support are different units. |
| Source snapshot | Immutable imported bytes plus source identity and observed cutoff. |
| Preparation revision | Versioned interpretation: mapping, parser, time, ordering, lifecycle, missingness and duplicate decisions. |
| Case dictionary | Namespace-bound mapping between original case identifiers and internal membership identities. |
| Process representation | Named ordered activity/state/assignment projection derived from prepared records. |
| Passage | One observed adjacent pair in the declared mapped representation. A case can contribute repeated passages. |
| Variant | A complete ordered mapped sequence including repeats, with exact supporting cases. |
| Investigation | A saved analytical question and its revisions, findings and evidence; scoring is optional. |
| Investigation revision | Immutable question, interpretation, population, comparison roles, definitions and answer references. |
| Parent population P | Frozen population after retained filters and eligibility, before the comparison predicate. |
| Kept A / removed B | Literal predicate partitions of P. These names do not imply good/bad or target/reference. |
| Unevaluable U | Cases whose predicate or measure cannot be evaluated under the declared policy; not a successful complement. |
| Target / comparator | Named semantic comparison roles assigned independently of A/B. |
| Outcome-known population K | Cases for which a separately defined outcome is known; its denominator need not equal P. |
| Context projection | Named anchor/reducer for an attribute: opening, latest-at-snapshot or ever, with availability and overlap behavior. |
| Composition ratio | Category share in the target divided by its share in the comparator, with explicit support. |
| Outcome rate | Share with a named outcome within a category and its outcome-known population; different from composition. |
| Norm revision | Operational expectation, scope, endpoints, clock, target and missingness definition supplied to Method. |
| Score run | Actual Method evaluation bound to source, preparation, norm and implementation versions. |
| Evidence reference | Pinned case/record/endpoint witness with sufficient identity to reopen and verify it. |
| Finding / bookmark | Analyst interpretation or navigation reference pinned to an investigation revision and evidence. |
| Presentation state | Viewport, detail, sorting and leading view; resetting these does not change analytical truth. |
| Capacity tier | Declared source sizes, machine and runtime with measured memory, disk and time limits for named operations; never an assumed scale. |
| Workspace | External local runtime storage for snapshots, metadata, immutable artifacts and saved investigations. |
