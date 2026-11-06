"""Anonymous HTTP transport for the existing MD2DOCX CLI."""
import asyncio
from contextlib import asynccontextmanager
import fcntl
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import secrets
import shutil
import time
from urllib.parse import quote
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import ValidationError
from starlette.background import BackgroundTask
from starlette.exceptions import HTTPException
from starlette.middleware.cors import CORSMiddleware
from starlette.datastructures import UploadFile

from .errors import ApiError, invalid
from .jobs import Jobs, public, utc
from .models import ConfigRequest, Submission, JobEnvelope, SessionEnvelope, ErrorEnvelope
from .runner import Sandbox, RunFailure
from .settings import Settings
from .store import Store
from .validation import canonical, digest, effective_config, path_name

log = logging.getLogger("md2docx.server")


def response(data, request, status=200, headers=None):
    payload = {"success": True, "data": data, "requestId": request.scope["request_id"]}
    if isinstance(data, dict) and "jobId" in data and "summary" in data:
        JobEnvelope.model_validate(payload)
    return JSONResponse(payload, status_code=status, headers=headers)


def error_response(error, request_id):
    headers = {"Retry-After": str(error.retry_after)} if error.retry_after else {}
    return JSONResponse({"success": False, "error": {"code": error.code, "message": error.message, "fields": error.fields, "retryable": bool(error.retry_after)}, "requestId": request_id}, status_code=error.status, headers=headers)


class Guard:
    """Enforce byte and admission limits before multipart parsing or validation."""
    def __init__(self, app, settings, store):
        self.app, self.settings, self.store = app, settings, store
        self.uploading = 0
        self.downloading = 0

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request_id = "req_" + secrets.token_hex(12)
        scope["request_id"] = request_id
        admitted = False
        download = False

        async def safe_send(message):
            if message["type"] == "http.response.start":
                existing_headers = {k.lower() for k, _ in message.get("headers", [])}
                origin_value = dict(scope["headers"]).get(b"origin")
                if origin_value and origin_value.decode("latin1").rstrip("/") in self.settings.origins and b"access-control-allow-origin" not in existing_headers:
                    message.setdefault("headers", []).extend([(b"access-control-allow-origin", origin_value), (b"access-control-allow-credentials", b"true"), (b"vary", b"Origin")])
                message.setdefault("headers", []).extend([(b"x-request-id", request_id.encode()), (b"cache-control", b"private, no-store"), (b"x-content-type-options", b"nosniff"), (b"referrer-policy", b"no-referrer")])
            await send(message)
        try:
            headers = {k.lower(): v for k, v in scope["headers"]}
            path, method = scope["path"], scope["method"]
            if len(scope.get("raw_path", b"")) > 2048:
                raise ApiError(414, "REQUEST_INVALID", "请求路径过长。")
            origin = headers.get(b"origin", b"").decode("latin1").rstrip("/")
            if origin and origin not in self.settings.origins:
                raise ApiError(403, "ORIGIN_FORBIDDEN", "该网页来源不允许调用服务。")
            remote = (scope.get("client") or ("unknown", 0))[0]
            group, limit = ("create", 10) if path == "/v1/jobs" and method == "POST" else ("sessions", 15) if path == "/v1/sessions" else ("download", 30) if "/artifacts/" in path else ("read", 180)
            self.store.rate(group, remote, limit)
            if "/artifacts/" in path:
                if self.downloading >= 4:
                    raise ApiError(429, "DOWNLOAD_BUSY", "下载并发已达上限。", retry_after=5)
                self.downloading += 1
                download = True
            if method in {"POST", "PUT", "PATCH"}:
                if self.uploading >= 2:
                    raise ApiError(429, "UPLOAD_BUSY", "上传并发已达上限。", retry_after=5)
                self.uploading += 1
                admitted = True
                limit_bytes = self.settings.max_request_bytes if path == "/v1/jobs" else 65536
                length = headers.get(b"content-length")
                if length is not None:
                    try:
                        declared = int(length)
                    except ValueError:
                        raise ApiError(400, "REQUEST_INVALID", "Content-Length 无效。")
                    if declared < 0:
                        raise ApiError(400, "REQUEST_INVALID", "Content-Length 无效。")
                    if declared > limit_bytes:
                        raise ApiError(413, "PAYLOAD_TOO_LARGE", "请求超过上传大小限制。")
                body = bytearray()

                async def gather_body():
                    while True:
                        message = await receive()
                        if message["type"] == "http.disconnect":
                            raise ApiError(400, "UPLOAD_INTERRUPTED", "上传中断。")
                        body.extend(message.get("body", b""))
                        if len(body) > limit_bytes:
                            raise ApiError(413, "PAYLOAD_TOO_LARGE", "请求超过上传大小限制。")
                        if not message.get("more_body", False):
                            break
                try:
                    await asyncio.wait_for(gather_body(), self.settings.upload_timeout)
                except asyncio.TimeoutError:
                    raise ApiError(408, "UPLOAD_TIMEOUT", "上传超时。")
                if length is not None and len(body) != declared:
                    raise ApiError(400, "REQUEST_INVALID", "请求长度不一致。")
                sent = False
                original_receive = receive

                async def buffered_receive():
                    nonlocal sent
                    if not sent:
                        sent = True
                        return {"type": "http.request", "body": bytes(body), "more_body": False}
                    return await original_receive()
                receive = buffered_receive
            await self.app(scope, receive, safe_send)
        except ApiError as error:
            await error_response(error, request_id)(scope, receive, safe_send)
        finally:
            if admitted:
                self.uploading -= 1
            if download:
                self.downloading -= 1


def create_app(settings=None, sandbox=None):
    settings = settings or Settings.from_env()
    store = Store(settings)
    sandbox = sandbox or Sandbox(settings)
    jobs = Jobs(settings, store, sandbox)
    image_guard_lock = asyncio.Lock()

    @asynccontextmanager
    async def lifespan(app):
        lock = (settings.data_dir / "server.lock").open("a")
        try:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError("Only one API worker may own this data directory")
            await jobs.start()
            yield
        finally:
            await jobs.close()
            lock.close()

    app = FastAPI(title="MD2DOCX Cloud API", version="1.0.0", lifespan=lifespan, docs_url="/docs" if settings.docs else None, redoc_url=None, responses={code: {"model": ErrorEnvelope} for code in (400,401,403,404,408,409,410,413,415,422,429,500,503)})
    build_hash = hashlib.sha256()
    for source in sorted([*settings.project.joinpath("core").glob("*.py"), *settings.project.joinpath("cli").glob("*.py"), *Path(__file__).parent.glob("*.py"), settings.project / "core/defaults.json"]):
        build_hash.update(source.name.encode())
        build_hash.update(source.read_bytes())
    build_id = "sha256:" + build_hash.hexdigest()
    app.state.settings, app.state.store, app.state.jobs = settings, store, jobs
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.origins), allow_credentials=True, allow_methods=["GET", "POST", "DELETE"], allow_headers=["Authorization", "Content-Type", "Idempotency-Key"], expose_headers=["Retry-After", "Location", "X-Request-ID", "Content-Disposition"])
    app.add_middleware(Guard, settings=settings, store=store)

    @app.exception_handler(ApiError)
    async def api_error(request, error):
        return error_response(error, request.scope.get("request_id"))

    @app.exception_handler(RequestValidationError)
    async def request_error(request, error):
        fields = [{"path": ".".join(map(str, e["loc"])), "message": e["msg"]} for e in error.errors()[:20]]
        return error_response(ApiError(422, "REQUEST_INVALID", "请求字段不合法。", fields=fields), request.scope.get("request_id"))

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        return error_response(ApiError(error.status_code, "REQUEST_INVALID", "请求不存在或无法解析。"), request.scope.get("request_id"))

    @app.exception_handler(Exception)
    async def internal_error(request, error):
        log.error("Unhandled error request=%s type=%s", request.scope.get("request_id"), type(error).__name__)
        return error_response(ApiError(500, "INTERNAL_ERROR", "服务内部错误，请稍后重试。"), request.scope.get("request_id"))

    def session_data(request, *, optional=False):
        authorization = request.headers.get("authorization")
        if authorization is not None:
            if not authorization.startswith("Bearer "):
                raise ApiError(401, "SESSION_REQUIRED", "临时会话格式无效。")
            token = authorization[7:]
        else:
            token = request.cookies.get("md2docx_session")
        if not token and optional:
            return None
        return store.authenticate(token)

    def attach_session(result, token):
        result.set_cookie("md2docx_session", token, httponly=True, secure=settings.cookie_secure, samesite="strict", max_age=settings.session_seconds, path="/v1")
        return result

    @app.get("/healthz", tags=["service"])
    async def health(request: Request):
        return response({"status": "ok"}, request)

    @app.get("/readyz", tags=["service"])
    async def readiness(request: Request):
        return response({"ready": jobs.ready}, request, 200 if jobs.ready else 503)

    @app.post("/v1/sessions", status_code=201, response_model=SessionEnvelope, tags=["session"])
    async def new_session(request: Request):
        token, expires = store.session()
        return attach_session(response({"accessToken": token, "expiresAt": utc(expires), "type": "temporary-session"}, request, 201), token)

    @app.get("/v1/capabilities", tags=["configuration"])
    async def capabilities(request: Request):
        s = settings
        return response({"apiVersion": "v1", "coreVersion": "0.2.0", "configSchemaVersions": [2], "presets": [{"id": "default"}], "inputModes": ["json", "multipart"], "resourceTypes": ["image/png", "image/jpeg"], "features": {"batch": True, "cancel": True, "remoteResources": False, "mermaid": False}, "conversionReady": jobs.ready, "limits": {"maxDocuments": s.max_documents, "maxResources": s.max_resources, "maxRequestBytes": s.max_request_bytes, "maxMarkdownBytes": s.max_markdown_bytes, "maxImageBytes": s.max_image_bytes, "maxImagePixels": s.max_image_pixels, "maxActivePerSession": s.max_active_per_session, "fileTimeoutSeconds": s.file_timeout, "jobTimeoutSeconds": s.job_timeout, "queueTimeoutSeconds": s.queue_timeout, "outputRetentionSeconds": s.retention_seconds}}, request)

    @app.get("/v1/config/schema", tags=["configuration"])
    async def config_schema(request: Request):
        schema = json.loads(Path(__file__).with_name("config-schema.json").read_text(encoding="utf-8"))
        return response(schema, request)

    @app.post("/v1/config/validate", tags=["configuration"])
    async def validate_config(body: ConfigRequest, request: Request):
        config, checksum, notes = effective_config(body.config)
        return response({"normalizedConfig": config, "configDigest": checksum, "warnings": notes}, request)

    async def decode(request):
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        uploads = {}
        try:
            if content_type == "application/json":
                body = json.loads(await request.body())
                model = Submission.model_validate(body)
                if model.resources or any(d.part is not None for d in model.documents):
                    invalid("documents", "JSON 模式只接受 content；图片请使用 multipart。")
            elif content_type == "multipart/form-data":
                async with request.form(max_files=settings.max_documents + settings.max_resources, max_fields=1, max_part_size=65536) as form:
                    pairs = list(form.multi_items())
                    if len({key for key, _ in pairs}) != len(pairs):
                        invalid("parts", "不能出现重复上传字段。")
                    manifest = form.get("request")
                    if not isinstance(manifest, str):
                        invalid("request", "multipart 必须包含 JSON request 字段。")
                    model = Submission.model_validate(json.loads(manifest))
                    if any(d.content is not None for d in model.documents):
                        invalid("documents", "multipart 文档必须使用 part。")
                    for key, value in pairs:
                        if key == "request":
                            continue
                        if not isinstance(value, UploadFile):
                            invalid("parts", "非清单字段必须为文件。")
                        uploads[key] = await value.read()
            else:
                raise ApiError(415, "MEDIA_TYPE_UNSUPPORTED", "请使用 application/json 或 multipart/form-data。")
        except (json.JSONDecodeError, UnicodeError, RecursionError):
            raise ApiError(400, "REQUEST_INVALID", "JSON 必须是有效的 UTF-8 对象。")
        except ValidationError as error:
            invalid("request", "请求字段、类型或文档结构不合法。")
        return model, uploads

    @app.post("/v1/jobs", status_code=202, response_model=JobEnvelope, tags=["jobs"])
    async def create_job(request: Request):
        if not jobs.ready:
            raise ApiError(503, "SANDBOX_UNAVAILABLE", "隔离转换环境不可用，服务未接受任务。", retry_after=30)
        owner = session_data(request, optional=True)
        key = request.headers.get("idempotency-key")
        if key is not None and not re.fullmatch(r"[a-zA-Z0-9_-]{16,128}", key):
            invalid("Idempotency-Key", "幂等键应为 16—128 位字母、数字、下划线或短横线。")
        if key is not None and owner is None:
            raise ApiError(400, "SESSION_REQUIRED", "幂等提交请先自动创建临时会话。")
        issued = None
        if owner is None:
            token, expires = store.session()
            owner = store.authenticate(token)
            issued = {"accessToken": token, "expiresAt": utc(expires), "type": "temporary-session"}
        model, uploads = await decode(request)
        if len(model.documents) > settings.max_documents or len(model.resources) > settings.max_resources:
            raise ApiError(413, "PAYLOAD_TOO_LARGE", "文档或图片数量超过上限。")
        if len({d.id for d in model.documents}) != len(model.documents):
            invalid("documents.id", "documentId 必须唯一。")
        declared = [d.part for d in model.documents if d.part is not None] + [r.part for r in model.resources]
        if len(declared) != len(set(declared)) or set(declared) != set(uploads):
            invalid("parts", "上传内容必须与清单一一对应。")
        config, config_digest, notes = effective_config(model.config)
        config_path = canonical(config)
        if len(config_path.encode()) > 65536:
            invalid("config", "样式配置过大。")
        sources, resources, seen, fingerprints = [], [], set(), []
        for index, document in enumerate(model.documents):
            name = path_name(document.path)
            if Path(name).suffix.lower() not in {".md", ".markdown"}:
                invalid("documents.path", "只支持 .md 和 .markdown。")
            if name.casefold() in seen:
                invalid("path", "任务中存在重复文件路径。")
            seen.add(name.casefold())
            try:
                content = document.content.encode("utf-8") if document.content is not None else uploads[document.part]
                content.decode("utf-8")
            except UnicodeError:
                invalid("documents", "Markdown 必须为有效 UTF-8。")
            if len(content) > settings.max_markdown_bytes:
                raise ApiError(413, "PAYLOAD_TOO_LARGE", "单份 Markdown 超过大小限制。")
            relative = str(Path(name).parent / f"md2docx-input-{index}.md")
            sources.append((document, name, relative, content))
            fingerprints.append({"id": document.id, "path": name, "sha256": hashlib.sha256(content).hexdigest()})
        for resource in model.resources:
            name = path_name(resource.path)
            if name.casefold() in seen:
                invalid("path", "任务中存在重复文件路径。")
            seen.add(name.casefold())
            raw = uploads[resource.part]
            if not raw or len(raw) > settings.max_image_bytes:
                raise ApiError(413, "PAYLOAD_TOO_LARGE", "图片为空或超过大小限制。")
            if Path(name).suffix.lower() not in {".png", ".jpg", ".jpeg"}:
                invalid("resources.path", "只支持 PNG/JPEG 图片。")
            resources.append((name, raw))
            fingerprints.append({"path": name, "sha256": hashlib.sha256(raw).hexdigest()})
        fingerprint = digest({"files": fingerprints, "config": model.config.model_dump(), "execution": model.execution.model_dump()})
        old = store.existing(owner, key, fingerprint)
        if old:
            return response(public(old), request, 202, {"Location": f"/v1/jobs/{old['jobId']}", "Retry-After": "1"})
        jobs.ensure_storage()
        job_id = "job_" + secrets.token_hex(16)
        staging = jobs.staging / uuid.uuid4().hex
        destination = jobs.workspace(job_id)
        staging.mkdir(mode=0o700)
        accepted = False
        try:
            (staging / "inputs").mkdir()
            (staging / "outputs").mkdir()
            for name, content in resources:
                target = staging / "inputs" / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            items = []
            for document, name, relative, content in sources:
                target = staging / "inputs" / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
                items.append({"documentId": document.id, "path": name, "status": "pending", "stage": None, "warnings": [{**n, "documentId": document.id} for n in notes], "error": None, "artifact": None, "_input": relative})
            (staging / "config.json").write_text(config_path, encoding="utf-8")
            jobs.ensure_storage()
            if resources:
                try:
                    async with image_guard_lock:
                        await sandbox.validate_images(staging, [name for name, _ in resources])
                except RunFailure as error:
                    if error.code == "PAYLOAD_TOO_LARGE":
                        raise ApiError(413, "PAYLOAD_TOO_LARGE", "图片解码后的大小超过限制。")
                    invalid("resources", "图片损坏、尺寸超限或无法在时限内安全解码。")
                jobs.ensure_storage()
            # Image validation yields control: re-check concurrent idempotent submissions.
            old = store.existing(owner, key, fingerprint)
            if old:
                return response(public(old), request, 202, {"Location": f"/v1/jobs/{old['jobId']}", "Retry-After": "1"})
            job = {"jobId": job_id, "status": "queued", "createdAt": utc(), "startedAt": None, "finishedAt": None, "expiresAt": None, "engine": {"coreVersion": "0.2.0", "buildId": build_id}, "config": {"schemaVersion": 2, "digest": config_digest}, "items": items, "error": None, "_created": time.time(), "_execution": model.execution.model_dump()}
            staging.rename(destination)
            store.insert(owner, key, fingerprint, job)
            accepted = True
        finally:
            shutil.rmtree(staging, ignore_errors=True)
            if not accepted:
                shutil.rmtree(destination, ignore_errors=True)
        result_data = public(job)
        if issued:
            result_data["session"] = issued
        result = response(result_data, request, 202, {"Location": f"/v1/jobs/{job_id}", "Retry-After": "1"})
        existing_token = request.headers.get("authorization", "").removeprefix("Bearer ") or request.cookies.get("md2docx_session")
        return attach_session(result, issued["accessToken"] if issued else existing_token)

    @app.get("/v1/jobs/{job_id}", response_model=JobEnvelope, tags=["jobs"])
    async def get_job(job_id: str, request: Request):
        return response(public(jobs.get(job_id, session_data(request))), request, headers={"Retry-After": "1"})

    @app.post("/v1/jobs/{job_id}/cancel", response_model=JobEnvelope, responses={202: {"model": JobEnvelope}}, tags=["jobs"])
    async def cancel_job(job_id: str, request: Request):
        job = jobs.get(job_id, session_data(request))
        job = jobs.cancel(job)
        return response(public(job), request, 202 if job["status"] == "cancelling" else 200)

    @app.delete("/v1/jobs/{job_id}", status_code=204, tags=["jobs"])
    async def delete_job(job_id: str, request: Request):
        job = jobs.get(job_id, session_data(request))
        jobs.delete(job)
        return Response(status_code=204)

    @app.get("/v1/jobs/{job_id}/artifacts/{artifact_id}", response_class=StreamingResponse, responses={200: {"content": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document": {"schema": {"type": "string", "format": "binary"}}}}}, tags=["artifacts"])
    async def download(job_id: str, artifact_id: str, request: Request):
        job = jobs.get(job_id, session_data(request))
        artifact = next((i["artifact"] for i in job["items"] if i.get("artifact") and i["artifact"]["id"] == artifact_id), None)
        if not artifact:
            raise ApiError(404, "RESOURCE_NOT_FOUND", "结果文件不存在。")
        path = jobs.workspace(job_id) / "outputs" / artifact["_file"]
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        except OSError:
            raise ApiError(404, "RESOURCE_NOT_FOUND", "结果文件不可用。")

        closed = False

        def close_fd():
            nonlocal closed
            if not closed:
                closed = True
                os.close(fd)

        async def stream():
            try:
                while chunk := await asyncio.to_thread(os.read, fd, 65536):
                    yield chunk
            finally:
                close_fd()
        return StreamingResponse(stream(), background=BackgroundTask(close_fd), media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", headers={"Content-Length": str(artifact["sizeBytes"]), "Content-Disposition": f"attachment; filename=\"document.docx\"; filename*=UTF-8''{quote(artifact['filename'], safe='')}"})

    def openapi():
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
        submission = Submission.model_json_schema(ref_template="#/components/schemas/{model}")
        schema.setdefault("components", {}).setdefault("schemas", {}).update(submission.pop("$defs", {}))
        schema["components"]["schemas"]["Submission"] = submission
        operation = schema["paths"]["/v1/jobs"]["post"]
        operation["requestBody"] = {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Submission"}}, "multipart/form-data": {"schema": {"type": "object", "required": ["request"], "properties": {"request": {"type": "string", "description": "JSON Submission manifest with part references"}}, "additionalProperties": {"type": "string", "format": "binary"}}}}}
        schema["components"]["securitySchemes"] = {"TemporarySession": {"type": "http", "scheme": "bearer", "description": "Free anonymous session, issued automatically; not a registered API Key"}, "SessionCookie": {"type": "apiKey", "in": "cookie", "name": "md2docx_session"}}
        for path, methods in schema["paths"].items():
            if path.startswith("/v1/jobs"):
                for operation in methods.values():
                    operation["security"] = [{"TemporarySession": []}, {"SessionCookie": []}]
                    if path == "/v1/jobs":
                        operation["security"].append({})
        app.openapi_schema = schema
        return schema
    app.openapi = openapi
    return app
