#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Small dependency-free JSONL logger shared by the CLI and conversion core."""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4


LEVELS = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "FATAL": 50}
DEFAULT_MAX_BYTES = 5 * 1024 * 1024
DEFAULT_KEEP_FILES = 10
DEFAULT_RETENTION_DAYS = 7
DEFAULT_MAX_TOTAL_BYTES = 100 * 1024 * 1024


def new_job_id() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid4().hex[:8]


def default_log_dir() -> Path:
    configured = os.environ.get("MD2DOCX_LOG_DIR")
    if configured:
        return Path(configured).expanduser()
    app_data = os.environ.get("APPDATA")
    if app_data:
        return Path(app_data) / "md2docx-desktop-demo" / "logs"
    return Path.home() / ".config" / "md2docx-desktop-demo" / "logs"


def safe_filename(value: str | os.PathLike[str] | None) -> str | None:
    if value is None:
        return None
    text = str(value).replace("\\", "/")
    return text.rsplit("/", 1)[-1] or None


def sanitize_message(value: Any, limit: int = 2000) -> str:
    text = str(value or "")
    text = re.sub(r"(?i)(?:[a-z]:[\\/]|\\\\)[^\r\n\"']+", lambda match: f"<path:{safe_filename(match.group(0))}>", text)
    text = re.sub(r"(?<![\w.])/[^\s\"']+", lambda match: f"<path:{safe_filename(match.group(0))}>", text)
    if len(text) > limit:
        text = text[:limit] + "…"
    return text


def _sanitize_details(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _sanitize_details(item) for key, item in value.items() if key not in {"content", "markdown", "body", "config", "configSnapshot"}}
    if isinstance(value, list):
        return [_sanitize_details(item) for item in value[:20]]
    if isinstance(value, str):
        return sanitize_message(value, 1000)
    return value


class JsonlLogger:
    """Writes application and per-job records without ever logging document content."""

    def __init__(
        self,
        log_dir: Path | None = None,
        *,
        job_id: str | None = None,
        level: str | None = None,
        retention_days: int = DEFAULT_RETENTION_DAYS,
    ) -> None:
        self.log_dir = (log_dir or default_log_dir()).resolve()
        self.jobs_dir = self.log_dir / "jobs"
        self.job_id = job_id if job_id and re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", job_id) else None
        self.level = str(level or os.environ.get("MD2DOCX_LOG_LEVEL", "INFO")).upper()
        if self.level not in LEVELS:
            self.level = "INFO"
        self.enabled = os.environ.get("MD2DOCX_LOG_ENABLED", "1") != "0"
        try:
            configured_retention = os.environ.get("MD2DOCX_LOG_RETENTION_DAYS", retention_days)
            self.retention_days = min(3650, max(1, int(configured_retention)))
        except (TypeError, ValueError):
            self.retention_days = DEFAULT_RETENTION_DAYS
        self.auto_cleanup = os.environ.get("MD2DOCX_LOG_AUTO_CLEANUP", "1") != "0"
        self._prepared = False
        self._next_cleanup = 0.0

    def _prepare(self) -> None:
        if not self._prepared:
            self.log_dir.mkdir(parents=True, exist_ok=True)
            self.jobs_dir.mkdir(parents=True, exist_ok=True)
        if self.auto_cleanup and time.monotonic() >= self._next_cleanup:
            self._cleanup()
            self._next_cleanup = time.monotonic() + 3600
        self._prepared = True

    def _cleanup(self) -> None:
        cutoff = datetime.now().timestamp() - timedelta(days=self.retention_days).total_seconds()
        for path in _log_files(self.log_dir):
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink(missing_ok=True)
            except OSError:
                continue
    def _rotate_log(self, target: Path, incoming_bytes: int) -> None:
        try:
            size = target.stat().st_size if target.exists() else 0
            if not size or size + incoming_bytes <= DEFAULT_MAX_BYTES:
                return
            target.rename(target.with_name(f"{target.name}.{int(time.time() * 1000)}-{uuid4()}"))
            archives = sorted(target.parent.glob(f"{target.name}.*"), key=lambda path: path.stat().st_mtime, reverse=True)
            for archive in archives[DEFAULT_KEEP_FILES:]:
                if archive.is_file():
                    archive.unlink(missing_ok=True)
        except OSError:
            return

    def _enforce_capacity(self, reserve: int) -> bool:
        entries = []
        for path in _log_files(self.log_dir):
            try:
                stat = path.stat()
                entries.append((stat.st_mtime, path, stat.st_size))
            except OSError:
                continue
        total = sum(entry[2] for entry in entries)
        for _, path, size in sorted(entries):
            if total + reserve <= DEFAULT_MAX_TOTAL_BYTES:
                break
            try:
                path.unlink(missing_ok=True)
                total -= size
            except OSError:
                continue
        return total + reserve <= DEFAULT_MAX_TOTAL_BYTES

    def log(
        self,
        level: str,
        event: str,
        *,
        component: str = "python",
        file: str | None = None,
        stage: str | None = None,
        code: str | None = None,
        message: str = "",
        duration_ms: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        if not self.enabled:
            return None
        normalized = str(level).upper()
        if normalized not in LEVELS or LEVELS[normalized] < LEVELS[self.level]:
            return None
        try:
            self._prepare()
        except OSError:
            return None
        record: dict[str, Any] = {
            "timestamp": datetime.now().astimezone().isoformat(timespec="milliseconds"),
            "level": normalized,
            "component": component,
            "event": event,
            "jobId": self.job_id,
            "file": safe_filename(file),
            "stage": stage,
            "code": code,
            "message": sanitize_message(message),
        }
        if duration_ms is not None:
            record["durationMs"] = duration_ms
        if details:
            record["details"] = _sanitize_details(details)
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
        try:
            if not self._enforce_capacity(len(line.encode("utf-8")) * (2 if self.job_id else 1)):
                return None
        except OSError:
            return None
        for target in (self.log_dir / "app.log", self.jobs_dir / f"{self.job_id}.jsonl" if self.job_id else None):
            if target is None:
                continue
            try:
                self._rotate_log(target, len(line.encode("utf-8")))
                with target.open("a", encoding="utf-8", newline="") as handle:
                    handle.write(line)
            except OSError:
                continue
        return record


def _log_files(root: Path) -> list[Path]:
    pattern = re.compile(r"(?:app\.log|[a-zA-Z0-9_-]+\.jsonl)(?:\.[a-zA-Z0-9_-]+)?")
    paths = []
    for directory in (root, root / "jobs"):
        if directory.is_dir():
            paths.extend(path for path in directory.iterdir() if path.is_file() and pattern.fullmatch(path.name))
    return paths


def clear_log_directory(log_dir: Path | None = None) -> int:
    root = (log_dir or default_log_dir()).resolve()
    removed = 0
    if not root.exists():
        return removed
    for path in _log_files(root):
        if path.is_file():
            try:
                path.unlink()
                removed += 1
            except OSError:
                continue
    return removed


def read_recent_records(log_dir: Path | None = None, limit: int = 200) -> list[dict[str, Any]]:
    root = (log_dir or default_log_dir()).resolve()
    limit = min(2000, max(1, limit))
    paths = sorted(_log_files(root), key=lambda path: path.stat().st_mtime if path.exists() else 0, reverse=True)[:30]
    records: list[dict[str, Any]] = []
    for path in paths:
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()[-limit:]
        except OSError:
            continue
        for line in lines:
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                value = _sanitize_details(value)
                value["file"] = safe_filename(value.get("file"))
                records.append(value)
    def timestamp(record: dict[str, Any]) -> float:
        try:
            return datetime.fromisoformat(str(record.get("timestamp", "")).replace("Z", "+00:00")).timestamp()
        except ValueError:
            return 0
    records.sort(key=timestamp)
    unique: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for record in records:
        key = tuple(record.get(name) for name in ("timestamp", "event", "jobId", "file", "stage", "message"))
        if key in seen:
            continue
        seen.add(key)
        unique.append(record)
    return unique[-limit:]
