#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Structured errors shared by the converter and CLI output."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class ErrorItem:
    code: str
    category: str
    severity: str
    jobId: str | None
    file: str | None
    stage: str | None
    line: int | None
    message: str
    suggestions: list[str] = field(default_factory=list)
    recoverable: bool = False
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class CoreError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        stage: str,
        category: str = "conversion",
        line: int | None = None,
        suggestions: list[str] | None = None,
        recoverable: bool = False,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.stage = stage
        self.category = category
        self.line = line
        self.suggestions = suggestions or []
        self.recoverable = recoverable
        self.details = details or {}
