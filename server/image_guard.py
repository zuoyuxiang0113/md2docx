"""Decode and re-encode untrusted images INSIDE the Bubblewrap namespace."""
import json
from pathlib import Path
import sys
from types import SimpleNamespace
from .errors import ApiError
from .validation import checked_image


def main():
    request = json.loads(sys.argv[1])
    limits = SimpleNamespace(**request)
    root = Path("/inputs")
    total = sum(p.stat().st_size for p in root.rglob("*") if p.is_file())
    try:
        for name in request["resources"]:
            path = root / name
            raw = path.read_bytes()
            content = checked_image(raw, name, limits)
            total += len(content) - len(raw)
            if total > limits.max_request_bytes:
                raise ApiError(413, "PAYLOAD_TOO_LARGE", "图片解码后超过总量限制。")
            path.write_bytes(content)
        print(json.dumps({"success": True, "items": [{"success": True}]}))
    except ApiError as error:
        print(json.dumps({"success": False, "errors": [{"code": error.code}]}))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
