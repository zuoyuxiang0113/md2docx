from dataclasses import dataclass, field
import os
from pathlib import Path
import sys


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("MD2DOCX_DATA_DIR", "server/data")).resolve())
    runtime: Path = field(default_factory=lambda: Path(sys.prefix).resolve())
    project: Path = field(default_factory=lambda: Path(__file__).resolve().parents[1])
    max_request_bytes: int = 20 * 1024 * 1024
    max_markdown_bytes: int = 2 * 1024 * 1024
    max_image_bytes: int = 5 * 1024 * 1024
    max_image_pixels: int = 16_000_000
    max_documents: int = 10
    max_resources: int = 50
    max_queue: int = 8
    max_active_per_session: int = 2
    max_jobs: int = 2000
    max_sessions: int = 5000
    max_storage_bytes: int = 512 * 1024 * 1024
    min_free_bytes: int = 256 * 1024 * 1024
    file_timeout: float = 60
    job_timeout: float = 180
    queue_timeout: float = 300
    retention_seconds: int = 86400
    session_seconds: int = 172800
    process_memory_bytes: int = 1024 * 1024 * 1024
    max_output_bytes: int = 20 * 1024 * 1024
    max_stream_bytes: int = 2 * 1024 * 1024
    upload_timeout: float = 30
    cookie_secure: bool = True
    origins: tuple[str, ...] = ("http://localhost:8000", "http://127.0.0.1:8000")
    docs: bool = False
    worker_enabled: bool = True

    @classmethod
    def from_env(cls):
        values = {}
        for name in cls.__dataclass_fields__:
            key = "MD2DOCX_" + name.upper()
            if name in {"data_dir", "runtime", "project", "origins"} or key not in os.environ:
                continue
            default = cls.__dataclass_fields__[name].default
            if isinstance(default, bool):
                values[name] = os.environ[key].lower() in {"1", "true", "yes"}
            elif isinstance(default, int):
                values[name] = int(os.environ[key])
            elif isinstance(default, float):
                values[name] = float(os.environ[key])
        if "MD2DOCX_ORIGINS" in os.environ:
            values["origins"] = tuple(x.strip().rstrip("/") for x in os.environ["MD2DOCX_ORIGINS"].split(",") if x.strip())
        result = cls(**values)
        if any(x <= 0 for x in vars(result).values() if isinstance(x, (int, float)) and not isinstance(x, bool)):
            raise ValueError("Server limits must be positive")
        if "*" in result.origins:
            raise ValueError("Credentialed CORS requires explicit origins")
        return result
