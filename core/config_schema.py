#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Schema, defaults and persistence for MD2DOCX project profiles."""

from __future__ import annotations

import json
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 2

DEFAULT_CONFIG: dict[str, Any] = json.loads(
    Path(__file__).with_name("defaults.json").read_text(encoding="utf-8")
)



def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> None:
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value


def _mapping(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"配置字段 {path} 必须是对象。")
    return value


def _boolean(value: Any, path: str) -> None:
    if not isinstance(value, bool):
        raise ValueError(f"配置字段 {path} 必须是布尔值。")


def _number(value: Any, path: str, *, minimum: float | None = None, exclusive_minimum: float | None = None) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"配置字段 {path} 必须是数字。")
    if not math.isfinite(value):
        raise ValueError(f"配置字段 {path} 必须是有限数字。")
    if minimum is not None and value < minimum:
        raise ValueError(f"配置字段 {path} 不能小于 {minimum}。")
    if exclusive_minimum is not None and value <= exclusive_minimum:
        raise ValueError(f"配置字段 {path} 必须大于 {exclusive_minimum}。")


def _enum(value: Any, path: str, allowed: set[str]) -> None:
    if not isinstance(value, str) or value not in allowed:
        choices = ", ".join(sorted(allowed))
        raise ValueError(f"配置字段 {path} 必须是 {choices} 之一。")


def _validate_style_group(settings: dict[str, Any], path: str) -> None:
    for key in ("sizePt", "lineSpacing", "firstLineChars", "spaceBeforePt", "spaceAfterPt", "leftIndentCm", "cellPaddingPt"):
        if key in settings:
            _number(settings[key], f"{path}.{key}", minimum=0)
    for key in ("bold", "italic", "wrap", "showLanguage", "headerBold", "threeLine"):
        if key in settings:
            _boolean(settings[key], f"{path}.{key}")
    if "alignment" in settings:
        _enum(settings["alignment"], f"{path}.alignment", {"left", "center", "right", "justify"})


def normalize_config(user_config: dict[str, Any] | None) -> dict[str, Any]:
    """Return a validated schemaVersion 2 profile with defaults applied."""
    result = json.loads(json.dumps(DEFAULT_CONFIG, ensure_ascii=False))
    if user_config is None:
        result["updatedAt"] = datetime.now(timezone.utc).isoformat()
        return result
    if not isinstance(user_config, dict) or isinstance(user_config, list):
        raise ValueError("配置必须是 JSON 对象。")
    if "schemaVersion" not in user_config:
        raise ValueError("配置缺少必需字段 schemaVersion。")
    if user_config.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError(f"不支持的配置 schemaVersion：{user_config.get('schemaVersion')!r}。")
    _deep_merge(result, user_config)
    # File selection and output location belong to the current task, not a reusable profile.
    result.pop("files", None)
    result.pop("outputDirectory", None)
    result["schemaVersion"] = SCHEMA_VERSION
    if not isinstance(result.get("id"), str) or not result["id"].strip():
        raise ValueError("配置字段 id 必须是非空字符串。")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", result["id"]):
        raise ValueError("配置字段 id 只能包含小写字母、数字、下划线和短横线。")
    result.pop("name", None)
    for deprecated in ("headerFooter", "toc", "sections", "lists", "notes", "references"):
        result.pop(deprecated, None)
    result["updatedAt"] = result.get("updatedAt") or datetime.now(timezone.utc).isoformat()
    if not isinstance(result["updatedAt"], str):
        raise ValueError("配置字段 updatedAt 必须是字符串。")
    page = _mapping(result.get("page"), "page")
    _enum(page.get("preset"), "page.preset", {"A4", "A5", "Letter"})
    _enum(page.get("orientation"), "page.orientation", {"portrait", "landscape"})
    for key in ("widthCm", "heightCm"):
        _number(page.get(key), f"page.{key}", exclusive_minimum=0)
    for key in ("topMarginCm", "bottomMarginCm", "leftMarginCm", "rightMarginCm"):
        _number(page.get(key), f"page.{key}", minimum=0)

    numbering = _mapping(result.get("numbering"), "numbering")
    for key in ("enabled", "stripExisting"):
        _boolean(numbering.get(key), f"numbering.{key}")
    start_at = numbering.get("startAt")
    if isinstance(start_at, bool) or not isinstance(start_at, int) or start_at not in {1, 2, 3, 4, 5, 6}:
        raise ValueError("numbering.startAt 必须是 1 到 6 的整数。")

    styles = _mapping(result.get("styles"), "styles")
    for key in DEFAULT_CONFIG["styles"]:
        _validate_style_group(_mapping(styles.get(key), f"styles.{key}"), f"styles.{key}")

    options = _mapping(result.get("options"), "options")
    for deprecated in ("imagePolicy", "mermaid", "preview"):
        options.pop(deprecated, None)
    _enum(options.get("math"), "options.math", {"omml", "text"})
    _enum(options.get("mathFallback"), "options.mathFallback", {"warning", "text"})
    images = _mapping(options.get("images"), "options.images")
    _enum(images.get("alignment"), "options.images.alignment", {"left", "center", "right"})
    _number(images.get("maxWidthCm"), "options.images.maxWidthCm", minimum=0)
    for key in ("keepRatio", "captionEnabled"):
        _boolean(images.get(key), f"options.images.{key}")

    result.pop("elements", None)
    return result


def load_config(path: Path | None) -> dict[str, Any]:
    if path is None:
        return normalize_config(None)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"配置 JSON 无法解析：{error}") from error
    return normalize_config(data)


def save_config(path: Path, config: dict[str, Any]) -> dict[str, Any]:
    """Validate and atomically replace a profile file."""
    normalized = normalize_config(config)
    normalized["updatedAt"] = datetime.now(timezone.utc).isoformat()
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return normalized
