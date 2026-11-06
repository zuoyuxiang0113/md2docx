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
