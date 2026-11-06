from dataclasses import replace
from pathlib import Path
import re

from fastapi.testclient import TestClient
import pytest

from server.app import create_app
from server.settings import Settings


def test_current_session_reuses_browser_cookie_without_issuing_a_new_token(tmp_path):
    settings = replace(Settings(), data_dir=tmp_path / "data", cookie_secure=False, worker_enabled=False)
    with TestClient(create_app(settings)) as client:
        assert client.get("/v1/sessions/current").status_code == 401
        client.post("/v1/sessions")
        original = client.cookies["md2docx_session"]
        result = client.get("/v1/sessions/current")
        assert result.status_code == 200
        assert result.json()["data"] == {"active": True}
        assert "accessToken" not in result.text
        assert client.cookies["md2docx_session"] == original
        assert client.get("/v1/sessions/current", headers={"Origin": "https://untrusted.example"}).status_code == 403


@pytest.mark.skipif(not Path("server/web/dist/index.html").is_file(), reason="Build the web application first")
def test_web_assets_and_docs_are_local_and_server_files_are_private(tmp_path):
    settings = replace(Settings(), data_dir=tmp_path / "data", cookie_secure=False, worker_enabled=False, docs=True)
    with TestClient(create_app(settings)) as client:
        result = client.get("/")
        assert result.status_code == 200
        assert "frame-ancestors 'none'" in result.headers["content-security-policy"]
        scripts = re.findall(r'<script[^>]*src="([^"]+)"', result.text)
        assert scripts and all(path.startswith("/assets/") for path in scripts)
        for path in scripts:
            asset = client.get(path)
            assert asset.status_code == 200
            assert "javascript" in asset.headers["content-type"]
        docs = client.get("/docs")
        assert docs.status_code == 200
        assert "cdn.jsdelivr.net" not in docs.text
        assert "/docs-assets/swagger-ui-bundle.js" in docs.text
        assert client.get("/docs-assets/swagger-ui.css").status_code == 200
        for path in ["/assets/%2e%2e/package.json", "/server/data/jobs.sqlite", "/src/App.jsx", "/v1/no-such-api"]:
            assert client.get(path).status_code == 404

