import asyncio
from datetime import datetime, timezone
import hashlib
import json
import logging
from pathlib import Path
import secrets
import shutil
import stat
import time
import zipfile
from .errors import ApiError
from .runner import RunFailure
from .store import ACTIVE, TERMINAL

log = logging.getLogger("md2docx.server")


def utc(value=None):
    return datetime.fromtimestamp(time.time() if value is None else value, timezone.utc).isoformat().replace("+00:00", "Z")


def public(job):
    def clean(value):
        if isinstance(value, dict):
            return {k: clean(v) for k, v in value.items() if not k.startswith("_")}
        if isinstance(value, list):
            return [clean(v) for v in value]
        return value
    value = clean(job)
    states = ("succeeded", "failed", "skipped", "pending", "running", "unprocessed")
    value["summary"] = {"total": len(job["items"]), **{state: sum(x["status"] == state for x in job["items"]) for state in states}}
    return value


def failure(code, document=None):
    messages = {
        "IMAGE_NOT_FOUND": "文档引用的本地图片缺失。",
        "INPUT_ENCODING": "Markdown 必须使用 UTF-8 编码。",
        "PANDOC_CONVERSION_FAILED": "Markdown 转换失败，请检查语法和资源。",
        "DOCX_POSTPROCESS_FAILED": "样式处理失败，请检查配置。",
        "FILE_TIMEOUT": "该文件超过转换时限。",
        "JOB_TIMEOUT": "任务超过总执行时限。",
        "QUEUE_TIMEOUT": "排队时间超过限制。",
        "CONVERTER_OUTPUT_LIMIT": "转换产生的诊断或输出超过限制。",
        "OUTPUT_LIMIT": "生成文档超过大小或结构限制。",
        "STORAGE_LIMIT": "服务器存储预算不足，已停止当前文件。",
        "SERVER_RESTARTED": "服务重启中断了任务，请重新提交。",
        "SERVICE_STOPPED": "服务停止中断了任务，请重新提交。",
        "CANCELLED": "任务已取消。",
    }
    return {"code": code, "message": messages.get(code, "转换失败，请检查文档和样式配置。"), "documentId": document, "retryable": code in {"SERVER_RESTARTED", "SERVICE_STOPPED"}, "line": None}


class Jobs:
    def __init__(self, settings, store, sandbox):
        self.settings, self.store, self.sandbox = settings, store, sandbox
        self.root = settings.data_dir / "jobs"
        self.staging = settings.data_dir / "staging"
        self.root.mkdir(exist_ok=True, mode=0o700)
        self.staging.mkdir(exist_ok=True, mode=0o700)
        self.current = None
        self.cancel_event = None
        self.stopping = False
        self.task = None
        self.ready = False

    async def start(self):
        self.ready = await self.sandbox.probe()
        for job in self.store.all({"running", "cancelling"}):
            self.finish(job, "failed", "SERVER_RESTARTED")
        # Only one server instance owns this data directory (enforced by flock).
        for child in self.staging.iterdir():
            if child.is_dir():
                shutil.rmtree(child)
        referenced = {j["jobId"] for j in self.store.all()}
        for child in self.root.iterdir():
            if child.is_dir() and child.name not in referenced:
                shutil.rmtree(child)
        self.cleanup()
        if self.settings.worker_enabled:
            self.task = asyncio.create_task(self.loop())

    async def close(self):
        self.stopping = True
        if self.cancel_event:
            self.cancel_event.set()
        if self.task:
            await self.task

    def workspace(self, job_id):
        return self.root / job_id

    def ensure_storage(self, reserve=0):
        s = self.settings
        used = sum(p.stat().st_size for p in s.data_dir.rglob("*") if p.is_file() and not p.is_symlink())
        if used + reserve >= s.max_storage_bytes or shutil.disk_usage(s.data_dir).free < s.min_free_bytes + reserve:
            raise ApiError(503, "STORAGE_BUSY", "存储空间暂时不足，请稍后重试。", retry_after=60)

    def get(self, job_id, owner):
        job = self.store.get(job_id, owner)
        if job["status"] == "expired" or (job.get("_expires") and job["_expires"] <= time.time()):
            raise ApiError(410, "RESOURCE_EXPIRED", "任务已过期或删除。")
        return job

    def finish(self, job, status, code=None):
        now = time.time()
        job["status"] = status
        job["finishedAt"] = utc(now)
        job["_expires"] = now + self.settings.retention_seconds
        job["expiresAt"] = utc(job["_expires"])
        if code:
            job["error"] = failure(code)
        for item in job["items"]:
            if item["status"] in {"pending", "running"}:
                item["status"] = "unprocessed"
                item["stage"] = None
        self.store.save(job)
        workspace = self.workspace(job["jobId"])
        # Source text, resources and full configuration do not stay until output expiry.
        shutil.rmtree(workspace / "inputs", ignore_errors=True)
        (workspace / "config.json").unlink(missing_ok=True)
        if (workspace / "outputs").is_dir():
            keep = {x["artifact"]["_file"] for x in job["items"] if x.get("artifact")}
            for child in (workspace / "outputs").iterdir():
                if child.name not in keep:
                    if child.is_dir() and not child.is_symlink():
                        shutil.rmtree(child)
                    else:
                        child.unlink(missing_ok=True)

    def cancel(self, job):
        if job["status"] == "queued":
            self.finish(job, "cancelled", "CANCELLED")
        elif job["status"] in {"running", "cancelling"}:
            job["status"] = "cancelling"
            self.store.save(job)
            if self.current == job["jobId"] and self.cancel_event:
                self.cancel_event.set()
        return self.store.get(job["jobId"])

    def delete(self, job):
        if job["status"] in ACTIVE:
            raise ApiError(409, "JOB_STATE_CONFLICT", "请先取消任务并等待停止，再删除。")
        folder = self.workspace(job["jobId"])
        try:
            if folder.exists():
                shutil.rmtree(folder)
        except OSError:
            raise ApiError(503, "CLEANUP_FAILED", "清理尚未完成，请稍后重试。", retry_after=10)
        self.store.expire(job)

    def cleanup(self):
        now = time.time()
        for job in self.store.all():
            if job.get("_expires", float("inf")) <= now and job["status"] != "expired":
                try:
                    self.delete(job)
                except ApiError:
                    log.warning("Task cleanup delayed: %s", job["jobId"])
        self.store.prune()

    async def loop(self):
        last_cleanup = 0
        while not self.stopping:
            if time.monotonic() - last_cleanup > 10:
                self.cleanup()
                last_cleanup = time.monotonic()
            job = self.store.next_job()
            if job is None:
                await asyncio.sleep(0.15)
                continue
            try:
                await self.execute(job)
            except Exception:
                log.exception("Worker failed for job %s", job["jobId"])
                current = self.store.get(job["jobId"])
                self.finish(current, "failed", "INTERNAL_ERROR")
            finally:
                self.current = None
                self.cancel_event = None

    def artifact(self, path, filename):
        s = self.settings
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= s.max_output_bytes:
            raise RunFailure("OUTPUT_LIMIT")
        with zipfile.ZipFile(path) as archive:
            members = archive.infolist()
            if len(members) > 2000 or sum(x.file_size for x in members) > 64 * 1024 * 1024 or "word/document.xml" not in archive.namelist():
                raise RunFailure("OUTPUT_LIMIT")
        with path.open("rb") as stream:
            checksum = hashlib.file_digest(stream, "sha256").hexdigest()
        return {"id": "art_" + secrets.token_hex(16), "filename": filename, "sizeBytes": info.st_size, "sha256": checksum, "_file": path.name}

    async def execute(self, job):
        s = self.settings
        if time.time() - job["_created"] > s.queue_timeout:
            self.finish(job, "timed_out", "QUEUE_TIMEOUT")
            return
        self.current = job["jobId"]
        self.cancel_event = asyncio.Event()
        job["status"] = "running"
        job["startedAt"] = utc()
        self.store.save(job)
        deadline = time.monotonic() + s.job_timeout
        for index in range(len(job["items"])):
            job = self.store.get(self.current)
            if self.cancel_event.is_set():
                self.finish(job, "failed" if self.stopping else "cancelled", "SERVICE_STOPPED" if self.stopping else "CANCELLED")
                return
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self.finish(job, "timed_out", "JOB_TIMEOUT")
                return
            item = job["items"][index]
            item["status"], item["stage"] = "running", "queued"
            self.store.save(job)

            def stage(value):
                current = self.store.get(self.current)
                current["items"][index]["stage"] = value
                self.store.save(current)
            output_name = f"document-{index}.docx"
            output = self.workspace(self.current) / "outputs" / output_name
            try:
                try:
                    self.ensure_storage(s.max_output_bytes)
                except ApiError:
                    raise RunFailure("STORAGE_LIMIT")
                report = await self.sandbox.run(self.workspace(self.current), item["_input"], output_name, job["_execution"], self.current, self.cancel_event, stage, min(s.file_timeout, remaining))
                job = self.store.get(self.current)
                item = job["items"][index]
                item["artifact"] = self.artifact(output, Path(item["path"]).stem + ".docx")
                item["status"], item["stage"] = "succeeded", "completed"
                item["objects"] = {k: v for k, v in report.get("objects", {}).items() if k in {"paragraphs", "images", "tables", "omml"} and isinstance(v, int)}
                item["durationMs"] = report.get("durationMs")
                for warning in report.get("warnings", [])[:100]:
                    kind = warning.get("kind", "conversion")
                    messages = {"missing-image": "图片缺失，结果可能缺少插图。", "external-image": "网络图片无法在隔离环境中读取，请随文档上传。", "unsupported-mermaid": "现有核心未将 Mermaid 转为图片。", "unclosed-code-fence": "代码围栏未闭合。", "math-fallback": "公式已回退为文本。"}
                    line = warning.get("line")
                    item["warnings"].append({"code": kind.upper().replace("-", "_"), "message": messages.get(kind, "转换引擎报告了警告，请检查结果文档。"), "documentId": item["documentId"], "line": line if type(line) is int and line > 0 else None})
            except RunFailure as error:
                job = self.store.get(self.current)
                item = job["items"][index]
                if error.code == "CANCELLED":
                    self.finish(job, "failed" if self.stopping else "cancelled", "SERVICE_STOPPED" if self.stopping else "CANCELLED")
                    return
                if time.monotonic() >= deadline:
                    self.finish(job, "timed_out", "JOB_TIMEOUT")
                    return
                item["status"], item["stage"] = "failed", None
                item["error"] = failure(error.code, item["documentId"])
            self.store.save(job)
            # CLI report/temporary files are internal and never published.
            for child in output.parent.iterdir():
                if child.name.endswith(".warnings.json") or child.name.startswith(".md2docx_"):
                    child.unlink(missing_ok=True)
            if item["status"] == "failed" and job["_execution"]["batchErrors"] == "stop":
                break
        job = self.store.get(self.current)
        if self.cancel_event.is_set():
            self.finish(job, "failed" if self.stopping else "cancelled", "SERVICE_STOPPED" if self.stopping else "CANCELLED")
            return
        successes = sum(x["status"] == "succeeded" for x in job["items"])
        status = "succeeded" if successes == len(job["items"]) else "partially_succeeded" if successes else "failed"
        self.finish(job, status)
