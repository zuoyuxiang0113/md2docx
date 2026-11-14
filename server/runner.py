"""Run the existing CLI in an unprivileged, networkless filesystem namespace."""
import asyncio
import json
import math
import os
from pathlib import Path
import shutil
import signal
import sys
from .errors import ApiError, REASONS, scrub


class RunFailure(Exception):
    """ADR-009：失败必须携带可定位的脱敏诊断，而不是只有一个笼统错误码。

    diagnostic 只进入服务端日志与 job 的私有字段（下划线前缀），
    由 public() 过滤，不会出现在任何 HTTP 响应中。
    """

    def __init__(self, code, *, stage=None, exit_code=None, signal_name=None, detail=None):
        self.code = code
        self.diagnostic = {
            "reason": REASONS.get(code, "conversion-error"),
            "stage": stage,
            "exitCode": exit_code,
            "signal": signal_name,
            "detail": scrub(detail) if detail else None,
        }
        super().__init__(code)


class Sandbox:
    def __init__(self, settings):
        self.settings = settings
        self.executable = shutil.which("bwrap")

    def base(self):
        if not self.executable:
            raise RunFailure("SANDBOX_UNAVAILABLE")
        s = self.settings
        args = [self.executable, "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--clearenv"]
        for location in ("/usr", "/lib", "/lib64"):
            if Path(location).exists():
                args += ["--ro-bind", location, location]
        args += ["--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", "/app", "--dir", "/etc"]
        for name in ("core", "cli"):
            args += ["--ro-bind", str(s.project / name), f"/app/{name}"]
        args += ["--ro-bind", str(s.runtime), "/runtime"]
        if Path("/etc/fonts").exists():
            args += ["--ro-bind", "/etc/fonts", "/etc/fonts"]
        for key, value in {"PATH": "/runtime/bin:/usr/bin", "HOME": "/tmp", "LANG": "C.UTF-8", "PYTHONPATH": "/app", "PYTHONDONTWRITEBYTECODE": "1", "MD2DOCX_PANDOC": "/runtime/bin/pandoc", "MD2DOCX_LOG_ENABLED": "0", "GHCRTS": "-M256m"}.items():
            args += ["--setenv", key, value]
        return args

    async def probe(self):
        try:
            command = self.base() + ["--", "/runtime/bin/python", "-c", "import docx,lxml,PIL,subprocess; subprocess.run(['/runtime/bin/pandoc','--version'],check=True,stdout=subprocess.DEVNULL)"]
            process = await asyncio.create_subprocess_exec(*command, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, start_new_session=True)
            try:
                await asyncio.wait_for(process.wait(), 10)
            except asyncio.TimeoutError:
                os.killpg(process.pid, signal.SIGKILL)
                await process.wait()
                return False
            return process.returncode == 0
        except (OSError, RunFailure):
            return False

    async def run(self, workspace, source, output_name, execution, job_id, cancel, on_stage, timeout):
        s = self.settings
        command = self.base()
        command += ["--ro-bind", str(workspace / "inputs"), "/inputs", "--bind", str(workspace / "outputs"), "/outputs", "--ro-bind", str(workspace / "config.json"), "/config.json", "--chdir", "/inputs", "--", "/runtime/bin/python", "/app/cli/md2docx.py", "convert", "/inputs/" + source, "--output", "/outputs/" + output_name, "--config", "/config.json", "--on-conflict", "fail", "--missing-images", execution["missingImages"], "--progress", "jsonl", "--job-id", job_id]
        return await self._execute(command, cancel, on_stage, timeout)

    async def validate_images(self, workspace, resources):
        command = self.base() + ["--dir", "/app/server"]
        for name in ("__init__.py", "errors.py", "validation.py", "image_guard.py"):
            command += ["--ro-bind", str(Path(__file__).with_name(name)), "/app/server/" + name]
        payload = json.dumps({"resources": resources, "max_image_bytes": self.settings.max_image_bytes, "max_image_pixels": self.settings.max_image_pixels, "max_request_bytes": self.settings.max_request_bytes})
        command += ["--bind", str(workspace / "inputs"), "/inputs", "--chdir", "/inputs", "--", "/runtime/bin/python", "-m", "server.image_guard", payload]
        await self._execute(command, asyncio.Event(), lambda stage: None, min(20, self.settings.file_timeout), memory=256 * 1024 * 1024)

    async def _execute(self, command, cancel, on_stage, timeout, memory=None):
        s = self.settings
        command = [sys.executable, str(Path(__file__).with_name("limit_exec.py")), str(memory or s.process_memory_bytes), str(s.max_output_bytes), str(math.ceil(timeout)), *command]
        try:
            process = await asyncio.create_subprocess_exec(*command, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, start_new_session=True, env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"})
        except OSError as error:
            # ADR-009：进程根本没起来，与转换失败必须区分开。
            raise RunFailure("SPAWN_FAILED", stage="spawn", detail=f"{type(error).__name__}: {error}")
        stdout = bytearray()
        stderr_tail = bytearray()
        last_stage = {"value": None}

        async def read(stream, progress=False):
            total = 0
            pending = bytearray()
            while chunk := await stream.read(16384):
                total += len(chunk)
                if total > s.max_stream_bytes:
                    raise RunFailure("CONVERTER_OUTPUT_LIMIT")
                if not progress:
                    stdout.extend(chunk)
                    continue
                # ADR-009：默认不采集 stderr；管理员显式开启后只保留有限尾部。
                if s.diagnostic_stderr:
                    stderr_tail.extend(chunk)
                    if len(stderr_tail) > 8192:
                        del stderr_tail[:-8192]
                pending.extend(chunk)
                while b"\n" in pending:
                    line, _, rest = pending.partition(b"\n")
                    pending[:] = rest
                    try:
                        event = json.loads(line)
                        stage = event.get("stage")
                        if stage in {"load-config", "queued", "preflight", "pandoc", "postprocess", "validate", "write-output", "completed"}:
                            last_stage["value"] = stage
                            on_stage(stage)
                    except (ValueError, TypeError, AttributeError):
                        pass

        readers = [asyncio.create_task(read(process.stdout)), asyncio.create_task(read(process.stderr, True))]
        waiter = asyncio.create_task(process.wait())
        cancelled = asyncio.create_task(cancel.wait())
        collector = asyncio.gather(waiter, *readers)
        failure = None
        failure_stage = None
        try:
            done, _ = await asyncio.wait({collector, cancelled}, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
            if cancel.is_set():
                failure = "CANCELLED"
            elif collector not in done:
                failure = "FILE_TIMEOUT"
            else:
                await collector
        except RunFailure as error:
            failure = error.code
            failure_stage = error.diagnostic.get("stage")
        except asyncio.CancelledError:
            failure = "CANCELLED"
        finally:
            # Kill the entire namespace/process group, including Pandoc, on every exit.
            try:
                if process.returncode is None:
                    os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await process.wait()
            cancelled.cancel()
            await asyncio.gather(cancelled, *readers, return_exceptions=True)
            if not collector.done():
                collector.cancel()
            await asyncio.gather(collector, return_exceptions=True)
        if failure:
            raise RunFailure(failure, stage=failure_stage or last_stage["value"], exit_code=process.returncode, signal_name=_signal_name(process.returncode), detail=_stderr_detail(stderr_tail))
        try:
            payload = json.loads(stdout)
        except (ValueError, UnicodeError):
            # ADR-009：这正是历史 CONVERTER_FAILED 的判定点，必须带上退出码、信号和阶段。
            raise RunFailure("CONVERTER_FAILED", stage=last_stage["value"], exit_code=process.returncode, signal_name=_signal_name(process.returncode), detail=_stderr_detail(stderr_tail) or _stdout_head(stdout))
        if process.returncode or not payload.get("success"):
            codes = payload.get("errors") or []
            code = codes[0].get("code", "CONVERSION_FAILED") if codes else "CONVERSION_FAILED"
            stage = codes[0].get("stage") if codes else None
            message = codes[0].get("message") if codes else None
            raise RunFailure(code, stage=stage or last_stage["value"], exit_code=process.returncode, signal_name=_signal_name(process.returncode), detail=message)
        if not payload.get("items") or not payload["items"][0].get("success"):
            item = (payload.get("items") or [{}])[0]
            errors = item.get("errors") or []
            raise RunFailure("CONVERSION_FAILED", stage=last_stage["value"], exit_code=process.returncode, detail=errors[0].get("message") if errors else None)
        return payload["items"][0]


def _signal_name(returncode):
    """ADR-009：把 rlimit 触发的负退出码翻译成可读信号名。"""
    if returncode is None or returncode >= 0:
        return None
    try:
        return signal.Signals(-returncode).name
    except (ValueError, AttributeError):
        return f"SIG{-returncode}"


def _stderr_detail(buffer):
    if not buffer:
        return None
    return bytes(buffer).decode("utf-8", "replace").strip() or None


def _stdout_head(buffer, limit=512):
    """stdout 不是 JSON 时保留开头片段，便于判断是空输出还是被截断。"""
    if not buffer:
        return "<empty stdout>"
    return bytes(buffer[:limit]).decode("utf-8", "replace")
