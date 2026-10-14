"""Automatic local workspace initialization, overrides and refusal recovery."""

from hashlib import sha256
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
from threading import Barrier

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker
import pytest

from wise_platform_api import app as app_module
from wise_platform_api.app import create_app
from wise_platform_api.imports import Imports
from wise_platform_api.workspace import MANIFEST, Workspace

ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = Draft202012Validator(
    json.loads((ROOT / "contracts/import.schema.json").read_text()),
    format_checker=FormatChecker(),
)
RAW = b"Case,Activity,At\r\nSYN01,Recorded,2026-10-09T08:00:00Z\r\n"


def request(request_id="default-first", revision=1):
    result = {
        "schema_version": 1, "message_type": "open_default_workspace_request",
        "request_id": request_id, "query_revision": revision,
    }
    VALIDATOR.validate(result)
    return result


def answer(client, given):
    response = client.post("/api/workspaces/open-default", json=given)
    assert response.status_code == 200, response.text
    result = response.json()
    VALIDATOR.validate(result)
    assert result["message_type"] == "workspace_answer" and result["writable"] is True
    for name in ("request_id", "query_revision"):
        assert result[name] == given[name]
    return result


def refusal(client, given, code):
    response = client.post("/api/workspaces/open-default", json=given)
    assert 400 <= response.status_code < 500, response.text
    result = response.json()
    VALIDATOR.validate(result)
    assert result["message_type"] == "import_refusal"
    assert result["operation"] == "open_default_workspace"
    assert result["code"] == code and result["message"].strip()
    assert result["request_id"] == given["request_id"]
    assert result["query_revision"] == given["query_revision"]
    return result


def files(folder):
    return {str(path.relative_to(folder)): path.read_bytes() for path in folder.rglob("*") if path.is_file()}


@pytest.fixture
def synthetic_user(tmp_path, monkeypatch):
    home = tmp_path / "Synthetic user"
    monkeypatch.setattr(Path, "home", staticmethod(lambda: home))
    monkeypatch.setenv("LOCALAPPDATA", str(home / "AppData/Local"))
    monkeypatch.setenv("XDG_DATA_HOME", str(home / ".local/share"))
    return home


def test_bootstrap_creates_an_external_user_workspace_without_manual_path(synthetic_user):
    application = create_app()
    assert not synthetic_user.exists(), "Application construction must not create runtime files."
    with TestClient(application) as client:
        assert client.get("/api/health").status_code == 200
        assert not synthetic_user.exists(), "Health is not workspace initialization."
        opened = answer(client, request())
    folder = Path(opened["path"])
    assert folder.is_relative_to(synthetic_user) and folder.name == "workspace"
    assert not folder.is_relative_to(ROOT)
    assert opened["sources"] == [] and opened["preparations"] == []
    assert json.loads((folder / MANIFEST).read_text())["workspace_id"] == opened["workspace_id"]


def test_default_workspace_is_registered_for_upload_and_repeated_bootstrap_preserves_it(synthetic_user):
    with TestClient(create_app()) as client:
        first = answer(client, request())
        metadata = {
            "schema_version": 1, "message_type": "upload_source_metadata",
            "request_id": "default-source", "query_revision": 2,
            "workspace_id": first["workspace_id"], "filename": "synthetic-first-use.csv",
        }
        VALIDATOR.validate(metadata)
        response = client.put("/api/sources", params=metadata, content=RAW,
                              headers={"Content-Type": "application/octet-stream"})
        assert response.status_code == 200, response.text
        stored = response.json();VALIDATOR.validate(stored)
        assert stored["source"]["source_id"] == "source.v1:sha256:" + sha256(RAW).hexdigest()
        folder = Path(first["path"])
        protected = files(folder)
        again = answer(client, request("default-again", 3))
        assert again["workspace_id"] == first["workspace_id"] and again["path"] == first["path"]
        assert again["sources"] == [stored["source"]]
        assert files(folder) == protected


def test_explicit_missing_override_is_created_and_never_replaced_by_default(tmp_path, synthetic_user):
    chosen = tmp_path / "Chosen workspace"
    with TestClient(create_app(workspace_path=chosen)) as client:
        assert not chosen.exists()
        opened = answer(client, request())
    assert Path(opened["path"]) == chosen.resolve()
    assert not synthetic_user.exists()


@pytest.mark.parametrize("kind,code", [
    ("foreign", "workspace_incompatible"), ("corrupt", "workspace_incompatible"),
    ("file", "workspace_unavailable"), ("relative", "workspace_unavailable"),
])
def test_invalid_override_is_refused_without_deleting_or_falling_back(tmp_path, synthetic_user, monkeypatch, kind, code):
    launch = tmp_path / "Unrelated launch folder";launch.mkdir()
    monkeypatch.chdir(launch)
    chosen = tmp_path / "Chosen workspace"
    if kind == "relative":
        chosen = Path("relative-workspace")
    elif kind == "file":
        chosen.write_bytes(RAW)
    else:
        chosen.mkdir()
        (chosen / (MANIFEST if kind == "corrupt" else "private-placeholder.txt")).write_bytes(b"Unrelated synthetic content")
    protected = files(tmp_path)
    with TestClient(create_app(workspace_path=chosen)) as client:
        refusal(client, request(), code)
    assert files(tmp_path) == protected and not synthetic_user.exists()
    assert not (launch / "relative-workspace").exists()


def test_program_override_is_refused_before_any_folder_is_created(tmp_path, synthetic_user, monkeypatch):
    program = tmp_path / "Synthetic program folder";program.mkdir()
    (program / "program.txt").write_bytes(b"Synthetic application bytes")
    monkeypatch.setattr(app_module, "program_folders", lambda: (program,))
    protected = files(program)
    with TestClient(create_app(workspace_path=program / "workspace")) as client:
        refusal(client, request(), "workspace_incompatible")
    assert files(program) == protected and not (program / "workspace").exists()
    assert not synthetic_user.exists()


def test_default_request_has_no_path_override_and_refuses_before_initializing(synthetic_user):
    with TestClient(create_app()) as client:
        refusal(client, request() | {"path": "relative-workspace"}, "invalid_request")
    assert not synthetic_user.exists()


def test_parallel_bootstrap_posts_share_one_durable_workspace_identity(tmp_path):
    chosen = tmp_path / "Concurrent workspace"
    barrier = Barrier(8)
    with TestClient(create_app(workspace_path=chosen)) as client:
        def initialize(index):
            barrier.wait(timeout=10)
            return answer(client, request(f"parallel-{index}", index + 1))

        with ThreadPoolExecutor(max_workers=8) as executor:
            replies = list(executor.map(initialize, range(8)))
        identity = replies[0]["workspace_id"]
        assert all(reply["workspace_id"] == identity for reply in replies)
        assert json.loads((chosen / MANIFEST).read_text())["workspace_id"] == identity
        assert answer(client, request("parallel-again", 10))["workspace_id"] == identity


def test_concurrent_registry_instances_do_not_replace_the_first_manifest(tmp_path):
    chosen = tmp_path / "Shared initialized workspace"
    services = [Imports(workspace_path=chosen), Imports(workspace_path=chosen)]
    barrier = Barrier(2)

    def initialize(index):
        barrier.wait(timeout=10)
        reply = services[index].open_default_workspace(json.dumps(request(f"registry-{index}", index + 1)).encode())
        assert reply.status == 200
        VALIDATOR.validate(reply.body)
        return reply.body

    with ThreadPoolExecutor(max_workers=2) as executor:
        replies = list(executor.map(initialize, range(2)))
    identity = replies[0]["workspace_id"]
    assert replies[1]["workspace_id"] == identity
    assert json.loads((chosen / MANIFEST).read_text())["workspace_id"] == identity
    assert all(isinstance(service.opened_workspace(identity), Workspace) for service in services)


@pytest.mark.parametrize("platform,hint,expected", [
    ("darwin", None, "Library/Application Support/WISE/workspace"),
    ("win32", "absolute", "Hint/WISE/workspace"),
    ("win32", None, "AppData/Local/WISE/workspace"),
    ("linux", "absolute", "Hint/WISE/workspace"),
    ("linux", None, ".local/share/WISE/workspace"),
    ("linux", "relative", ".local/share/WISE/workspace"),
])
def test_platform_default_is_absolute_portable_user_data_not_cwd(tmp_path, monkeypatch, platform, hint, expected):
    from wise_platform_api.default_workspace import default_workspace_path

    home = tmp_path / "Synthetic home"
    env = {}
    key = "LOCALAPPDATA" if platform == "win32" else "XDG_DATA_HOME"
    if hint is not None:
        env[key] = str(home / "Hint") if hint == "absolute" else "relative-data"
    monkeypatch.chdir(tmp_path)
    chosen = default_workspace_path(platform=platform, environment=env, home=home)
    assert chosen == home / expected and chosen.is_absolute()
    assert not home.exists()
