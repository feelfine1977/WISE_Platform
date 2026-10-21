"""Replay registered BPIC19 actions inside the existing saved revision.

Queries are data, validated by their registered HTTP boundary. No action is code,
and no result is recovered by scanning a shared output directory.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from wise_platform_analytics.preparation import content_identity

from .bpic19_measures import Bpic19Measures
from .bpic19_profiles import Bpic19Profiles
from .imports import Imports
from .workspace import Problem
from .strict_reading import alternatives_of, read_strictly
from .bpic19_selection_keep import association_keep_problem, keep_step_problem, profile_keep_problem


def _request_model(operation):
    from .generated import (bpic19_profile, bpic19_measures, bpic19_cohorts,
                            bpic19_operators, bpic19_scoring, bpic19_flow_comparison,
                            bpic19_interval_comparison, bpic19_recipe_comparison)
    models = {
        "bpic19_profile": (bpic19_profile, "Bpic19ProfileRequest"),
        "bpic19_measures": (bpic19_measures, "Bpic19MeasuresRequest"),
        "bpic19_cohorts": (bpic19_cohorts, "Bpic19CohortsRequest"),
        "bpic19_score": (bpic19_scoring, "Bpic19ReadRequest"),
        "bpic19_flow_comparison": (bpic19_flow_comparison, "Bpic19FlowComparisonRequest"),
        "bpic19_interval_comparison": (bpic19_interval_comparison, "Bpic19IntervalComparisonRequest"),
        "bpic19_operator_comparison": (bpic19_recipe_comparison, "Bpic19RecipeComparisonRequest"),
        "bpic19_cohort_comparison": (bpic19_recipe_comparison, "Bpic19RecipeComparisonRequest"),
    }
    for name in ("ordinal", "fifo", "cancellation", "rule", "waiting"):
        models["bpic19_" + name] = (bpic19_operators, "Bpic19OperatorRequest")
    module, name = models[operation]
    return getattr(module, name), alternatives_of(module)


def canonical_output(answer: dict) -> dict:
    return {key: value for key, value in answer.items()
            if key not in {"request_id", "query_revision", "workspace_id", "native_exemplar_pages"}}


def _registered_bindings(imports: Imports, actions: list[dict]) -> dict | Problem:
    """Resolve only finite shipped bindings, before replaying any action.

    A previously supported operation whose local binding is disabled is an
    unavailable saved reference. Unknown operations remain admission failures.
    Neither state accepts a caller-supplied module or replacement interpreter.
    """
    registry = {}
    operator_names = {"bpic19_ordinal", "bpic19_fifo", "bpic19_cancellation", "bpic19_rule", "bpic19_waiting"}
    for index, action in enumerate(actions):
        name = action["operation"]
        field = f"bpic19_pipeline.actions.{index}.operation"
        if name == "bpic19_method_gate":
            continue
        try:
            if name == "bpic19_profile":
                binding, message = getattr(Bpic19Profiles(imports), "profile", None), "bpic19_profile_request"
            elif name == "bpic19_measures":
                binding, message = getattr(Bpic19Measures(imports), "measures", None), "bpic19_measures_request"
            elif name == "bpic19_cohorts":
                from .bpic19_cohorts import Bpic19Cohorts
                binding, message = getattr(Bpic19Cohorts(imports), "cohorts", None), "bpic19_cohorts_request"
            elif name in operator_names:
                from .bpic19_operators import Bpic19Operators
                binding, message = getattr(Bpic19Operators(imports), "operators", None), "bpic19_operator_request"
            elif name == "bpic19_score":
                from .bpic19_scoring import Bpic19Scoring
                binding, message = getattr(Bpic19Scoring(imports), "read_saved_snapshot", None), "bpic19_read_request"
            elif name == "bpic19_flow_comparison":
                from .bpic19_flow_comparison import Bpic19FlowComparisons
                binding, message = getattr(Bpic19FlowComparisons(imports), "compare", None), "bpic19_flow_comparison_request"
            elif name == "bpic19_interval_comparison":
                from .bpic19_interval_comparison import Bpic19IntervalComparisons
                binding, message = getattr(Bpic19IntervalComparisons(imports), "compare", None), "bpic19_interval_comparison_request"
            elif name in {"bpic19_operator_comparison", "bpic19_cohort_comparison"}:
                from .bpic19_recipe_comparison import Bpic19RecipeComparisons
                service = Bpic19RecipeComparisons(imports)
                dependency = getattr(service.operators, "operators", None) if name == "bpic19_operator_comparison" else getattr(service.cohorts, "cohorts", None)
                binding, message = getattr(service, "compare", None), "bpic19_recipe_comparison_request"
                if not callable(dependency):
                    return Problem("artifact_unavailable", "A declared recipe comparison's registered inner binding is unavailable. No replacement recipe was used.", field)
            else:
                return Problem("unsupported_action", "This pipeline action is not registered.", field)
        except ImportError:
            return Problem("artifact_unavailable", "The saved action's finite registered local binding cannot be loaded. Nothing was computed again.", field)
        if not callable(binding):
            return Problem("artifact_unavailable", "The saved action's finite registered local binding is unavailable. Nothing was computed again.", field)
        registry[name] = (binding, message)
    return registry


def replay_pipeline(imports: Imports, workspace_id: str, pipeline: dict | None,
                    allowed_identities: list[dict], *, selection_recipe: dict | None = None,
                    selection_prefix_identities: list[dict] | None = None,
                    selection_prefix_supports: list[dict] | None = None) -> dict | None | Problem:
    if pipeline is None:
        return None
    claims = pipeline.get("literature_claims", [])
    if len({claim["claim_id"] for claim in claims}) != len(claims):
        return Problem("invalid_parameter", "Literature claim identifiers must be distinct.", "bpic19_pipeline.literature_claims")
    run_ids = {action["query"].get("run_id") for action in pipeline["actions"] if action["operation"] == "bpic19_score" and isinstance(action["query"].get("run_id"), str)}
    for index, claim in enumerate(claims):
        if claim["compared_run_id"] is not None and claim["compared_run_id"] not in run_ids:
            return Problem("identity_mismatch", "A literature comparison may reference only an explicitly retained native score run.", f"bpic19_pipeline.literature_claims.{index}.compared_run_id")
    # Admission gates are finite data from the reviewed source-method ledger.
    # A partial run may omit these gates; it cannot hide a failed supported step.
    gate = None
    declared_gate = next((index for index, action in enumerate(pipeline["actions"])
                          if action["operation"] == "bpic19_method_gate"), None)
    if declared_gate is not None:
        field = f"bpic19_pipeline.actions.{declared_gate}.query"
        try:
            gate = json.loads((Path(__file__).parent / "bpic19_reference" / "source-method-gate.json").read_text(encoding="utf-8"))
        except (OSError, ValueError, UnicodeError, RecursionError):
            return Problem("artifact_unavailable", "The declared source-method admission ledger cannot be read. No omission definition was substituted and no source method was admitted.", field)
        # This local ledger has no recorded descriptor checksum. Malformed
        # admission data is unavailable, never a claimed checksum mismatch.
        query = gate.get("query") if isinstance(gate, dict) else None
        if (not isinstance(gate, dict) or set(gate) != {"query", "definition_id"}
                or not isinstance(gate.get("definition_id"), str)
                or re.fullmatch(r"bpic19-method-gate\.v1:sha256:[a-f0-9]{64}", gate["definition_id"]) is None
                or not isinstance(query, dict)
                or set(query) != {"policy_id", "method_id", "source_locator", "gate_reason"}
                or any(not isinstance(value, str) or not value.strip() for value in query.values())
                or query["policy_id"] != "bpic19.report_method_gate.v1"
                or query["method_id"] != "R13.weighted_many_to_many"):
            return Problem("artifact_unavailable", "The declared source-method admission ledger has no usable registered omission definition. Nothing was substituted or admitted.", field)
    omissions = []
    for index, action in enumerate(pipeline["actions"]):
        if action["identity"] not in allowed_identities:
            return Problem("identity_mismatch", "A saved action must use a replayed investigation population.", f"bpic19_pipeline.actions.{index}.identity")
        if action["operation"] != "bpic19_method_gate":
            continue
        if action["query"] != gate["query"] or action["definition_id"] != gate["definition_id"]:
            return Problem("unsupported_policy", "This source-method gate is not a registered reviewed definition.", f"bpic19_pipeline.actions.{index}.query")
        omissions.append({"step": index + 1, "operation": action["operation"],
                          "definition_id": action["definition_id"], "identity": action["identity"],
                          **{key: gate["query"][key] for key in ("method_id", "source_locator", "gate_reason")}})
    if omissions and pipeline.get("replay_mode", "require_all") != "partial":
        first = omissions[0]
        return Problem("unsupported_policy", f"Step {first['step']} is not admitted: {first['source_locator']}. {first['gate_reason']}",
                       f"bpic19_pipeline.actions.{first['step'] - 1}.query")
    registry = _registered_bindings(imports, pipeline["actions"])
    if isinstance(registry, Problem):
        return registry
    operator_names = {"bpic19_ordinal", "bpic19_fifo", "bpic19_cancellation", "bpic19_rule", "bpic19_waiting"}
    comparison_names = {"bpic19_operator_comparison", "bpic19_cohort_comparison"}
    keys = [(action["operation"], action["definition_id"], json.dumps(action["identity"], sort_keys=True, separators=(",", ":")),
             json.dumps(action.get("selection_keep"), sort_keys=True, separators=(",", ":"))) for action in pipeline["actions"]]
    if len(set(keys)) != len(keys):
        return Problem("invalid_parameter", "A reviewed action definition may appear once per exact population identity in a saved pipeline.", "bpic19_pipeline.actions")
    # Admit every closed request before any service computes an output. Partial
    # mode omits only the explicit registered source gate, never a malformed
    # admitted query. This also checks both inner recipes of a comparison.
    envelopes = {}
    for index, action in enumerate(pipeline["actions"]):
        field = f"bpic19_pipeline.actions.{index}"
        problem = keep_step_problem(action, selection_recipe, selection_prefix_identities,
                                    allowed_identities[0], field + ".selection_keep")
        if problem is not None: return problem
        if action["operation"] == "bpic19_method_gate": continue
        registered = registry.get(action["operation"])
        if registered is None: return Problem("unsupported_action", "This pipeline action is not registered.", field + ".operation")
        given = {"schema_version": 1, "message_type": registered[1], "request_id": "saved-bpic19-" + str(index),
                 "query_revision": 1, "workspace_id": workspace_id, "identity": action["identity"], "query": action["query"]}
        if action["operation"] == "bpic19_score":
            allowed = {"run_id", "case_offset", "case_limit", "group_offset", "group_limit", "case_filter"}
            if set(action["query"]) - allowed: return Problem("invalid_parameter", "A saved score action names only a stored run and its declared page.", field + ".query")
            given.pop("identity"); given.pop("query"); given.update(action["query"])
        model, alternatives = _request_model(action["operation"])
        if isinstance(read_strictly(given, model, alternatives), list):
            return Problem("invalid_parameter", "The saved action does not match its registered request contract.", field + ".query")
        if action["operation"] in comparison_names:
            query = action["query"]
            operator = query["policy_id"] == "bpic19.ordinal_fifo_comparison.v1"
            if operator != (action["operation"] == "bpic19_operator_comparison"):
                return Problem("identity_mismatch", "The saved pair names another comparison operation.", field + ".operation")
            for role in (("ordinal", "fifo") if operator else ("target", "reference")):
                inner = {**given, "message_type": "bpic19_operator_request" if operator else "bpic19_cohorts_request", "query": query[role]["query"]}
                inner_model, inner_alternatives = _request_model("bpic19_ordinal" if operator else "bpic19_cohorts")
                if isinstance(read_strictly(inner, inner_model, inner_alternatives), list):
                    return Problem("invalid_parameter", "A compared recipe does not match its registered request contract.", field + ".query." + role)
        envelopes[index] = given
    outputs = []
    for index, action in enumerate(pipeline["actions"]):
        if action["operation"] == "bpic19_method_gate":
            continue
        field = f"bpic19_pipeline.actions.{index}"
        if action["identity"] not in allowed_identities:
            return Problem("identity_mismatch", "A saved action must use this investigation's base, frozen parent, selected population or a replayed selection prefix.", field + ".identity")
        registered = registry.get(action["operation"])
        if registered is None:
            return Problem("unsupported_policy", "This pipeline action is not registered.", field + ".operation")
        operation, message_type = registered
        given = envelopes[index]
        reply = operation(json.dumps(given, allow_nan=False).encode())
        if reply.status != 200:
            if action["operation"] == "bpic19_score" and reply.body.get("code") in {"artifact_unavailable", "checksum_mismatch"}:
                return Problem(reply.body["code"], "The saved native output could not be read: " + reply.body["message"], field + ".query.run_id")
            return Problem("invalid_parameter", "The saved action was refused: " + reply.body["message"], field + ".query")
        answer = reply.body
        if action["operation"] in comparison_names and answer.get("operation") != action["operation"]:
            return Problem("identity_mismatch", "The reviewed recipe pair names another registered comparison.", field + ".operation")
        if action["operation"] in operator_names and answer.get("operation") != action["operation"]:
            return Problem("identity_mismatch", "The operator recipe differs from the reviewed saved action.", field + ".operation")
        if action["operation"] == "bpic19_score" and answer.get("named_population", {}).get("identity") != action["identity"]:
            return Problem("identity_mismatch", "The stored score run belongs to another population.", field + ".identity")
        definition_id = answer.get("definition_id")
        if action["operation"] == "bpic19_profile":
            definition_id = (answer.get("profile") or {}).get("definition_id")
        if definition_id is None or definition_id != action["definition_id"]:
            return Problem("identity_mismatch", "The action definition is unreviewed or differs from the displayed result.", field + ".definition_id")
        keep = action.get("selection_keep")
        if keep is not None and keep["group"]["kind"] == "association_set":
            from .bpic19_scoring import Bpic19Scoring
            selection = {key: value for key, value in keep["group"].items() if key != "kind"}
            resolved = Bpic19Scoring(imports).association_members(workspace_id, action["query"]["run_id"], selection,
                                                                  field + ".selection_keep.group")
            if isinstance(resolved, Problem): return resolved
            problem = association_keep_problem(*resolved, keep, selection_recipe, selection_prefix_supports,
                                               field + ".selection_keep")
        else:
            problem = profile_keep_problem(action, answer, selection_recipe, selection_prefix_supports,
                                           field + ".selection_keep")
        if problem is not None: return problem
        payload = canonical_output(answer)
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        outputs.append({"operation": action["operation"], "definition_id": definition_id,
                        "sha256": hashlib.sha256(raw).hexdigest(), "output": payload})
    if not outputs:
        return Problem("unsupported_policy", "A partial pipeline needs at least one admitted result; omissions alone are not an analysis.", "bpic19_pipeline.actions")
    manifest = {"schema_version": 1, "outputs": outputs}
    if claims: manifest["literature_claims"] = claims
    if omissions or "replay_mode" in pipeline or claims:
        manifest.update(claim_level="partial" if omissions else "complete_registered_pipeline", omissions=omissions)
        manifest["run_id"] = content_identity("bpic19-pipeline", {"recipe": pipeline, "manifest": manifest})
    return manifest
