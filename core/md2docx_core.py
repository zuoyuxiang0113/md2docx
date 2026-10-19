#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Markdown to DOCX conversion core.

The core deliberately keeps the conversion engine focused:

* Pandoc performs Markdown/GFM parsing and the initial DOCX conversion.
* python-docx applies a configurable Word style baseline.
* A preflight pass reports missing local images and unsupported Mermaid blocks.

The Electron client and CLI call this module without sharing UI state.
"""

from __future__ import annotations

import os
import re
import shutil
import sys
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Callable

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

from .result_model import WarningItem
from .error_model import CoreError


CORE_VERSION = "0.2.0"


def find_pandoc() -> str:
    resource_root = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1]
    bundled = resource_root / "runtime" / "pandoc" / ("pandoc.exe" if os.name == "nt" else "pandoc")
    configured = os.environ.get("MD2DOCX_PANDOC")
    if configured:
        candidate = Path(configured).expanduser()
        if candidate.is_file():
            return str(candidate)
        raise FileNotFoundError(f"MD2DOCX_PANDOC 指向的 Pandoc 不存在：{candidate}")
    if bundled.is_file():
        return str(bundled)
    found = shutil.which("pandoc")
    if not found:
        raise RuntimeError("找不到 Pandoc。请设置 MD2DOCX_PANDOC，或将 Pandoc 放入 runtime/pandoc。")
    return found


def find_python() -> str:
    bundled = Path(__file__).resolve().parents[1] / "runtime" / "python" / ("python.exe" if os.name == "nt" else "python")
    configured = os.environ.get("MD2DOCX_PYTHON")
    if configured:
        candidate = Path(configured).expanduser()
        if candidate.is_file():
            return str(candidate)
        raise FileNotFoundError(f"MD2DOCX_PYTHON 指向的 Python 不存在：{candidate}")
    if bundled.is_file():
        return str(bundled)
    for name in (("py.exe", "python.exe") if os.name == "nt" else ("python3", "python")):
        found = shutil.which(name)
        if found:
            return found
    raise RuntimeError("找不到 Python。请设置 MD2DOCX_PYTHON，或将 Python 放入 runtime/python。")


def line_number(text: str, position: int) -> int:
    return text.count("\n", 0, position) + 1


def resolve_image(source: str, md_dir: Path) -> Path | None:
    source = source.strip().strip("<>")
    source = source.split("#", 1)[0].split("?", 1)[0]
    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", source):
        return None
    candidate = Path(source)
    if not candidate.is_absolute():
        candidate = md_dir / candidate
    return candidate.resolve()


def preflight(source_path: Path) -> list[WarningItem]:
    text = source_path.read_text(encoding="utf-8")
    warnings: list[WarningItem] = []

    image_pattern = re.compile(r"!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)")
    for match in image_pattern.finditer(text):
        raw = match.group(1) or match.group(2) or ""
        if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", raw):
            warnings.append(WarningItem("external-image", f"网络图片未下载：{raw}", line_number(text, match.start()), str(source_path)))
            continue
        image_path = resolve_image(raw, source_path.parent)
        if image_path is None or not image_path.exists():
            warnings.append(WarningItem("missing-image", f"图片不存在：{raw}", line_number(text, match.start()), str(source_path)))

    fence_open: tuple[str, int, int] | None = None
    for index, line in enumerate(text.splitlines(), start=1):
        fence_match = re.match(r"^\s*(`{3,}|~{3,})(.*)$", line)
        if not fence_match:
            continue
        marker = fence_match.group(1)
        info = fence_match.group(2).strip()
        if fence_open is None:
            fence_open = (marker[0], len(marker), index)
            if info.lower() == "mermaid":
                warnings.append(WarningItem("unsupported-mermaid", "第一版 Demo 暂不转换 Mermaid。", index, str(source_path)))
        elif marker[0] == fence_open[0] and len(marker) >= fence_open[1]:
            fence_open = None
    if fence_open is not None:
        warnings.append(WarningItem("unclosed-code-fence", "检测到未闭合的代码围栏。", fence_open[2], str(source_path)))

    return warnings


def strip_heading_numbers(text: str) -> str:
    """Remove numeric prefixes from ATX headings before Pandoc numbering.

    This prevents input such as ``## 4.1 Detection`` from becoming
    ``1.1 4.1 Detection`` when ``--number-sections`` is enabled.  Only the
    heading line is changed; the original Markdown remains untouched.
    """
    pattern = re.compile(r"^(?P<hashes>\s{0,3}#{1,6}\s+)(?P<number>(?:第\s*)?\d+(?:\.\d+)*(?:[.)])?\s+)(?P<title>.+?)\s*$")
    lines = []
    fence_open: tuple[str, int] | None = None
    for line in text.splitlines(keepends=True):
        fence_match = re.match(r"^\s*(`{3,}|~{3,})", line)
        if fence_match:
            marker = fence_match.group(1)
            if fence_open is None:
                fence_open = (marker[0], len(marker))
            elif marker[0] == fence_open[0] and len(marker) >= fence_open[1]:
                fence_open = None
            lines.append(line)
            continue
        if fence_open is not None:
            lines.append(line)
            continue
        match = pattern.match(line)
        if match:
            newline = "\n" if line.endswith("\n") else ""
            lines.append(f"{match.group('hashes')}{match.group('title')}{newline}")
        else:
            lines.append(line)
    return "".join(lines)


def set_run_fonts(
    run,
    east_asia: str,
    ascii_font: str,
    size_pt: float | None = None,
    color: str | None = None,
    *,
    bold: bool | None = None,
    italic: bool | None = None,
) -> None:
    if size_pt is not None:
        run.font.size = Pt(size_pt)
    if color:
        run.font.color.rgb = RGBColor.from_string(color.replace("#", ""))
    if bold is not None:
        run.font.bold = bold
    if italic is not None:
        run.font.italic = italic
    rpr = run._r.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.insert(0, rfonts)
    rfonts.set(qn("w:eastAsia"), east_asia)
    rfonts.set(qn("w:ascii"), ascii_font)
    rfonts.set(qn("w:hAnsi"), ascii_font)
    rfonts.set(qn("w:cs"), ascii_font)


def set_style_fonts(style, settings: dict[str, Any]) -> None:
    east_asia = settings.get("eastAsia", "宋体")
    ascii_font = settings.get("ascii", east_asia)
    style.font.name = ascii_font
    style.font.size = Pt(settings.get("sizePt", 12))
    if "bold" in settings:
        style.font.bold = settings["bold"]
    if "italic" in settings:
        style.font.italic = settings["italic"]
    if settings.get("color"):
        style.font.color.rgb = RGBColor.from_string(settings["color"].replace("#", ""))
    if "alignment" in settings:
        style.paragraph_format.alignment = {
            "left": WD_ALIGN_PARAGRAPH.LEFT,
            "center": WD_ALIGN_PARAGRAPH.CENTER,
            "right": WD_ALIGN_PARAGRAPH.RIGHT,
            "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
        }.get(settings["alignment"], WD_ALIGN_PARAGRAPH.LEFT)
    for key, attr in (("spaceBeforePt", "space_before"), ("spaceAfterPt", "space_after")):
        if key in settings:
            setattr(style.paragraph_format, attr, Pt(settings[key]))
    rpr = style._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.insert(0, rfonts)
    rfonts.set(qn("w:eastAsia"), east_asia)
    rfonts.set(qn("w:ascii"), ascii_font)
    rfonts.set(qn("w:hAnsi"), ascii_font)
    rfonts.set(qn("w:cs"), ascii_font)


def ensure_style(doc: Document, name: str, base: str = "Normal"):
    for existing in doc.styles:
        if existing.name == name:
            return existing
    style = doc.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
    style.base_style = doc.styles[base]
    return style


def set_cell_borders(cell, top: str | None = None, bottom: str | None = None) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge, value in (("top", top), ("bottom", bottom)):
        if value is None:
            continue
        element = borders.find(qn(f"w:{edge}"))
        if element is None:
            element = OxmlElement(f"w:{edge}")
            borders.append(element)
        element.set(qn("w:val"), value)
        element.set(qn("w:sz"), "8")
        element.set(qn("w:color"), "000000")


def set_cell_margins(cell, points: float) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    margins = tc_pr.first_child_found_in("w:tcMar")
    if margins is None:
        margins = OxmlElement("w:tcMar")
        tc_pr.append(margins)
    twips = str(max(0, round(points * 20)))
    for side in ("top", "start", "bottom", "end"):
        element = margins.find(qn(f"w:{side}"))
        if element is None:
            element = OxmlElement(f"w:{side}")
            margins.append(element)
        element.set(qn("w:w"), twips)
        element.set(qn("w:type"), "dxa")


def clear_cell_borders(cell) -> None:
    """Remove grid borders before applying the three-line table rules."""
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "bottom", "left", "right", "insideH", "insideV"):
        element = borders.find(qn(f"w:{edge}"))
        if element is None:
            element = OxmlElement(f"w:{edge}")
            borders.append(element)
        element.set(qn("w:val"), "nil")


def set_paragraph_shading(paragraph, fill: str) -> None:
    ppr = paragraph._p.get_or_add_pPr()
    shading = ppr.find(qn("w:shd"))
    if shading is None:
        shading = OxmlElement("w:shd")
        ppr.append(shading)
    shading.set(qn("w:val"), "clear")
    shading.set(qn("w:color"), "auto")
    shading.set(qn("w:fill"), fill.replace("#", "").upper())


def mark_repeating_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    header = OxmlElement("w:tblHeader")
    header.set(qn("w:val"), "true")
    tr_pr.append(header)


def _next_numbering_id(numbering, tag: str, attr: str) -> int:
    values = []
    for element in numbering.findall(qn(f"w:{tag}")):
        raw = element.get(qn(f"w:{attr}"))
        if raw is not None and raw.isdigit():
            values.append(int(raw))
    return max(values, default=-1) + 1


def apply_heading_numbering(doc: Document, start_at: int = 1) -> None:
    """Attach a real multilevel numbering definition to Heading 1-6.

    Pandoc's ``--number-sections`` is intentionally not used because it emits
    literal number runs.  This definition uses OOXML ``numPr`` so Word/WPS can
    renumber headings when a section is inserted.
    """
    numbering = doc.part.numbering_part.element
    abstract_id = _next_numbering_id(numbering, "abstractNum", "abstractNumId")
    num_id = _next_numbering_id(numbering, "num", "numId")

    abstract = OxmlElement("w:abstractNum")
    abstract.set(qn("w:abstractNumId"), str(abstract_id))
    multi = OxmlElement("w:multiLevelType")
    multi.set(qn("w:val"), "multilevel")
    abstract.append(multi)
    for level in range(6):
        lvl = OxmlElement("w:lvl")
        lvl.set(qn("w:ilvl"), str(level))
        start = OxmlElement("w:start")
        start.set(qn("w:val"), "1")
        lvl.append(start)
        fmt = OxmlElement("w:numFmt")
        fmt.set(qn("w:val"), "decimal")
        lvl.append(fmt)
        text = OxmlElement("w:lvlText")
        text.set(qn("w:val"), ".".join(f"%{i + 1}" for i in range(level + 1)))
        lvl.append(text)
        suff = OxmlElement("w:suff")
        suff.set(qn("w:val"), "tab")
        lvl.append(suff)
        jc = OxmlElement("w:lvlJc")
        jc.set(qn("w:val"), "left")
        lvl.append(jc)
        ppr = OxmlElement("w:pPr")
        ind = OxmlElement("w:ind")
        ind.set(qn("w:left"), str(720 * (level + 1)))
        ind.set(qn("w:hanging"), "360")
        ppr.append(ind)
        lvl.append(ppr)
        abstract.append(lvl)
    numbering.append(abstract)

    num = OxmlElement("w:num")
    num.set(qn("w:numId"), str(num_id))
    abstract_ref = OxmlElement("w:abstractNumId")
    abstract_ref.set(qn("w:val"), str(abstract_id))
    num.append(abstract_ref)
    numbering.append(num)

    start_level = max(0, min(5, int(start_at) - 1))
    for paragraph in doc.paragraphs:
        style_name = paragraph.style.name if paragraph.style else ""
        if not style_name.startswith("Heading "):
            continue
        try:
            level = int(style_name.split()[-1]) - 1
        except ValueError:
            continue
        if not 0 <= level < 6 or level < start_level:
            continue
        ppr = paragraph._p.get_or_add_pPr()
        old = ppr.find(qn("w:numPr"))
        if old is not None:
            ppr.remove(old)
        num_pr = OxmlElement("w:numPr")
        ilvl = OxmlElement("w:ilvl")
        ilvl.set(qn("w:val"), str(level - start_level))
        num_pr.append(ilvl)
        num_ref = OxmlElement("w:numId")
        num_ref.set(qn("w:val"), str(num_id))
        num_pr.append(num_ref)
        ppr.append(num_pr)


def _set_code_wrap(paragraph, enabled: bool) -> None:
    ppr = paragraph._p.get_or_add_pPr()
    element = ppr.find(qn("w:wordWrap"))
    if enabled:
        if element is not None:
            ppr.remove(element)
        return
    if element is None:
        element = OxmlElement("w:wordWrap")
        ppr.append(element)
    element.set(qn("w:val"), "0")


def _code_languages(markdown: str) -> list[str | None]:
    languages: list[str | None] = []
    fence: tuple[str, int] | None = None
    for line in markdown.splitlines():
        match = re.match(r"^\s*(`{3,}|~{3,})(.*)$", line)
        if not match:
            continue
        marker, info = match.group(1), match.group(2).strip()
        if fence is None:
            fence = (marker[0], len(marker))
            languages.append(info.split()[0] if info else None)
        elif marker[0] == fence[0] and len(marker) >= fence[1]:
            fence = None
    return languages


def style_document(path: Path, config: dict[str, Any], code_languages: list[str | None] | None = None) -> None:
    doc = Document(path)
    page = config["page"]
    for section in doc.sections:
        # The preset is a named starting point; explicit dimensions are the
        # final values so the width/height controls remain effective.
        dimensions = {"A4": (21.0, 29.7), "A5": (14.8, 21.0), "Letter": (21.59, 27.94)}
        preset_width, preset_height = dimensions.get(page.get("preset"), (21.0, 29.7))
        width_cm = page.get("widthCm", preset_width)
        height_cm = page.get("heightCm", preset_height)
        if page.get("orientation") == "landscape":
            width_cm, height_cm = height_cm, width_cm
        section.page_width = Cm(width_cm)
        section.page_height = Cm(height_cm)
        section.top_margin = Cm(page["topMarginCm"])
        section.bottom_margin = Cm(page["bottomMarginCm"])
        section.left_margin = Cm(page["leftMarginCm"])
        section.right_margin = Cm(page["rightMarginCm"])

    style_map = {
        "Normal": "normal",
        "Heading 1": "heading1",
        "Heading 2": "heading2",
        "Heading 3": "heading3",
        "Heading 4": "heading4",
        "Heading 5": "heading5",
        "Heading 6": "heading6",
        "Quote": "quote",
    }
    styles = config["styles"]

    for word_style, config_name in style_map.items():
        try:
            set_style_fonts(doc.styles[word_style], styles[config_name])
        except KeyError:
            pass
    code_style = ensure_style(doc, "Code Block")
    set_style_fonts(code_style, styles["codeBlock"])
    caption_style = ensure_style(doc, "Caption")
    set_style_fonts(caption_style, styles["caption"])

    code_index = 0
    for paragraph in doc.paragraphs:
        style_name = paragraph.style.name if paragraph.style else ""
        if style_name in {"Normal", "First Paragraph", "Body Text", "Text Body", "List Paragraph"}:
            settings = styles["normal"]
            paragraph.paragraph_format.line_spacing = settings.get("lineSpacing", 1.25)
            paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
            if settings.get("firstLineChars"):
                paragraph.paragraph_format.first_line_indent = Cm(settings["firstLineChars"] * 0.42)
            if settings.get("spaceBeforePt") is not None:
                paragraph.paragraph_format.space_before = Pt(settings["spaceBeforePt"])
            if settings.get("spaceAfterPt") is not None:
                paragraph.paragraph_format.space_after = Pt(settings["spaceAfterPt"])
            if settings.get("alignment"):
                paragraph.alignment = {"left": WD_ALIGN_PARAGRAPH.LEFT, "center": WD_ALIGN_PARAGRAPH.CENTER, "right": WD_ALIGN_PARAGRAPH.RIGHT, "justify": WD_ALIGN_PARAGRAPH.JUSTIFY}.get(settings["alignment"], WD_ALIGN_PARAGRAPH.LEFT)
        elif style_name.startswith("Heading "):
            level = style_name.split()[-1]
            settings = styles[f"heading{level}"]
            paragraph.paragraph_format.space_before = Pt(settings.get("spaceBeforePt", 0))
            paragraph.paragraph_format.space_after = Pt(settings.get("spaceAfterPt", 0))
        elif style_name.lower() in {"source code", "code block", "verbatim"}:
            paragraph.style = code_style
            code_settings = styles.get("codeBlock", {})
            _set_code_wrap(paragraph, bool(code_settings.get("wrap", True)))
            if code_settings.get("backgroundColor"):
                set_paragraph_shading(paragraph, code_settings["backgroundColor"])
            if code_settings.get("showLanguage") and code_languages:
                language = code_languages[code_index] if code_index < len(code_languages) else None
                if language and paragraph.runs:
                    paragraph.runs[0].text = f"[{language}]\n" + paragraph.runs[0].text
            code_index += 1
        elif style_name == "Quote":
            settings = styles["quote"]
            if settings.get("leftIndentCm"):
                paragraph.paragraph_format.left_indent = Cm(settings["leftIndentCm"])

        # Pandoc generally keeps image paragraphs as Normal. Center them and
        # recognize the common Chinese figure/table caption convention.
        if paragraph._p.xpath(".//w:drawing"):
            image_settings = config.get("options", {}).get("images", {})
            paragraph.alignment = {
                "left": WD_ALIGN_PARAGRAPH.LEFT,
                "center": WD_ALIGN_PARAGRAPH.CENTER,
                "right": WD_ALIGN_PARAGRAPH.RIGHT,
            }.get(image_settings.get("alignment", "center"), WD_ALIGN_PARAGRAPH.CENTER)
            paragraph.paragraph_format.first_line_indent = Cm(0)
        elif config.get("options", {}).get("images", {}).get("captionEnabled", True) and re.match(r"^(图|表)\s*\d+", paragraph.text.strip()):
            paragraph.style = caption_style
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            paragraph.paragraph_format.first_line_indent = Cm(0)

        active_style_name = paragraph.style.name if paragraph.style else "Normal"
        if active_style_name.startswith("Heading "):
            level = active_style_name.split()[-1]
            run_settings = styles[f"heading{level}"]
        elif active_style_name == "Quote":
            run_settings = styles["quote"]
        elif active_style_name == "Code Block":
            run_settings = styles["codeBlock"]
        elif active_style_name == "Caption":
            run_settings = styles["caption"]
        else:
            run_settings = styles["normal"]
        for run in paragraph.runs:
            # Keep Pandoc's inline bold/italic/link formatting, while making
            # the font family and size deterministic.
            set_run_fonts(
                run,
                run_settings.get("eastAsia", "宋体"),
                run_settings.get("ascii", "Times New Roman"),
                run_settings.get("sizePt", 12),
                run_settings.get("color", "000000"),
                bold=run_settings.get("bold"),
                italic=run_settings.get("italic"),
            )

    for table in doc.tables:
        table_settings = styles["table"]
        header_settings = styles["table"]
        table.alignment = {
            "left": WD_TABLE_ALIGNMENT.LEFT,
            "center": WD_TABLE_ALIGNMENT.CENTER,
            "right": WD_TABLE_ALIGNMENT.RIGHT,
        }.get(table_settings.get("alignment", "center"), WD_TABLE_ALIGNMENT.CENTER)
        try:
            table.style = "Table Grid"
        except KeyError:
            # Pandoc/reference documents are allowed not to contain the
            # optional built-in table style.  The explicit OOXML borders
            # below still give us a deterministic baseline.
            pass
        for row_index, row in enumerate(table.rows):
            if row_index == 0:
                mark_repeating_header(row)
            for cell in row.cells:
                cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                if table_settings.get("cellPaddingPt") is not None:
                    set_cell_margins(cell, table_settings["cellPaddingPt"])
                if table_settings.get("threeLine", True):
                    clear_cell_borders(cell)
                for paragraph in cell.paragraphs:
                    paragraph.paragraph_format.first_line_indent = Cm(0)
                    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    for run in paragraph.runs:
                        run_settings = header_settings if row_index == 0 else table_settings
                        set_run_fonts(
                            run,
                            run_settings.get("eastAsia", "宋体"),
                            run_settings.get("ascii", "Times New Roman"),
                            run_settings.get("sizePt", 10.5),
                            run_settings.get("color", "000000"),
                            bold=run_settings.get("bold"),
                            italic=run_settings.get("italic"),
                        )
                        if row_index == 0 and "headerBold" in header_settings:
                            run.font.bold = bool(header_settings["headerBold"])
                        if row_index == 0 and header_settings.get("headerColor"):
                            run.font.color.rgb = RGBColor.from_string(header_settings["headerColor"].replace("#", ""))
                # A simple three-line table baseline. This intentionally
                # avoids fixed row heights so long cells can expand.
                if table_settings.get("threeLine", True):
                    set_cell_borders(cell, top="single" if row_index == 0 else None, bottom="single" if row_index in {0, len(table.rows) - 1} else None)

    numbering = config.get("numbering", {})
    numbering_enabled = bool(numbering.get("enabled", True))
    if numbering_enabled:
        apply_heading_numbering(doc, numbering.get("startAt", 1))
    image_settings = config.get("options", {}).get("images", {})
    max_width_cm = image_settings.get("maxWidthCm", 0)
    if max_width_cm and max_width_cm > 0:
        for shape in doc.inline_shapes:
            if shape.width > Cm(max_width_cm):
                ratio = shape.height / shape.width
                shape.width = Cm(max_width_cm)
                if image_settings.get("keepRatio", True):
                    shape.height = int(shape.width * ratio)
    doc.save(path)


def count_docx_objects(path: Path) -> dict[str, int]:
    with zipfile.ZipFile(path) as archive:
        xml = archive.read("word/document.xml").decode("utf-8", errors="replace")
    return {
        "paragraphs": len(re.findall(r"<w:p(?:\s|>)", xml)),
        "tables": len(re.findall(r"<w:tbl(?:\s|>)", xml)),
        "images": xml.count("<a:blip "),
        "omml": len(re.findall(r"<m:oMath(?:\s|>)", xml)),
    }


def _conversion_event(callback: Callable[[dict[str, Any]], None] | None, event: str, stage: str, **payload: Any) -> None:
    if callback is None:
        return
    try:
        callback({"event": event, "stage": stage, **payload})
    except Exception:
        # Diagnostics must never change conversion behavior.
        return


def convert(source: Path, output: Path, config: dict[str, Any], on_event: Callable[[dict[str, Any]], None] | None = None, *, missing_images: str = "warning") -> list[WarningItem]:
    source = source.resolve()
    output = output.resolve()
    _conversion_event(on_event, "started", "queued", file=str(source))
    if not source.exists():
        raise CoreError("INPUT_NOT_FOUND", f"输入文件不存在：{source.name}", stage="preflight", category="input", suggestions=["检查 Markdown 文件路径是否正确。"])
    if source.suffix.lower() not in {".md", ".markdown"}:
        raise CoreError("INPUT_UNSUPPORTED", f"输入文件不是 Markdown：{source.name}", stage="preflight", category="input", suggestions=["选择 .md 或 .markdown 文件。"])
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise CoreError("OUTPUT_DIRECTORY_UNWRITABLE", str(error), stage="write-output", category="output", suggestions=["选择可写的输出目录。"], recoverable=True) from error
    if source == output:
        raise CoreError("OUTPUT_EQUALS_INPUT", "输出文件不能覆盖输入 Markdown。", stage="write-output", category="output")

    _conversion_event(on_event, "started", "preflight", file=str(source))
    try:
        warnings = [] if os.environ.get("MD2DOCX_SKIP_PREFLIGHT") == "1" and missing_images != "stop" else preflight(source)
    except UnicodeDecodeError as error:
        raise CoreError("INPUT_ENCODING", "Markdown 文件不是有效的 UTF-8 文本。", stage="preflight", category="input", line=getattr(error, "start", None), suggestions=["将 Markdown 文件保存为 UTF-8 编码。"]) from error
    missing = next((warning for warning in warnings if warning.kind == "missing-image"), None)
    if missing_images == "stop" and missing:
        raise CoreError("IMAGE_NOT_FOUND", missing.message, stage="preflight", category="input", line=missing.line, suggestions=["补齐图片文件或将图片缺失策略设为继续并警告。"], recoverable=True)
    _conversion_event(on_event, "completed", "preflight", file=str(source), warningCount=len(warnings))
    try:
        pandoc = find_pandoc()
    except (FileNotFoundError, RuntimeError) as error:
        raise CoreError("PANDOC_NOT_FOUND", str(error), stage="pandoc", category="environment", suggestions=["设置 MD2DOCX_PANDOC，或将 Pandoc 放入 runtime/pandoc。"]) from error
    input_path = source
    try:
        source_text = source.read_text(encoding="utf-8")
    except UnicodeDecodeError as error:
        raise CoreError("INPUT_ENCODING", "Markdown 文件不是有效的 UTF-8 文本。", stage="preflight", category="input", suggestions=["将 Markdown 文件保存为 UTF-8 编码。"], line=getattr(error, "start", None)) from error
    code_languages = _code_languages(source_text)
    temporary_input: Path | None = None
    temporary_output: Path | None = None
    numbering = config.get("numbering", {})
    strip_existing = bool(numbering.get("stripExisting", True))
    if strip_existing:
        try:
            original_text = source.read_text(encoding="utf-8")
        except UnicodeDecodeError as error:
            raise CoreError("INPUT_ENCODING", "Markdown 文件不是有效的 UTF-8 文本。", stage="preflight", category="input", suggestions=["将 Markdown 文件保存为 UTF-8 编码。"]) from error
        normalized_text = strip_heading_numbers(original_text)
        if normalized_text != original_text:
            with tempfile.NamedTemporaryFile("w", suffix=".md", prefix=".md2docx_", dir=output.parent, delete=False, encoding="utf-8", newline="") as handle:
                handle.write(normalized_text)
                temporary_input = Path(handle.name)
            input_path = temporary_input
    math_mode = config.get("options", {}).get("math", "omml")
    from_spec = "gfm+tex_math_dollars" if math_mode == "omml" else "gfm-tex_math_dollars"
    args = [pandoc, "--from", from_spec, "--to", "docx", "--resource-path", str(source.parent)]
    with tempfile.NamedTemporaryFile("wb", suffix=".docx", prefix=".md2docx_", dir=output.parent, delete=False) as handle:
        temporary_output = Path(handle.name)
    temporary_output.unlink(missing_ok=True)
    args.extend(["--output", str(temporary_output), str(input_path)])
    try:
        _conversion_event(on_event, "started", "pandoc", file=str(source))
        process = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
        math_fallback = config.get("options", {}).get("mathFallback", "warning")
        if process.returncode != 0 and math_mode == "omml" and math_fallback == "text":
            fallback_args = [pandoc, "--from", "gfm-tex_math_dollars", "--to", "docx", "--resource-path", str(source.parent), "--output", str(temporary_output), str(input_path)]
            process = subprocess.run(fallback_args, capture_output=True, text=True, encoding="utf-8", errors="replace")
            if process.returncode == 0:
                warnings.append(WarningItem("math-fallback", "公式转换失败，已保留为文本。", None, str(source)))
                _conversion_event(on_event, "warning", "pandoc", file=str(source), message="公式转换失败，已保留为文本。")
        if process.returncode != 0:
            detail = (process.stderr or process.stdout).strip()
            raise CoreError("PANDOC_CONVERSION_FAILED", f"Pandoc 转换失败：{detail}", stage="pandoc", category="conversion", suggestions=["检查 Markdown 语法、图片路径和 Pandoc 版本。"], recoverable=True)
        if process.stderr.strip():
            warnings.append(WarningItem("pandoc", process.stderr.strip(), None, str(source)))
            _conversion_event(on_event, "warning", "pandoc", file=str(source), message=process.stderr.strip())
        _conversion_event(on_event, "completed", "pandoc", file=str(source))

        _conversion_event(on_event, "started", "postprocess", file=str(source))
        try:
            style_document(temporary_output, config, code_languages)
        except Exception as error:
            raise CoreError("DOCX_POSTPROCESS_FAILED", str(error), stage="postprocess", category="conversion", suggestions=["检查配置中的字体、页面和样式数值。"], recoverable=True) from error
        _conversion_event(on_event, "completed", "postprocess", file=str(source))
        _conversion_event(on_event, "started", "validate", file=str(source))
        try:
            validation = count_docx_objects(temporary_output)
        except Exception as error:
            raise CoreError("DOCX_VALIDATION_FAILED", str(error), stage="validate", category="output", suggestions=["检查 Pandoc 输出和临时文件是否完整。"], recoverable=True) from error
        _conversion_event(on_event, "completed", "validate", file=str(source), **validation)
        _conversion_event(on_event, "started", "write-output", file=str(source))
        try:
            os.replace(temporary_output, output)
        except OSError as error:
            raise CoreError("OUTPUT_WRITE_FAILED", str(error), stage="write-output", category="output", suggestions=["检查输出目录权限，或关闭占用目标 DOCX 的程序。"], recoverable=True) from error
        temporary_output = None
        _conversion_event(on_event, "completed", "write-output", file=str(source))
        _conversion_event(on_event, "completed", "completed", file=str(source))
        return warnings
    finally:
        if temporary_input is not None:
            temporary_input.unlink(missing_ok=True)
        if temporary_output is not None:
            temporary_output.unlink(missing_ok=True)
