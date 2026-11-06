import hashlib
import io
import json
import math
from pathlib import PurePosixPath
import re
import unicodedata
import warnings
from PIL import Image
from core.config_schema import DEFAULT_CONFIG, normalize_config
from .errors import ApiError, invalid


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def digest(value):
    return "sha256:" + hashlib.sha256(canonical(value).encode()).hexdigest()


def path_name(value):
    value = unicodedata.normalize("NFC", value)
    if len(value.encode("utf-8")) > 640 or any(ord(c) < 32 or ord(c) == 127 for c in value):
        invalid("path", "文件路径过长或含控制字符。")
    if value.startswith("/") or "\\" in value or ":" in value or any(x in {"", ".", ".."} for x in value.split("/")):
        invalid("path", "只允许任务内的相对文件路径。")
    return PurePosixPath(value).as_posix()


def effective_config(choice):
    raw = choice.profile if choice.profile is not None else {"schemaVersion": 2}
    if type(raw.get("schemaVersion")) is not int or raw["schemaVersion"] != 2:
        invalid("config.profile.schemaVersion", "schemaVersion 必须是整数 2。")

    def check(value, defaults, path):
        if not isinstance(value, dict):
            invalid(path, "配置分组必须为对象。")
        for key, item in value.items():
            here = f"{path}.{key}"
            if key not in defaults:
                invalid(here, "未知或已废弃的配置字段。")
            expected = defaults[key]
            if key == "updatedAt" and item is not None and not isinstance(item, str):
                invalid(here, "updatedAt 必须为字符串或 null。")
            if isinstance(expected, dict):
                check(item, expected, here)
            elif isinstance(expected, bool):
                if type(item) is not bool:
                    invalid(here, "必须为布尔值。")
            elif isinstance(expected, (float, int)):
                if type(item) not in (int, float) or not math.isfinite(item):
                    invalid(here, "必须为有限数值。")
                if abs(item) > 10000:
                    invalid(here, "数值超过允许范围。")
            elif expected is not None and not isinstance(item, str):
                invalid(here, "必须为字符串。")
            if isinstance(item, str) and (len(item) > 256 or any(ord(c) < 32 for c in item)):
                invalid(here, "配置文字过长或含控制字符。")
            if key in {"color", "headerColor", "backgroundColor"} and not re.fullmatch(r"#?[0-9a-fA-F]{6}", str(item)):
                invalid(here, "颜色必须为六位 RGB 十六进制。")
            if key == "sizePt" and not 1 <= item <= 200:
                invalid(here, "字号必须在 1—200 pt 之间。")
            if key == "lineSpacing" and not 0 < item <= 10:
                invalid(here, "行距必须大于 0 且不超过 10。")
    check(raw, DEFAULT_CONFIG, "config.profile")
    try:
        config = normalize_config(raw)
    except (ValueError, TypeError, OverflowError):
        invalid("config", "配置字段类型、枚举或范围不合法。")
    page = config["page"]
    w, h = page["widthCm"], page["heightCm"]
    if page["orientation"] == "landscape":
        w, h = h, w
    if not 5 <= w <= 120 or not 5 <= h <= 120:
        invalid("config.profile.page", "页面宽高必须在 5—120 cm 之间。")
    if page["leftMarginCm"] + page["rightMarginCm"] >= w - 1 or page["topMarginCm"] + page["bottomMarginCm"] >= h - 1:
        invalid("config.profile.page", "页边距必须保留至少 1 cm 的正文区域。")
    notes = []
    if config["numbering"]["stripExisting"]:
        notes.append({"code": "HEADING_NUMBER_REMOVAL_ENABLED", "message": "配置启用了已有标题数字清理，可能影响年份等数字；保留原文请设 stripExisting=false。", "line": None})
    stable = {k: v for k, v in config.items() if k != "updatedAt"}
    return config, digest(stable), notes


def checked_image(data, path, settings):
    if not data or len(data) > settings.max_image_bytes:
        raise ApiError(413, "PAYLOAD_TOO_LARGE", "图片为空或超过大小限制。")
    suffix = PurePosixPath(path).suffix.lower()
    expected = {".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG"}.get(suffix)
    if expected is None:
        invalid("resources.path", "只支持 PNG/JPEG 图片。")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format != expected or image.width * image.height > settings.max_image_pixels or getattr(image, "n_frames", 1) != 1:
                    invalid("resources", "图片格式、尺寸或帧数不受支持。")
                image.verify()
            with Image.open(io.BytesIO(data)) as image:
                image.load()
                # Re-encode pixels: remove appended payloads and unneeded metadata.
                image = image.convert("RGB" if expected == "JPEG" else "RGBA")
                output = io.BytesIO()
                image.save(output, format=expected)
                result = output.getvalue()
        if len(result) > settings.max_image_bytes:
            raise ApiError(413, "PAYLOAD_TOO_LARGE", "解码后的图片超过限制。")
        return result
    except ApiError:
        raise
    except Exception:
        invalid("resources", "图片损坏或无法安全解码。")
