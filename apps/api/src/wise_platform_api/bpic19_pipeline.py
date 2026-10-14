"""Replay the finite BPIC19 foundation actions inside the existing saved revision.

Queries are data, validated by their registered HTTP boundary. No action is code,
and no result is recovered by scanning a shared output directory.
"""

from __future__ import annotations

import hashlib
import json

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
    registry = {"bpic19_profile": Bpic19Profiles(imports).profile,
                "bpic19_measures": Bpic19Measures(imports).measures}
    operations = [action["operation"] for action in pipeline["actions"]]
    if len(set(operations)) != len(operations):
        return Problem("invalid_parameter", "Each foundation action may appear once in a saved pipeline.", "bpic19_pipeline.actions")
    outputs = []
    for index, action in enumerate(pipeline["actions"]):
        field = f"bpic19_pipeline.actions.{index}"
        if action["identity"] not in allowed_identities:
            return Problem("identity_mismatch", "A saved action must use this investigation's base, parent or selected population.", field + ".identity")
        operation = registry.get(action["operation"])
        if operation is None:
            return Problem("unsupported_policy", "This pipeline action is not registered.", field + ".operation")
        given = {"schema_version": 1, "message_type": action["operation"] + "_request",
                 "request_id": "saved-bpic19-" + str(index), "query_revision": 1,
                 "workspace_id": workspace_id, "identity": action["identity"], "query": action["query"]}
        reply = operation(json.dumps(given, allow_nan=False).encode())
        if reply.status != 200:
            return Problem("invalid_parameter", "The saved action was refused: " + reply.body["message"], field + ".query")
        answer = reply.body
        definition_id = answer.get("definition_id")
        if action["operation"] == "bpic19_profile":
            definition_id = (answer.get("profile") or {}).get("definition_id")
        if definition_id is None or definition_id != action["definition_id"]:
            return Problem("identity_mismatch", "The action definition is unreviewed or differs from the displayed result.", field + ".definition_id")
        payload = canonical_output(answer)
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        outputs.append({"operation": action["operation"], "definition_id": definition_id,
                        "sha256": hashlib.sha256(raw).hexdigest(), "output": payload})
    return {"schema_version": 1, "outputs": outputs}
