"""Replay registered BPIC19 actions inside the existing saved revision.

Queries are data, validated by their registered HTTP boundary. No action is code,
and no result is recovered by scanning a shared output directory.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from wise_platform_analytics.preparation import content_identity

from .bpic19_measures import Bpic19Measures
from .bpic19_profiles import Bpic19Profiles
from .imports import Imports
from .workspace import Problem


def canonical_output(answer: dict) -> dict:
    return {key: value for key, value in answer.items()
            if key not in {"request_id", "query_revision", "workspace_id"}}


def replay_pipeline(imports: Imports, workspace_id: str, pipeline: dict | None,
                    allowed_identities: list[dict]) -> dict | None | Problem:
    if pipeline is None:
        return None
    # Admission gates are finite data from the reviewed source-method ledger.
    # A partial run may omit these gates; it cannot hide a failed supported step.
    gate = json.loads((Path(__file__).parent / "bpic19_reference" / "source-method-gate.json").read_text())
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
    registry = {"bpic19_profile": (Bpic19Profiles(imports).profile, "bpic19_profile_request"),
                "bpic19_measures": (Bpic19Measures(imports).measures, "bpic19_measures_request")}
    # Imports are local to an explicitly selected, registered operation. Supplied
    # queries never name a module, callable, command or external output folder.
    operations = {action["operation"] for action in pipeline["actions"]}
    if "bpic19_cohorts" in operations:
        from .bpic19_cohorts import Bpic19Cohorts
        registry["bpic19_cohorts"] = (Bpic19Cohorts(imports).cohorts, "bpic19_cohorts_request")
    operator_names = {"bpic19_ordinal", "bpic19_fifo", "bpic19_cancellation", "bpic19_rule", "bpic19_waiting"}
    if operations & operator_names:
        from .bpic19_operators import Bpic19Operators
        operator = Bpic19Operators(imports).operators
        for name in operator_names:
            registry[name] = (operator, "bpic19_operator_request")
    if "bpic19_score" in operations:
        from .bpic19_scoring import Bpic19Scoring
        registry["bpic19_score"] = (Bpic19Scoring(imports).read, "bpic19_read_request")
    if "bpic19_flow_comparison" in operations:
        from .bpic19_flow_comparison import Bpic19FlowComparisons
        registry["bpic19_flow_comparison"] = (Bpic19FlowComparisons(imports).compare, "bpic19_flow_comparison_request")
    if "bpic19_interval_comparison" in operations:
        from .bpic19_interval_comparison import Bpic19IntervalComparisons
        registry["bpic19_interval_comparison"] = (Bpic19IntervalComparisons(imports).compare, "bpic19_interval_comparison_request")
    keys = [(action["operation"], action["definition_id"], json.dumps(action["identity"], sort_keys=True, separators=(",", ":"))) for action in pipeline["actions"]]
    if len(set(keys)) != len(keys):
        return Problem("invalid_parameter", "A reviewed action definition may appear once per exact population identity in a saved pipeline.", "bpic19_pipeline.actions")
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
        given = {"schema_version": 1, "message_type": message_type,
                 "request_id": "saved-bpic19-" + str(index), "query_revision": 1,
                 "workspace_id": workspace_id, "identity": action["identity"], "query": action["query"]}
        if action["operation"] == "bpic19_score":
            allowed = {"run_id", "case_offset", "case_limit", "group_offset", "group_limit", "case_filter"}
            if set(action["query"]) - allowed:
                return Problem("invalid_parameter", "A saved score action names only a stored run and its declared page.", field + ".query")
            given.pop("identity"); given.pop("query"); given.update(action["query"])
        reply = operation(json.dumps(given, allow_nan=False).encode())
        if reply.status != 200:
            return Problem("invalid_parameter", "The saved action was refused: " + reply.body["message"], field + ".query")
        answer = reply.body
        if action["operation"] in operator_names and answer.get("operation") != action["operation"]:
            return Problem("identity_mismatch", "The operator recipe differs from the reviewed saved action.", field + ".operation")
        if action["operation"] == "bpic19_score" and answer.get("named_population", {}).get("identity") != action["identity"]:
            return Problem("identity_mismatch", "The stored score run belongs to another population.", field + ".identity")
        definition_id = answer.get("definition_id")
        if action["operation"] == "bpic19_profile":
            definition_id = (answer.get("profile") or {}).get("definition_id")
        if definition_id is None or definition_id != action["definition_id"]:
            return Problem("identity_mismatch", "The action definition is unreviewed or differs from the displayed result.", field + ".definition_id")
        payload = canonical_output(answer)
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        outputs.append({"operation": action["operation"], "definition_id": definition_id,
                        "sha256": hashlib.sha256(raw).hexdigest(), "output": payload})
    if not outputs:
        return Problem("unsupported_policy", "A partial pipeline needs at least one admitted result; omissions alone are not an analysis.", "bpic19_pipeline.actions")
    manifest = {"schema_version": 1, "outputs": outputs}
    if omissions or "replay_mode" in pipeline:
        manifest.update(claim_level="partial" if omissions else "complete_registered_pipeline", omissions=omissions)
        manifest["run_id"] = content_identity("bpic19-pipeline", {"recipe": pipeline, "manifest": manifest})
    return manifest
