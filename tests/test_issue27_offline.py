"""#27: a local investigation that needs no network, and exports that say where they go and what they hold.

The browser journey with networking unavailable is tools/qualify_offline.py. Here: the backup, the one export of the
incident journey, is previewed with its local destination and exact content before anything is written, and the preview
holds what the backup then writes; the host is loopback only; the built browser assets name no remote address to load;
the service and analytics import no client for remote requests.
"""

from pathlib import Path
import re

from fastapi.testclient import TestClient

from test_import_acceptance import envelope
from test_issue25_saved_finding import EXPECTED, FIXTURES, ok, question, read, save
from wise_platform_api.app import create_app

ROOT = Path(__file__).resolve().parents[1]


def back_up(client, workspace, destination, preview=False):
    return client.post("/api/workspaces/back-up", json=envelope("back_up_workspace_request", workspace_id=workspace["workspace_id"], destination=str(destination),
                       **({"preview_only": True} if preview else {})))


def test_a_backup_is_previewed_with_its_destination_and_content_before_anything_is_written(tmp_path):
    original, backup = tmp_path / "workspace", tmp_path / "backup"
    original.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        workspace = ok(client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(original))))
        base = read(client, workspace, (FIXTURES / EXPECTED["file"]).read_bytes(), EXPECTED["file"], "upload-1")
        _, _, request = question(client, workspace, base, "first")
        ok(save(client, request))
        preview = ok(back_up(client, workspace, backup, preview=True))
        assert preview["written"] is False and not backup.exists()
        assert preview["path"] == str(backup) and preview["counts"]["investigations"] == 1 and preview["counts"]["sources"] == 1
        written = ok(back_up(client, workspace, backup))
        assert written["written"] is True and backup.is_dir()
        # The preview held exactly what the backup wrote.
        assert {key: preview[key] for key in ("file_count", "byte_count", "counts", "omitted")} == {key: written[key] for key in ("file_count", "byte_count", "counts", "omitted")}
        # A destination that cannot take a backup is refused at the preview already.
        refused = back_up(client, workspace, backup, preview=True)
        assert refused.status_code != 200 and refused.json()["field"] == "destination"


def test_the_host_is_loopback_only():
    main = (ROOT / "apps/api/src/wise_platform_api/__main__.py").read_text(encoding="utf-8")
    assert 'parser.add_argument("--host", choices=("127.0.0.1", "localhost"), default="127.0.0.1")' in main


def test_the_built_assets_load_nothing_from_elsewhere():
    static = ROOT / "apps/api/src/wise_platform_api/static"
    texts = [path.read_text(encoding="utf-8", errors="replace") for path in static.rglob("*") if path.suffix in (".html", ".js", ".css")]
    assert texts, "the browser build is there"
    # A reference that a browser would load: in markup, a stylesheet url() or an import; XML namespaces and plain words are no requests.
    loaded = re.compile(r"""(?:src|href)=["']https?://|url\(\s*["']?https?://|@import\s+["']?https?://|import\(["']https?://""")
    assert [match.group(0) for text in texts for match in loaded.finditer(text)] == []


def test_the_service_and_analytics_have_no_client_for_remote_requests():
    sources = [*(ROOT / "apps/api/src/wise_platform_api").rglob("*.py"), *(ROOT / "packages/analytics/src").rglob("*.py")]
    clients = re.compile(r"^\s*(?:import|from)\s+(?:requests|httpx|urllib\.request|urllib3|aiohttp|http\.client)\b", re.MULTILINE)
    assert [str(path.relative_to(ROOT)) for path in sources if clients.search(path.read_text(encoding="utf-8"))] == []
