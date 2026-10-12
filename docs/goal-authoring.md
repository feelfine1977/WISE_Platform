# Goal and expectation authoring

Goal authoring is a target application workflow, not currently implemented in M0. It supports the first incident release without becoming an exploration prerequisite or a separate runtime server. It shares imported evidence, identities, tasks and storage with investigations. Method alone evaluates supported norms.

## First incident workflow

An analyst starts from an investigation, states an expectation and its rationale, binds it to recorded evidence, reviews readiness, and requests validation/evaluation when useful. The application preserves draft edits after a failed action and distinguishes the saved definition from unsaved text. Returning to the investigation preserves the selected incidents and comparison.

Initial definitions address resolution timing, reassignment and reopening. Resolution endpoints and pairing are explicit: first response, final resolution and complete reopening cycles are different measurements. A repeated status row, an activity occurrence and a distinct assignment change are different units. Recorded changes are review signals until a reviewed business expectation defines an unacceptable outcome. No company SLA is invented.

| Capability | First release behavior | Later extension |
| --- | --- | --- |
| Human intent and rationale | Optional local goal/question text linked to the investigation | Reference strategies and competing improvement hypotheses |
| Operational binding | Scope, recorded anchors, endpoint/pairing, clock, target and missingness | Qualified lifecycle/object rules and richer calendars |
| Target provenance | Units, source/owner, scope and exploratory/reviewed status | Empirical suggestions kept separate from approved policy |
| Review and readiness | Field-specific blockers, versioned draft/reviewed definitions, no stale success | Rich consistency checks and external reviewed-definition exchange |
| Supported norm compilation | Exact Method capability validation, typed refusal and traceable supported subset | Additional qualified rule families |
| Resolution and repeat signals | Independently expected incident examples with missingness and witnesses | Strategy alternatives and frozen sensitivity analysis |
| Source freshness | Evidence refresh creates a new revision; changed meaning reopens affected review | Broader semantic catalogue reconciliation |
| Actual scoring evidence | Method run identity, applicability, evaluated support, raw measures and witnesses | Aggregate outcome/improvement review |
| Definition continuity | Save/reopen/version linkage inside the same workspace | Shared review with enforced permissions |
| Knowledge/templates | Only a bounded reviewed incident template if needed | Versioned domain knowledge and alternatives |
| Cost, balances and objects | Not required for the incident timing/rework release | Typed derivations with units/allocation and qualified object projection |
| Scenarios and assistance | Not a first-release dependency | Explicitly reviewed, evidenced proposals and calibrated scenarios |

## Contract boundaries

`GoalDefinitionVersion` records intent, requirement role, binding, target, provenance, status and the source/preparation meaning it was reviewed against. Binding exposes only supported policies rather than a form containing theoretical options that the evaluator cannot express.

`CompileResult` returns a valid supported norm and exact definition linkage, or typed blockers. If only a subset is supported, an explicit omission/coverage manifest names what was excluded. A wholly unsupported definition produces no placeholder norm. A deadline with observation cutoff cannot silently become an unbounded lag; elapsed days cannot silently become business days; a repeated-cycle requirement cannot silently become a first-event order rule.

`ScoreRunReceipt` binds source, preparation, selection, norm version/fingerprint and exact Method artifact, with applicability, evaluated/unevaluated support, reasons and endpoint evidence. Availability is a capability/version check rather than merely the ability to import a package. Exploration and draft editing remain available when evaluation is unavailable; the first complete release still requires real qualified local scoring.

Mandatory safeguards, negotiable targets and aggregate business outcomes remain distinct. A weighted aggregate cannot cancel an affected or unassessed mandatory control. Changing a target creates a new definition and can change classifications while leaving observed behavior unchanged.

## Freshness and continuity

Appending observations changes evidence identity; changing scope, endpoint, clock, target or intended meaning changes definition identity. Both preserve earlier findings. Re-review is explicit and tied to what changed. A stale request, error or save cannot overwrite current state. A rejected save leaves the stored revision unchanged and retains edited fields for correction.

Cutoff input retains the instant and entered-zone provenance. A cutoff before source records is rejected. Precision and timezone assumptions are visible; fixed UTC offsets are not business calendars. Numeric zero and false values stay distinct from missing input.

## Score-to-map linkage

Goal authoring produces definitions. A separate projection uses actual Method results to supply map marks, coverage and witnesses through Flow's versioned scene format. Context highlights and example reference marks remain separate. A whole-rule count displayed at several anchors is labelled as such and cannot be summed into a local affected total. Clicking a mark or table row opens real complete-case evidence.

## Acceptance progression

1. Open and save an unscored investigation, then create a draft local incident expectation without changing its membership.
2. Exercise valid, missing, ambiguous and unsupported bindings; show precise blockers while retaining edits.
3. Validate the actual pinned Method artifact against independently expected endpoint/count cases, including equality at a threshold, missing responses, cutoff, repeats and ties.
4. Qualify resolution, distinct assignment-change and reopening units individually. Refuse unsupported meaning instead of adding an application threshold evaluator.
5. Join reviewed definition, valid norm, actual run, coverage/witnesses, linked views and save/restart. Guard cancellation, obsolete results and missing dependencies.
6. Add later knowledge, sensitivity, objects, costs or proposals only with independent examples and the relevant data/deployment decision.

See [design perspectives](design.md), [requirements](requirements.md), [roadmap](roadmap.md) and [goal-authoring decision](adr/0004-goal-authoring.md).

## Scope and score identity

The reviewed norm carries applicability scope through Method's supported selection grammar. Method evaluates that scope and returns applicability/value/reasons; platform descriptive predicates do not replace it. A view filters existing scores from a named run. Explicit subset evaluation creates a new run and calibration identity, never a silent rescore of displayed cases.

Show raw interval/count, graded value, target, saturation width and the library's affected definition. Expose supported missing-response choices (skip or violated) and occurrence pairing (such as first or first-after) with their meaning. A descriptive threshold test is not the graded score. Unsupported options refuse rather than approximating another rule.
