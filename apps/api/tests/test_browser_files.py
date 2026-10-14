"""How the built browser files are delivered."""

from fastapi.testclient import TestClient

from wise_platform_api.app import create_app


def test_the_page_is_asked_for_anew_and_the_files_it_names_may_be_kept(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>page</title>", encoding="utf-8")
    (tmp_path / "assets" / "index-0a1b2c.js").write_text("export {};", encoding="utf-8")
    client = TestClient(create_app(static_dir=tmp_path))

    page = client.get("/")
    assert page.status_code == 200
    assert page.headers["cache-control"] == "no-cache"

    script = client.get("/assets/index-0a1b2c.js")
    assert script.status_code == 200
    assert "no-cache" not in script.headers.get("cache-control", "")
