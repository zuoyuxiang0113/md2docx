#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stable command-line interface for Markdown to DOCX conversion."""

from __future__ import annotations

import argparse
import importlib.metadata
import importlib.util
import json
import os
import subprocess
import sys
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core import md2docx_core as core
from core.config_schema import load_config, normalize_config
from core.error_model import CoreError, ErrorItem
from core.logging_utils import JsonlLogger, new_job_id, safe_filename


EXIT_OK = 0
EXIT_ARGUMENT = 2
EXIT_CONFIG = 3
EXIT_INPUT = 4
EXIT_OUTPUT = 5
EXIT_RUNTIME = 6
EXIT_CONVERSION = 7
EXIT_PARTIAL = 8
EXIT_CANCELLED = 9


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise ValueError(message)


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=True, indent=2) + "\n")


def emit_progress(args: argparse.Namespace, job_id: str, event: str, stage: str | None = None, file: str | None = None, **extra: Any) -> None:
    if getattr(args, "progress", None) != "jsonl":
        return
    payload = {"event": event, "jobId": job_id, "stage": stage, "file": safe_filename(file), **extra}
    sys.stderr.write(json.dumps(payload, ensure_ascii=True, separators=(",", ":")) + "\n")
    sys.stderr.flush()


def add_common_arguments(command: argparse.ArgumentParser, *, config_required: bool = True) -> None:
    command.add_argument("--config", required=config_required, help="配置 JSON 路径，使用 - 从标准输入读取")
    command.add_argument("--progress", choices=["jsonl"], help="将阶段事件以 JSONL 写入标准错误")
    command.add_argument("--on-conflict", choices=["ask", "overwrite", "rename", "skip", "fail"], help="输出文件已存在时的处理方式")
    command.add_argument("--batch-errors", choices=["continue", "stop"], help="批量转换遇到错误时继续或停止")
    command.add_argument("--job-id", help=argparse.SUPPRESS)
    command.add_argument("--missing-images", choices=["warning", "stop"], default="warning", help="本地图片缺失时继续并警告或停止转换")


def build_parser() -> argparse.ArgumentParser:
    parser = JsonArgumentParser(prog="md2docx", description="Markdown 转 DOCX 工具")
    parser.add_argument("--version", action="store_true", help="显示版本")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出版本或诊断结果")
    commands = parser.add_subparsers(dest="command", required=False)

    convert = commands.add_parser("convert", help="转换一个 Markdown 文件")
    convert.add_argument("input", type=Path)
    convert.add_argument("--output", type=Path, required=True)
    convert.add_argument("--json", action="store_true", dest="json_output", help=argparse.SUPPRESS)
    add_common_arguments(convert)

    batch = commands.add_parser("batch", help="批量转换目录中的 Markdown 文件")
    batch.add_argument("input", type=Path, nargs="?")
    batch.add_argument("output", type=Path, nargs="?")
    batch.add_argument("--input-dir", type=Path, dest="input_dir")
    batch.add_argument("--output-dir", type=Path, dest="output_dir")
    batch.add_argument("--input-list", type=Path, dest="input_list", help="包含 Markdown 绝对路径数组的 JSON 文件")
    batch.add_argument("--recursive", action="store_true", default=True)
    batch.add_argument("--json", action="store_true", dest="json_output", help=argparse.SUPPRESS)
    add_common_arguments(batch)

    doctor = commands.add_parser("doctor", help="检查 Python、Pandoc 和配置运行环境")
    doctor.add_argument("--json", action="store_true", dest="json_output", help="以 JSON 输出")
    doctor.add_argument("--job-id", help=argparse.SUPPRESS)
    return parser


def config_metadata(config: dict[str, Any]) -> dict[str, Any]:
    return {"id": config["id"], "schemaVersion": config["schemaVersion"]}


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_config(value: str) -> dict[str, Any]:
    if value == "-":
        try:
            raw = sys.stdin.buffer.read().decode("utf-8")
            return normalize_config(json.loads(raw))
        except json.JSONDecodeError as error:
            raise ValueError(f"配置 JSON 无法解析：{error}") from error
    path = Path(value).resolve()
    if not path.is_file():
        raise ValueError(f"配置文件不存在：{path}")
    return load_config(path)


def check_executable(executable: str, args: list[str]) -> dict[str, Any]:
    try:
        process = subprocess.run([executable, *args], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
    except OSError as error:
        return {"available": False, "path": executable, "error": str(error)}
    version = (process.stdout or process.stderr).strip().splitlines()
    return {
        "available": process.returncode == 0,
        "path": executable,
        "version": version[0] if version else None,
        "error": None if process.returncode == 0 else (process.stderr or process.stdout).strip(),
    }


def check_python_module(python: str, module: str, distribution: str) -> dict[str, Any]:
    if getattr(sys, "frozen", False):
        try:
            spec = importlib.util.find_spec(module)
            version = importlib.metadata.version(distribution) if spec else None
            return {"available": bool(version), "path": spec.origin if spec else None, "version": version, "error": None if version else "未找到内置模块"}
        except Exception as error:
            return {"available": False, "path": None, "version": None, "error": str(error)}
    script = (
        "import importlib.metadata, importlib.util; "
        f"module={module!r}; distribution={distribution!r}; "
        "spec=importlib.util.find_spec(module); "
        "print(importlib.metadata.version(distribution) if spec else '')"
    )
    try:
        process = subprocess.run([python, "-c", script], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
    except OSError as error:
        return {"available": False, "path": python, "version": None, "error": str(error)}
    version = process.stdout.strip() or None
    return {"available": process.returncode == 0 and bool(version), "path": python, "version": version, "error": None if version else (process.stderr or "未找到模块").strip()}


def doctor(args: argparse.Namespace, logger: JsonlLogger, job_id: str) -> int:
    checks: dict[str, Any] = {}
    logger.log("INFO", "doctor_started", component="cli", stage="runtime", message="开始检查运行环境")
    try:
        checks["python"] = {"available": True, "path": sys.executable, "version": f"Python {sys.version.split()[0]}", "bundled": True} if getattr(sys, "frozen", False) else check_executable(core.find_python(), ["--version"])
    except Exception as error:
        checks["python"] = {"available": False, "error": str(error)}
    try:
        checks["pandoc"] = check_executable(core.find_pandoc(), ["--version"])
    except Exception as error:
        checks["pandoc"] = {"available": False, "error": str(error)}
    if checks["python"].get("available"):
        checks["pythonDocx"] = check_python_module(checks["python"]["path"], "docx", "python-docx")
        checks["lxml"] = check_python_module(checks["python"]["path"], "lxml", "lxml")
    else:
        checks["pythonDocx"] = {"available": False, "path": None, "version": None, "error": "Python 不可用"}
        checks["lxml"] = {"available": False, "path": None, "version": None, "error": "Python 不可用"}
    ready = bool(all(checks[name].get("available") for name in ("python", "pandoc", "pythonDocx", "lxml")))
    if ready:
        logger.log("INFO", "doctor_completed", component="cli", stage="runtime", message="运行环境可用")
    else:
        logger.log("ERROR", "doctor_failed", component="cli", stage="runtime", code="RUNTIME_NOT_READY", message="运行环境不可用", details={"checks": checks})
    emit({"success": ready, "command": "doctor", "jobId": job_id, "version": core.CORE_VERSION, "checks": checks, "errors": [] if ready else [error_for_runtime(checks, job_id)]})
    return EXIT_OK if ready else EXIT_RUNTIME


def error_for_runtime(checks: dict[str, Any], job_id: str) -> dict[str, Any]:
    labels = {"python": "Python", "pandoc": "Pandoc", "pythonDocx": "python-docx", "lxml": "lxml"}
    missing = next((label for key, label in labels.items() if not checks.get(key, {}).get("available")), "运行时依赖")
    return ErrorItem(
        code="RUNTIME_NOT_READY",
        category="environment",
        severity="error",
        jobId=job_id,
        file=None,
        stage="runtime",
        line=None,
        message=f"{missing} 运行环境不可用。",
        suggestions=["打开设置中的运行环境页面重新检测。"],
        recoverable=True,
    ).to_dict()


def log_core_event(event: dict[str, Any], args: argparse.Namespace, logger: JsonlLogger, job_id: str, source: Path) -> None:
    event_name = str(event.get("event", "stage"))
    level = "WARNING" if event_name == "warning" else "INFO"
    logger.log(level, f"core_{event_name}", component="core", file=str(source), stage=event.get("stage"), message=str(event.get("message", "")), details={"warningCount": event.get("warningCount")} if event.get("warningCount") is not None else None)
    emit_progress(args, job_id, event_name, event.get("stage"), str(source), warningCount=event.get("warningCount"))


def convert_one(source: Path, output: Path, config: dict[str, Any], args: argparse.Namespace, logger: JsonlLogger, job_id: str) -> dict[str, Any]:
    started = time.perf_counter()
    source = source.resolve()
    output = output.resolve()
    logger.log("INFO", "file_started", component="cli", file=str(source), stage="queued", message="开始处理文件")
    warnings = core.convert(source, output, config, on_event=lambda event: log_core_event(event, args, logger, job_id, source), missing_images=args.missing_images)
    try:
        objects = core.count_docx_objects(output)
    except Exception as error:
        raise CoreError("DOCX_VALIDATION_FAILED", str(error), stage="validate", category="output", suggestions=["检查输出文件是否完整生成。"], recoverable=True) from error
    item = {
        "source": str(source),
        "output": str(output),
        "success": True,
        "jobId": job_id,
        "config": config_metadata(config),
        "configSnapshot": config,
        "warnings": [asdict(item) for item in warnings],
        "objects": objects,
        "durationMs": round((time.perf_counter() - started) * 1000),
    }
    report_path = output.with_suffix(".warnings.json")
    write_json_atomic(report_path, {"success": True, **item})
    item["warningReport"] = str(report_path.resolve())
    logger.log("INFO", "file_completed", component="cli", file=str(source), stage="completed", duration_ms=item["durationMs"], details=objects)
    emit_progress(args, job_id, "completed", "completed", str(source), durationMs=item["durationMs"])
    return item


def run_convert(args: argparse.Namespace, config: dict[str, Any], logger: JsonlLogger, job_id: str) -> int:
    source = args.input.resolve()
    output = args.output.resolve()
    policy = getattr(args, "on_conflict", None) or "ask"
    if output.exists() and policy == "rename":
        output = next_available_output(output, set())
    if output.exists() and policy == "ask":
        raise CoreError("OUTPUT_EXISTS", f"输出文件已存在：{output.name}", stage="write-output", category="output", suggestions=["选择其他输出路径，或在设置中选择覆盖策略。"], recoverable=True)
    if output.exists() and policy == "skip":
        item = {"source": str(source), "output": str(output), "success": False, "skipped": True, "error": "输出文件已存在，已跳过。", "warnings": [], "config": config_metadata(config), "jobId": job_id}
        emit({
            "success": True,
            "command": "convert",
            "jobId": job_id,
            "outputs": [],
            "warnings": [],
            "warningReports": [],
            "errors": [],
            "config": config_metadata(config),
            "configSnapshot": config,
            "items": [item],
            "version": core.CORE_VERSION,
        })
        return EXIT_OK
    if output.exists() and policy == "fail":
        raise CoreError("OUTPUT_EXISTS", f"输出文件已存在：{output.name}", stage="write-output", category="output", suggestions=["选择其他输出路径，或使用 --on-conflict overwrite、rename 或 skip。"], recoverable=True)
    item = convert_one(source, output, config, args, logger, job_id)
    emit({
        "success": True,
        "command": "convert",
        "jobId": job_id,
        "outputs": [item["output"]],
        "warnings": item["warnings"],
        "warningReports": [item["warningReport"]],
        "errors": [],
        "config": config_metadata(config),
        "configSnapshot": config,
        "items": [item],
        "version": core.CORE_VERSION,
    })
    return EXIT_OK


def batch_sources(args: argparse.Namespace) -> tuple[list[Path], Path, Path | None]:
    source_value = args.input_dir or args.input
    output_value = args.output_dir or args.output
    if output_value is None:
        raise CoreError("ARGUMENT_INVALID", "batch 需要输出目录。", stage="arguments", category="argument", suggestions=["提供输出目录位置参数或 --output-dir。"])
    output_root = output_value.resolve()
    if args.input_list:
        list_path = args.input_list.resolve()
        try:
            payload = json.loads(list_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise CoreError("INPUT_LIST_INVALID", f"无法读取批量文件列表：{error}", stage="arguments", category="input", suggestions=["提供包含 Markdown 路径数组的 UTF-8 JSON 文件。"] ) from error
        values = payload.get("files") if isinstance(payload, dict) else payload
        if not isinstance(values, list) or any(not isinstance(value, str) or not value.strip() for value in values):
            raise CoreError("INPUT_LIST_INVALID", "批量文件列表必须是非空路径字符串数组。", stage="arguments", category="input", suggestions=["检查 --input-list JSON 内容。"])
        sources = [Path(value).resolve() for value in values]
        return sources, output_root, None
    if source_value is None:
        raise CoreError("ARGUMENT_INVALID", "batch 需要输入目录或 --input-list。", stage="arguments", category="argument", suggestions=["提供输入目录，或使用 --input-list。"])
    source_root = source_value.resolve()
    if not source_root.is_dir():
        raise CoreError("INPUT_DIRECTORY_NOT_FOUND", f"批量输入目录不存在：{source_root.name}", stage="preflight", category="input", suggestions=["选择存在的 Markdown 输入目录。"])
    iterator = source_root.rglob("*") if args.recursive else source_root.glob("*")
    return sorted(path for path in iterator if path.is_file() and path.suffix.lower() in {".md", ".markdown"}), output_root, source_root


def next_available_output(output: Path, reserved: set[str]) -> Path:
    candidate = output
    stem = output.stem
    index = 1
    while candidate.exists() or str(candidate).lower() in reserved:
        candidate = output.with_name(f"{stem} ({index}){output.suffix}")
        index += 1
    return candidate


def conflict_item(source: Path, output: Path, config: dict[str, Any], job_id: str, *, skipped: bool) -> dict[str, Any]:
    message = "输出文件已存在，已跳过。" if skipped else "输出文件已存在。"
    item: dict[str, Any] = {
        "source": str(source),
        "output": str(output),
        "success": False,
        "skipped": skipped,
        "error": message,
        "warnings": [],
        "config": config_metadata(config),
        "jobId": job_id,
    }
    if not skipped:
        item["errorObject"] = ErrorItem(
            "OUTPUT_EXISTS", "output", "error", job_id, str(source), "write-output", None,
            message, ["选择其他输出路径，或使用 --on-conflict overwrite、rename 或 skip。"], True,
        ).to_dict()
    return item


def run_batch(args: argparse.Namespace, config: dict[str, Any], logger: JsonlLogger, job_id: str) -> int:
    sources, output_root, source_root = batch_sources(args)
    items: list[dict[str, Any]] = []
    outputs: list[str] = []
    warnings: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    warning_reports: list[str] = []
    logger.log("INFO", "batch_started", component="cli", stage="queued", message="开始批量转换", details={"total": len(sources)})
    emit_progress(args, job_id, "started", "queued", None, total=len(sources))
    policy = getattr(args, "on_conflict", None) or "skip"
    stop_on_error = getattr(args, "batch_errors", None) == "stop"
    reserved: set[str] = set()
    for source in sources:
        output = (output_root / (source.relative_to(source_root) if source_root else Path(source.name))).with_suffix(".docx")
        if str(output).lower() in reserved:
            output = next_available_output(output, reserved)
        exists = output.exists()
        if exists and policy == "rename":
            output = next_available_output(output, reserved)
        elif exists and policy == "overwrite":
            pass
        elif exists and policy == "skip":
            item = conflict_item(source, output, config, job_id, skipped=True)
            items.append(item)
            logger.log("INFO", "file_skipped", component="cli", file=str(source), stage="write-output", code="OUTPUT_EXISTS", message=item["error"])
            emit_progress(args, job_id, "item", "completed", str(source), item=item)
            continue
        elif exists:
            item = conflict_item(source, output, config, job_id, skipped=False)
            items.append(item)
            errors.append(item["errorObject"])
            logger.log("ERROR", "file_failed", component="cli", file=str(source), stage="write-output", code="OUTPUT_EXISTS", message=item["error"])
            emit_progress(args, job_id, "error", "write-output", str(source), code="OUTPUT_EXISTS", message=item["error"])
            emit_progress(args, job_id, "item", "completed", str(source), item=item)
            if stop_on_error:
                break
            continue
        reserved.add(str(output).lower())
        try:
            item = convert_one(source, output, config, args, logger, job_id)
            warnings.extend(item["warnings"])
            warning_reports.append(item["warningReport"])
            outputs.append(item["output"])
        except Exception as error:
            structured = error_for_exception(error, job_id, source)
            report_path = output.with_suffix(".warnings.json")
            item = {"source": str(source), "output": str(output), "success": False, "skipped": False, "error": structured["message"], "errorObject": structured, "warnings": [], "config": config_metadata(config), "jobId": job_id, "warningReport": str(report_path.resolve())}
            write_json_atomic(report_path, {"success": False, **item})
            warning_reports.append(item["warningReport"])
            errors.append(structured)
            logger.log("ERROR", "file_failed", component="cli", file=str(source), stage=structured.get("stage"), code=structured.get("code"), message=structured.get("message", ""), details={"category": structured.get("category")})
            emit_progress(args, job_id, "error", structured.get("stage"), str(source), code=structured.get("code"), message=structured.get("message"))
        items.append(item)
        emit_progress(args, job_id, "item", "completed", str(source), item=item)
        if stop_on_error and not item.get("success", False):
            break
    success = not errors
    processed = len(items)
    unprocessed = max(0, len(sources) - processed)
    status = "completed" if success and unprocessed == 0 else "partial"
    logger.log("INFO" if success else "WARNING", "batch_completed", component="cli", stage="completed", message="批量转换完成", details={"total": len(items), "success": success, "errorCount": len(errors)})
    emit_progress(args, job_id, "completed", "completed", None, total=len(sources), processed=processed, unprocessed=unprocessed, success=success)
    emit({
        "success": success,
        "command": "batch",
        "jobId": job_id,
        "outputs": outputs,
        "warnings": warnings,
        "warningReports": warning_reports,
        "errors": errors,
        "config": config_metadata(config),
        "configSnapshot": config,
        "items": items,
        "status": status,
        "total": len(sources),
        "processed": processed,
        "unprocessed": unprocessed,
        "version": core.CORE_VERSION,
    })
    return EXIT_OK if success else EXIT_PARTIAL


def error_for_exception(error: Exception, job_id: str, source: Path | None = None, stage: str | None = None) -> dict[str, Any]:
    if isinstance(error, CoreError):
        return ErrorItem(error.code, error.category, "error", job_id, str(source) if source else None, error.stage, error.line, str(error), error.suggestions, error.recoverable, error.details).to_dict()
    if isinstance(error, ValueError):
        code = "CONFIG_INVALID" if source is None else "INVALID_ARGUMENT"
        category = "config" if source is None else "input"
        return ErrorItem(code, category, "error", job_id, str(source) if source else None, stage or "load-config", None, str(error), ["检查参数和配置文件内容。"], False).to_dict()
    if isinstance(error, FileNotFoundError):
        return ErrorItem("INPUT_NOT_FOUND", "input", "error", job_id, str(source) if source else None, stage or "preflight", None, str(error), ["检查输入文件路径。"], False).to_dict()
    return ErrorItem("INTERNAL_ERROR", "internal", "fatal", job_id, str(source) if source else None, stage, None, str(error), ["导出诊断报告并检查日志。"], False).to_dict()


def main(argv: list[str] | None = None) -> int:
    # Frozen Windows executables may ignore PYTHONIOENCODING at startup.
    # JSON escapes keep the machine protocol lossless even for other clients.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="strict")
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
        if args.version:
            if args.json:
                emit({"success": True, "command": "version", "version": core.CORE_VERSION})
            else:
                sys.stdout.write(core.CORE_VERSION + "\n")
            return EXIT_OK
        if not args.command:
            parser.error("必须指定命令，或使用 --version。")
        job_id = getattr(args, "job_id", None) or new_job_id()
        logger = JsonlLogger(job_id=job_id)
        logger.log("INFO", "command_started", component="cli", stage="queued", message="CLI 命令开始")
        if args.command == "doctor":
            return doctor(args, logger, job_id)
        try:
            config = read_config(args.config)
        except Exception as error:
            structured = error_for_exception(error, job_id)
            logger.log("ERROR", "config_failed", component="cli", stage="load-config", code=structured["code"], message=structured["message"])
            emit({"success": False, "command": args.command, "jobId": job_id, "outputs": [], "warnings": [], "errors": [structured], "version": core.CORE_VERSION})
            return EXIT_CONFIG
        logger.log("INFO", "config_loaded", component="cli", stage="load-config", message="配置加载完成", details=config_metadata(config))
        emit_progress(args, job_id, "stage", "load-config")
        if args.command == "convert":
            return run_convert(args, config, logger, job_id)
        return run_batch(args, config, logger, job_id)
    except ValueError as error:
        job_id = new_job_id()
        structured = ErrorItem("ARGUMENT_INVALID", "argument", "error", job_id, None, "arguments", None, str(error), ["检查命令、必需参数和参数取值。"], False).to_dict()
        emit({"success": False, "command": None, "jobId": job_id, "outputs": [], "warnings": [], "errors": [structured], "version": core.CORE_VERSION})
        return EXIT_ARGUMENT
    except Exception as error:
        job_id = locals().get("job_id") or new_job_id()
        structured = error_for_exception(error, job_id)
        try:
            logger.log("ERROR", "command_failed", component="cli", stage=structured.get("stage"), code=structured.get("code"), message=structured.get("message", ""))
        except UnboundLocalError:
            pass
        emit({"success": False, "command": getattr(locals().get("args"), "command", None), "jobId": job_id, "outputs": [], "warnings": [], "errors": [structured], "version": core.CORE_VERSION})
        category_codes = {"argument": EXIT_ARGUMENT, "config": EXIT_CONFIG, "input": EXIT_INPUT, "output": EXIT_OUTPUT, "environment": EXIT_RUNTIME, "conversion": EXIT_CONVERSION, "internal": EXIT_RUNTIME}
        return category_codes.get(structured["category"], EXIT_CONVERSION)


if __name__ == "__main__":
    raise SystemExit(main())
