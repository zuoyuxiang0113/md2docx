from dataclasses import replace
import asyncio
import hashlib
import io
import json
from pathlib import Path
import socket
import tempfile
import time
import zipfile

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from server.app import create_app
from server.runner import RunFailure, Sandbox
from server.settings import Settings

PROFILE = {"schemaVersion": 2, "numbering": {"enabled": False, "stripExisting": False}}


def body(content="# 2026 标题\n\n中文正文", **options):
    result = {"documents": [{"id": "doc-1", "path": "报告.md", "content": content}], "config": {"profile": PROFILE}}
    result.update(options)
    return result


def settings(tmp_path, **options):
    return replace(Settings(), **{"data_dir": tmp_path / "data", "cookie_secure": False, **options})


def wait(client, job_id):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        result = client.get(f"/v1/jobs/{job_id}")
        assert result.status_code == 200, result.text
        job = result.json()["data"]
        if job["status"] not in {"queued", "running", "cancelling"}:
            assert sum(v for k, v in job["summary"].items() if k != "total") == job["summary"]["total"]
            return job
        time.sleep(.1)
    raise AssertionError("task did not finish")


def session(client):
    result = client.post("/v1/sessions")
    assert result.status_code == 201
    return {"Authorization": "Bearer " + result.json()["data"]["accessToken"]}


def test_real_conversion_and_private_download(tmp_path):
    s = settings(tmp_path)
    with TestClient(create_app(s)) as client:
        assert client.get("/readyz").status_code == 200
        result = client.post("/v1/jobs", json=body("# 2026 年度报告\n\n中文正文 **bold**。\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n$x^2$"))
        assert result.status_code == 202, result.text
        assert "HttpOnly" in result.headers["set-cookie"]
        job = wait(client, result.json()["data"]["jobId"])
        assert job["status"] == "succeeded", job
        artifact = job["items"][0]["artifact"]
        url = f"/v1/jobs/{job['jobId']}/artifacts/{artifact['id']}"
        result = client.get(url)
        assert result.status_code == 200
        assert hashlib.sha256(result.content).hexdigest() == artifact["sha256"]
        with zipfile.ZipFile(io.BytesIO(result.content)) as archive:
            from xml.etree import ElementTree as ET
            xml = archive.read("word/document.xml")
            assert "2026 年度报告" in "".join(ET.fromstring(xml).itertext())
            assert b"<w:tbl" in xml and b"<m:oMath" in xml
        owner_header = {"Authorization": "Bearer " + client.cookies["md2docx_session"]}
        other = session(client)
        assert client.get(url, headers=other).status_code == 404
        assert client.get(f"/v1/jobs/{job['jobId']}", headers=other).status_code == 404
        assert client.delete(f"/v1/jobs/{job['jobId']}", headers=other).status_code == 404
        assert client.delete(f"/v1/jobs/{job['jobId']}", headers=owner_header).status_code == 204
        assert client.get(url, headers=owner_header).status_code == 410
        assert not (s.data_dir / "jobs" / job["jobId"]).exists()


def test_batch_multipart_images_and_same_names(tmp_path):
    image = io.BytesIO()
    Image.new("RGB", (8, 8), "blue").save(image, format="PNG")
    manifest = {"documents": [{"id": "a", "path": "one/report.md", "part": "md1"}, {"id": "b", "path": "two/report.md", "part": "md2"}], "resources": [{"path": "one/img.png", "part": "image"}], "config": {"profile": PROFILE}}
    with TestClient(create_app(settings(tmp_path))) as client:
        result = client.post("/v1/jobs", data={"request": json.dumps(manifest)}, files={"md1": ("a.md", "# 一\n\n![图](img.png)".encode(), "text/markdown"), "md2": ("b.md", "# 二\n\n第二份".encode(), "text/markdown"), "image": ("img.png", image.getvalue(), "image/png")})
        assert result.status_code == 202, result.text
        job = wait(client, result.json()["data"]["jobId"])
        assert job["status"] == "succeeded", job
        assert job["summary"]["succeeded"] == 2
        assert job["items"][0]["objects"]["images"] == 1
        assert job["items"][0]["artifact"]["id"] != job["items"][1]["artifact"]["id"]


@pytest.mark.parametrize("path", ["../outside.md", "/etc/passwd.md", "C:/file.md", "one\\file.md", "one/../file.md", "one//file.md", "a\x00.md"])
def test_reject_escaping_paths(tmp_path, path):
    with TestClient(create_app(settings(tmp_path, worker_enabled=False))) as client:
        value = body()
        value["documents"][0]["path"] = path
        assert client.post("/v1/jobs", json=value).status_code == 422
        assert not list((tmp_path / "data" / "jobs").iterdir())


@pytest.mark.parametrize("profile", [{"schemaVersion": 2, "styles": {"normal": {"color": "ZZZZZZ"}}}, {"schemaVersion": 2, "styles": {"normal": {"sizePt": 0}}}, {"schemaVersion": 2, "page": {"leftMarginCm": 20}}, {"schemaVersion": 2, "options": {"shell": "anything"}}, {"schemaVersion": 2.0}])
def test_stricter_config_validation(tmp_path, profile):
    with TestClient(create_app(settings(tmp_path))) as client:
        result = client.post("/v1/config/validate", json={"config": {"profile": profile}})
        assert result.status_code == 422, result.text
        assert result.json()["error"]["fields"]


def test_bounded_upload_without_content_length(tmp_path):
    with TestClient(create_app(settings(tmp_path, max_request_bytes=100))) as client:
        result = client.post("/v1/jobs", content=iter([b"a" * 60, b"b" * 60]), headers={"Content-Type": "application/json"})
        assert result.status_code == 413
        assert client.post("/v1/jobs", json=body()).status_code == 413


def test_idempotency_queue_cancel_and_delete(tmp_path):
    with TestClient(create_app(settings(tmp_path, worker_enabled=False))) as client:
        headers = {**session(client), "Idempotency-Key": "request_1234567890"}
        first = client.post("/v1/jobs", json=body(), headers=headers)
        second = client.post("/v1/jobs", json=body(), headers=headers)
        assert first.status_code == second.status_code == 202
        job_id = first.json()["data"]["jobId"]
        assert second.json()["data"]["jobId"] == job_id
        assert client.post("/v1/jobs", json=body("changed"), headers=headers).status_code == 409
        assert client.delete(f"/v1/jobs/{job_id}", headers=headers).status_code == 409
        result = client.post(f"/v1/jobs/{job_id}/cancel", headers=headers)
        assert result.json()["data"]["status"] == "cancelled"
        assert result.json()["data"]["summary"]["unprocessed"] == 1
        assert client.delete(f"/v1/jobs/{job_id}", headers=headers).status_code == 204
        assert client.post("/v1/jobs", json=body(), headers=headers).status_code == 410


def test_queue_is_persistent_across_restart(tmp_path):
    s = settings(tmp_path, worker_enabled=False)
    with TestClient(create_app(s)) as client:
        headers = session(client)
        result = client.post("/v1/jobs", json=body(), headers=headers)
        job_id = result.json()["data"]["jobId"]
    with TestClient(create_app(replace(s, worker_enabled=True))) as client:
        client.headers.update(headers)
        assert wait(client, job_id)["status"] == "succeeded"


def test_queue_capacity_and_ownership_limit(tmp_path):
    s = settings(tmp_path, worker_enabled=False, max_queue=2, max_active_per_session=1)
    with TestClient(create_app(s)) as client:
        first = session(client)
        assert client.post("/v1/jobs", json=body(), headers=first).status_code == 202
        assert client.post("/v1/jobs", json=body(), headers=first).status_code == 429
        second = session(client)
        assert client.post("/v1/jobs", json=body(), headers=second).status_code == 202
        third = session(client)
        assert client.post("/v1/jobs", json=body(), headers=third).status_code == 503


def test_origin_and_rate_limits(tmp_path):
    with TestClient(create_app(settings(tmp_path))) as client:
        assert client.post("/v1/sessions", headers={"Origin": "https://evil.example"}).status_code == 403
        for _ in range(15):
            assert client.post("/v1/sessions").status_code == 201
        result = client.post("/v1/sessions")
        assert result.status_code == 429 and "Retry-After" in result.headers


def test_missing_image_stop_partial_and_no_paths(tmp_path):
    value = body()
    value["documents"] += [{"id": "missing", "path": "missing.md", "content": "![图](not-there.png)"}]
    value["execution"] = {"missingImages": "stop", "batchErrors": "continue"}
    with TestClient(create_app(settings(tmp_path))) as client:
        response = client.post("/v1/jobs", json=value)
        job = wait(client, response.json()["data"]["jobId"])
        assert job["status"] == "partially_succeeded"
        assert job["items"][1]["error"]["code"] == "IMAGE_NOT_FOUND"
        text = json.dumps(job)
        assert str(tmp_path) not in text and "/inputs/" not in text and "_input" not in text
        assert not (tmp_path / "data" / "jobs" / job["jobId"] / "inputs").exists()


def test_invalid_image_and_duplicate_parts(tmp_path):
    manifest = {"documents": [{"id": "a", "path": "a.md", "part": "md"}], "resources": [{"path": "x.png", "part": "img"}], "config": {"profile": PROFILE}}
    with TestClient(create_app(settings(tmp_path))) as client:
        result = client.post("/v1/jobs", data={"request": json.dumps(manifest)}, files={"md": ("a.md", b"hello"), "img": ("x.png", b"not an image")})
        assert result.status_code == 422
        result = client.post("/v1/jobs", data={"request": json.dumps(manifest)}, files=[("md", ("a.md", b"one")), ("md", ("b.md", b"two")), ("img", ("x.png", b"bad"))])
        assert result.status_code == 422


def test_unavailable_sandbox_fails_closed(tmp_path):
    class Unavailable:
        async def probe(self):
            return False
    with TestClient(create_app(settings(tmp_path), sandbox=Unavailable())) as client:
        assert client.get("/readyz").status_code == 503
        assert client.post("/v1/jobs", json=body()).status_code == 503


def test_openapi_declares_json_and_multipart(tmp_path):
    with TestClient(create_app(settings(tmp_path))) as client:
        schema = client.get("/openapi.json").json()
        assert schema["openapi"].startswith("3.1")
        formats = schema["paths"]["/v1/jobs"]["post"]["requestBody"]["content"]
        assert "application/json" in formats and "multipart/form-data" in formats


def test_sandbox_hides_host_files_and_network(tmp_path):
    s = settings(tmp_path)
    secret = tmp_path / "host-secret.txt"
    secret.write_text("must-not-be-readable")
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    port = listener.getsockname()[1]
    probe = "import pathlib,socket; assert not pathlib.Path(" + repr(str(secret)) + ").exists(); assert not pathlib.Path('/home/zuoyx').exists(); s=socket.socket(); s.settimeout(.2); assert s.connect_ex(('127.0.0.1'," + str(port) + ")) != 0"
    async def check():
        runner = Sandbox(s)
        process = await asyncio.create_subprocess_exec(*(runner.base() + ["--", "/runtime/bin/python", "-c", probe]), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await asyncio.wait_for(process.communicate(), 10)
        assert process.returncode == 0, err
    try:
        asyncio.run(check())
    finally:
        listener.close()


@pytest.mark.parametrize("mode,expected", [("timeout", "FILE_TIMEOUT"), ("cancel", "CANCELLED"), ("output", "CONVERTER_OUTPUT_LIMIT")])
def test_subprocess_limits_and_cancellation(tmp_path, mode, expected):
    project = tmp_path / "fake-project"
    (project / "cli").mkdir(parents=True)
    (project / "core").mkdir()
    workspace = tmp_path / "work"
    (workspace / "inputs").mkdir(parents=True)
    (workspace / "outputs").mkdir()
    (workspace / "config.json").write_text("{}")
    # Child tries to survive its parent and write later. Namespace teardown must kill it.
    code = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',\"import time,pathlib; time.sleep(.8); pathlib.Path('/outputs/escaped').write_text('bad')\"]); time.sleep(20)"
    if mode == "output":
        code = "import sys; sys.stdout.write('x'*100000); sys.stdout.flush()"
    (project / "cli/md2docx.py").write_text(code)
    s = settings(tmp_path, project=project, max_stream_bytes=1024)
    async def check():
        cancel = asyncio.Event()
        if mode == "cancel":
            async def trigger():
                await asyncio.sleep(.1)
                cancel.set()
            trigger_task = asyncio.create_task(trigger())
        with pytest.raises(RunFailure) as failure:
            await Sandbox(s).run(workspace, "dummy.md", "out.docx", {"missingImages": "warning"}, "test-job", cancel, lambda stage: None, .25 if mode == "timeout" else 5)
        assert failure.value.code == expected
        if mode == "cancel":
            await trigger_task
        await asyncio.sleep(1)
        assert not (workspace / "outputs/escaped").exists()
    asyncio.run(check())


def test_stop_on_error_and_expiration(tmp_path):
    value = body()
    value["documents"] = [{"id":"bad","path":"bad.md","content":"![图](missing.png)"}, {"id":"later","path":"later.md","content":"# Later"}]
    value["execution"] = {"missingImages":"stop","batchErrors":"stop"}
    s = settings(tmp_path, retention_seconds=.2)
    with TestClient(create_app(s)) as client:
        created = client.post("/v1/jobs", json=value).json()["data"]
        job = wait(client, created["jobId"])
        assert job["status"] == "failed"
        assert job["summary"]["failed"] == 1 and job["summary"]["unprocessed"] == 1
        time.sleep(.3)
        assert client.get(f"/v1/jobs/{job['jobId']}").status_code == 410
        client.app.state.jobs.cleanup()
        assert not (s.data_dir / "jobs" / job["jobId"]).exists()


def test_disk_budget_refuses_new_work(tmp_path):
    with TestClient(create_app(settings(tmp_path, max_storage_bytes=1))) as client:
        result = client.post("/v1/jobs", json=body())
        assert result.status_code == 503
        assert result.json()["error"]["code"] == "STORAGE_BUSY"



def test_config_schema_and_cors_error(tmp_path):
    with TestClient(create_app(settings(tmp_path, max_request_bytes=100))) as client:
        schema = client.get("/v1/config/schema").json()["data"]
        assert schema["properties"]["schemaVersion"]["const"] == 2
        result = client.post("/v1/jobs", content=b"x"*120, headers={"Origin":"http://localhost:8000","Content-Type":"application/json"})
        assert result.status_code == 413
        assert result.headers["access-control-allow-origin"] == "http://localhost:8000"


def test_temporary_bearer_session_no_registration(tmp_path):
    with TestClient(create_app(settings(tmp_path, worker_enabled=False, cookie_secure=True))) as client:
        headers = session(client)
        client.cookies.clear()
        created = client.post("/v1/jobs", json=body(), headers=headers)
        assert created.status_code == 202
        assert "Secure" in created.headers["set-cookie"]
        job_id = created.json()["data"]["jobId"]
        assert client.get(f"/v1/jobs/{job_id}", headers=headers).status_code == 200
        assert client.get(f"/v1/jobs/{job_id}").status_code == 401
