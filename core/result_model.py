#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared result and warning models for the core and CLI."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class WarningItem:
    kind: str
    message: str
    line: int | None = None
    source: str | None = None


@dataclass
class ConversionItem:
    source: str
    output: str
    success: bool
    warnings: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None
    skipped: bool = False


@dataclass
class ConversionResult:
    success: bool
    outputs: list[str] = field(default_factory=list)
    warnings: list[dict[str, Any]] = field(default_factory=list)
    errors: list[dict[str, Any]] = field(default_factory=list)
    items: list[dict[str, Any]] = field(default_factory=list)

