"""Verify the Linux environment with a real DOCX conversion; no product changes."""
import json
import struct
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

root = Path(__file__).resolve().parents[1]
work = root / "env" / "verification"
work.mkdir(parents=True, exist_ok=True)
source = work / "中文 环境验证.md"
output = work / "中文 环境验证.docx"
image = work / "图片.png"

def chunk(kind, payload):
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))

image.write_bytes(
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0))
    + chunk(b"IDAT", zlib.compress((b"\x00" + b"\x20\x70\xc0" * 8) * 8))
    + chunk(b"IEND", b"")
)
source.write_text(
    "# 2026 年度报告\n\n中文正文与 **bold**。\n\n"
    "| 项目 | 数量 |\n| --- | --- |\n| 文档 | 1 |\n\n"
    "![示例图片](图片.png)\n\n公式：$x^2+1$\n\n"
    "```python\nprint('hello')\n```\n",
    encoding="utf-8",
)
config = {"schemaVersion": 2, "id": "environment-check", "numbering": {"enabled": False, "stripExisting": False}}
args = [sys.executable, "cli/md2docx.py", "convert", str(source), "--config", "-", "--output", str(output), "--on-conflict", "overwrite", "--missing-images", "stop", "--progress", "jsonl"]
result = subprocess.run(args, input=json.dumps(config).encode("utf-8"), stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=root, timeout=60)
(work / "conversion.stdout.json").write_bytes(result.stdout)
(work / "conversion.stderr.jsonl").write_bytes(result.stderr)
payload = json.loads(result.stdout)
assert result.returncode == 0 and payload.get("success"), payload
assert output.is_file() and output.stat().st_size > 0
with zipfile.ZipFile(output) as archive:
    xml = archive.read("word/document.xml").decode("utf-8")
    text = "".join(ET.fromstring(xml).itertext())
    assert "2026 年度报告" in text and "中文正文" in text
    assert "<w:tbl" in xml and "<m:oMath" in xml
    assert any(name.startswith("word/media/") for name in archive.namelist())
summary = {"success": True, "python": sys.version.split()[0], "output": str(output), "objects": payload["items"][0]["objects"], "warnings": payload.get("warnings", [])}
(work / "smoke-result.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False, indent=2))
