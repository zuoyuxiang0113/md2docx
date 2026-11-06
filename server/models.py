from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ConfigChoice(StrictModel):
    preset: Literal["default"] | None = None
    profile: dict[str, Any] | None = None

    @model_validator(mode="after")
    def exactly_one(self):
        if (self.preset is None) == (self.profile is None):
            raise ValueError("Provide exactly one of preset and profile")
        return self


class ConfigRequest(StrictModel):
    config: ConfigChoice


class Execution(StrictModel):
    missingImages: Literal["warning", "stop"] = "warning"
    batchErrors: Literal["continue", "stop"] = "continue"


class Document(StrictModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    path: str = Field(min_length=1, max_length=240)
    content: str | None = None
    part: str | None = Field(default=None, pattern=r"^[a-zA-Z0-9_-]{1,64}$")

    @model_validator(mode="after")
    def exactly_one(self):
        if (self.content is None) == (self.part is None):
            raise ValueError("Provide exactly one of content and part")
        return self


class Resource(StrictModel):
    path: str = Field(min_length=1, max_length=240)
    part: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")


class Submission(StrictModel):
    documents: list[Document] = Field(min_length=1, max_length=100)
    resources: list[Resource] = Field(default_factory=list, max_length=100)
    config: ConfigChoice = Field(default_factory=lambda: ConfigChoice(preset="default"))
    execution: Execution = Field(default_factory=Execution)


class ArtifactView(StrictModel):
    id: str
    filename: str
    sizeBytes: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class ItemView(StrictModel):
    documentId: str
    path: str
    status: Literal["pending", "running", "succeeded", "failed", "skipped", "unprocessed"]
    stage: str | None
    warnings: list[dict[str, Any]]
    error: dict[str, Any] | None
    artifact: ArtifactView | None
    objects: dict[str, int] | None = None
    durationMs: int | None = None


class Summary(StrictModel):
    total: int = Field(ge=0)
    succeeded: int = Field(ge=0)
    failed: int = Field(ge=0)
    skipped: int = Field(ge=0)
    pending: int = Field(ge=0)
    running: int = Field(ge=0)
    unprocessed: int = Field(ge=0)

    @model_validator(mode="after")
    def count(self):
        if sum(v for k,v in self.model_dump().items() if k != "total") != self.total:
            raise ValueError("Task counters are inconsistent")
        return self


class SessionInfo(StrictModel):
    accessToken: str
    expiresAt: str
    type: Literal["temporary-session"]


class JobView(StrictModel):
    jobId: str
    status: Literal["queued", "running", "cancelling", "succeeded", "partially_succeeded", "failed", "cancelled", "timed_out"]
    createdAt: str
    startedAt: str | None
    finishedAt: str | None
    expiresAt: str | None
    engine: dict[str, str]
    config: dict[str, Any]
    items: list[ItemView]
    error: dict[str, Any] | None
    summary: Summary
    session: SessionInfo | None = None


class JobEnvelope(StrictModel):
    success: Literal[True]
    data: JobView
    requestId: str


class SessionEnvelope(StrictModel):
    success: Literal[True]
    data: SessionInfo
    requestId: str


class PublicError(StrictModel):
    code: str
    message: str
    fields: list[dict[str, str]]
    retryable: bool


class ErrorEnvelope(StrictModel):
    success: Literal[False]
    error: PublicError
    requestId: str
