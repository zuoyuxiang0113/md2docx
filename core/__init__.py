"""MD2DOCX conversion core package."""

from .config_schema import DEFAULT_CONFIG, SCHEMA_VERSION, load_config, normalize_config, save_config
from .result_model import ConversionItem, ConversionResult, WarningItem
from .error_model import CoreError, ErrorItem
from .logging_utils import JsonlLogger, default_log_dir, new_job_id

__all__ = [
    "DEFAULT_CONFIG", "SCHEMA_VERSION", "load_config", "normalize_config", "save_config",
    "ConversionItem", "ConversionResult", "WarningItem", "CoreError", "ErrorItem", "JsonlLogger", "default_log_dir", "new_job_id",
]
