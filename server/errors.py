"""Public errors never expose converter stdout, stack traces or host paths."""
class ApiError(Exception):
    def __init__(self, status, code, message, *, fields=None, retry_after=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields or []
        self.retry_after = retry_after


def invalid(path, message):
    raise ApiError(422, "INPUT_INVALID", message, fields=[{"path": path, "message": message}])


# ADR-009：诊断原因分类。只用于服务端日志与私有记录，不进入公开响应。
REASONS = {
    "SANDBOX_UNAVAILABLE": "sandbox-unavailable",
    "SPAWN_FAILED": "spawn-failed",
    "RLIMIT_MEMORY": "rlimit-memory",
    "RLIMIT_CPU": "rlimit-cpu",
    "RLIMIT_FSIZE": "rlimit-filesize",
    "RLIMIT_NPROC": "rlimit-nproc",
    "FILE_TIMEOUT": "timeout-wall",
    "CONVERTER_OUTPUT_LIMIT": "output-limit",
    "CONVERTER_FAILED": "stdout-not-json",
    "CANCELLED": "cancelled",
}


def scrub(text, limit=2048):
    """脱敏：截断长度，去掉疑似主机路径与会话凭证。"""
    import re
    if not isinstance(text, str):
        return ""
    value = text[:limit]
    # 绝对路径只保留末段，避免泄露宿主机目录结构。
    value = re.sub(r"(?<![\w.])/(?:[\w.\-]+/)+([\w.\-]+)", r"<path>/\1", value)
    value = re.sub(r"(?i)(bearer\s+)[\w.\-]+", r"\1<redacted>", value)
    value = re.sub(r"(?i)(token|secret|password|authorization)\s*[=:]\s*\S+", r"\1=<redacted>", value)
    return value
