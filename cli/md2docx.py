#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convenience entry point for the md2docx CLI."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from cli.md2docx_cli import main


if __name__ == "__main__":
    raise SystemExit(main())
