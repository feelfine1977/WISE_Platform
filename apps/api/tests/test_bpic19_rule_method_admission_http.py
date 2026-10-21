"""Finite synthetic rule admission through genuine child-process TCP HTTP.

This does not qualify full-source/browser/restart acceptance or native scoring.
"""

from copy import deepcopy
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

import httpx

from test_bpic19_operators_http import (
    ROUTE,
    RULE,
    FIFO,
    ORDINAL,
    CANCELLATION,
    WAITING,
    VALIDATOR,
    prepare,
    request,
)

RAW = b"""case,activity,time,eventID,category,value
a,A,2018-01-01T00:00:00,1,2-way match,0
a,B,2018-01-02T00:00:00,2,2-way match,0
a,A,2018-01-03T00:00:00,3,2-way match,0
a,Change Price,2018-01-04T00:00:00,4,2-way match,0
"""


def test_valid_rule_normative_admission_refuses_binding_and_preserves_description(
    tmp_path,
):
    workspace = tmp_path / "rule-method"
    workspace.mkdir()
    receipt = {
        "transport": "genuine TCP; independent finite synthetic input",
        "requests": [],
    }
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    code = """
import json, os, uvicorn, wise
from importlib.metadata import version
import wise_platform_api.bpic19_operators as operators
import wise_platform_analytics.bpic19_operators as analytics
print(json.dumps({'pid': os.getpid(), 'api': operators.__file__, 'analytics': analytics.__file__, 'method': wise.__file__, 'method_distribution_version': version('wise-pm')}), flush=True)
uvicorn.run('wise_platform_api.app:create_app', factory=True, host='127.0.0.1', port=int(os.environ['RULE_TEST_PORT']), log_level='error')
"""
    env = {**os.environ, "RULE_TEST_PORT": str(port)}
    process = subprocess.Popen(
        [sys.executable, "-c", code],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    receipt.update(pid=process.pid, port=port, command=process.args)
    client = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=10)

    def post(given):
        response = client.post(ROUTE, json=given)
        receipt["requests"].append(
            {
                "route": ROUTE,
                "request": deepcopy(given),
                "status": response.status_code,
                "response": response.json(),
            }
        )
        return response

    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            assert process.poll() is None, process.stderr.read()
            try:
                ready = client.get("/api/health")
                if ready.status_code == 200:
                    receipt["readiness"] = {
                        "status": ready.status_code,
                        "body": ready.json(),
                    }
                    break
            except httpx.TransportError:
                pass
            time.sleep(0.03)
        else:
            raise AssertionError("Owned child did not become ready")
        wid, identity = prepare(client, workspace, RAW)
        descriptive = request(wid, identity, RULE)
        before = post(descriptive)
        assert before.status_code == 200, before.text
        given = {**descriptive, "intent": "normative_admission"}
        refused = post(given)
        assert refused.status_code == 409, refused.text
        body = refused.json()
        assert body["code"] == "method_binding_unavailable"
        assert body["field"] == "intent" and body["retryable"] is False
        assert body["method_context"] == {
            "intent": "normative_admission",
            "identity": identity,
            "query": descriptive["query"],
            "definition_id": before.json()["definition_id"],
        }
        VALIDATOR.validate(given)
        VALIDATOR.validate(body)
        assert not ({"score", "grade", "breach", "score_run_id"} & body.keys())
        after = post(descriptive)
        assert after.status_code == 200 and after.json() == before.json()
        VALIDATOR.validate(after.json())
        explicit = post({**descriptive, "intent": "descriptive"})
        assert explicit.status_code == 200 and explicit.json() == before.json()
        # Contract/policy/population errors must not fall through to a binding
        # refusal, even with packed Method present in this genuine child.
        bad = {**given, "intent": None}
        invalid = post(bad)
        assert (
            invalid.status_code == 400 and invalid.json()["code"] == "invalid_request"
        ), invalid.text
        assert not VALIDATOR.is_valid(bad)
        for recipe in [None, FIFO, ORDINAL, CANCELLATION, WAITING]:
            bad = {**given, "query": {**given["query"], "recipe": recipe}}
            assert not VALIDATOR.is_valid(bad)
            invalid = post(bad)
            assert (
                invalid.status_code == 400
                and invalid.json()["code"] == "invalid_request"
            ), invalid.text
            VALIDATOR.validate(invalid.json())
        for patch, status, code in [
            ({"intent": "grade"}, 400, "invalid_request"),
            ({"norm": {"grade": 1}}, 400, "invalid_request"),
            ({"schema_version": 2}, 400, "unsupported_schema"),
            (
                {
                    "identity": {
                        **identity,
                        "population_id": "population.v1:sha256:" + "f" * 64,
                    }
                },
                404,
                "population_unavailable",
            ),
            (
                {
                    "query": {
                        **given["query"],
                        "roles": {**given["query"]["roles"], "event_id": True},
                    }
                },
                400,
                "invalid_request",
            ),
            (
                {
                    "query": {
                        **given["query"],
                        "roles": {**given["query"]["roles"], "event_id": 99},
                    }
                },
                400,
                "invalid_parameter",
            ),
            (
                {"query": {**given["query"], "policy_id": "unknown.v1"}},
                400,
                "unsupported_policy",
            ),
        ]:
            invalid = post({**given, **patch})
            assert (
                invalid.status_code == status and invalid.json()["code"] == code
            ), invalid.text
            assert "method_context" not in invalid.json()
            VALIDATOR.validate(invalid.json())
        malformed = client.post(
            ROUTE, content=b'{"intent":', headers={"Content-Type": "application/json"}
        )
        receipt["requests"].append(
            {
                "route": ROUTE,
                "request_raw": '{"intent":',
                "status": malformed.status_code,
                "response": malformed.json(),
            }
        )
        assert (
            malformed.status_code == 400
            and malformed.json()["code"] == "invalid_request"
        )
        # Fresh validation without a cached descriptive answer reaches the same
        # missing-binding branch; none of these rule policies is admitted.
        changed = {
            **given,
            "query": {
                **given["query"],
                "recipe": {**RULE, "relation": "precedence", "quantifier": "some"},
            },
        }
        refused = post(changed)
        assert (
            refused.status_code == 409
            and refused.json()["code"] == "method_binding_unavailable"
        )
        assert refused.json()["method_context"]["query"] == changed["query"]
        VALIDATOR.validate(changed)
        VALIDATOR.validate(refused.json())
        assert post(descriptive).json() == before.json()
    finally:
        client.close()
        process.terminate()
        try:
            stdout, stderr = process.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate(timeout=5)
        receipt.update(observed_exit=process.returncode, stdout=stdout, stderr=stderr)
        if stdout:
            receipt["imports"] = json.loads(stdout.splitlines()[0])
        with socket.socket() as probe:
            receipt["port_closed"] = probe.connect_ex(("127.0.0.1", port)) != 0
        if destination := os.environ.get("BPIC_METHOD_HTTP_RECEIPT"):
            Path(destination).write_text(json.dumps(receipt, indent=2))
        assert process.poll() is not None
        assert receipt["port_closed"]
