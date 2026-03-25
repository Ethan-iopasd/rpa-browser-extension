from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field


FLOW_SCHEMA_VERSION = "1.0.0"
NodeType = Literal[
    "start",
    "end",
    "navigate",
    "click",
    "input",
    "wait",
    "extract",
    "if",
    "loop",
    "hover",
    "scroll",
    "select",
    "upload",
    "pressKey",
    "doubleClick",
    "rightClick",
    "switchFrame",
    "switchTab",
    "screenshot",
    "assertText",
    "assertVisible",
    "assertUrl",
    "assertCount",
    "setVariable",
    "templateRender",
    "jsonParse",
    "regexExtract",
    "tableExtract",
    "rowLocate",
    "waitForVisible",
    "waitForClickable",
    "waitForNetworkIdle",
    "waitForText",
    "tryCatch",
    "switchCase",
    "parallel",
    "break",
    "continue",
    "httpRequest",
    "webhook",
    "dbQuery",
    "notify",
    "subflow",
]
RunStatus = Literal["pending", "running", "success", "failed", "canceled"]
RunEventLevel = Literal["debug", "info", "warn", "error"]
FlowVariableValue = str | int | float | bool | None
TaskType = Literal["manual", "scheduled", "batch"]
TaskStatus = Literal["active", "paused", "disabled"]
TaskTriggerType = Literal["manual", "scheduled", "batch", "retry"]
WeekdayName = Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
ScheduleMode = Literal["manual", "once", "interval", "daily", "weekly", "monthly", "cron"]
LogExportFormat = Literal["jsonl", "csv"]
AlertLevel = Literal["info", "warn", "error"]
PickerSelectorType = Literal["css", "xpath", "text", "role", "playwright"]
PickerSessionStatus = Literal["pending", "running", "succeeded", "failed", "cancelled"]


class FlowNode(BaseModel):
    id: str
    type: NodeType
    label: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)


class FlowEdge(BaseModel):
    id: str
    source: str
    target: str
    condition: str | None = None


class FlowModel(BaseModel):
    schemaVersion: str = FLOW_SCHEMA_VERSION
    id: str
    name: str
    variables: dict[str, FlowVariableValue] = Field(default_factory=dict)
    nodes: list[FlowNode]
    edges: list[FlowEdge]


class ValidateResponse(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)


class ApiError(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
    requestId: str


class RunEvent(BaseModel):
    eventId: str
    timestamp: str
    runId: str
    nodeId: str
    nodeType: NodeType
    level: RunEventLevel = "info"
    message: str
    durationMs: int | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class RunResult(BaseModel):
    runId: str
    flowId: str
    flowSnapshot: FlowModel | None = None
    status: RunStatus
    startedAt: str
    finishedAt: str | None = None
    events: list[RunEvent] = Field(default_factory=list)
    taskId: str | None = None
    triggerType: TaskTriggerType | None = None
    attempt: int = 0


class RunOptions(BaseModel):
    maxSteps: int = 1000
    defaultTimeoutMs: int = 5_000
    defaultMaxRetries: int = 0
    breakpointNodeIds: list[str] = Field(default_factory=list)
    pauseAfterEachNode: bool = False


class StartRunRequest(BaseModel):
    flow: FlowModel
    runOptions: RunOptions | None = None
    inputVariables: dict[str, FlowVariableValue] | None = None


class RunEventsResponse(BaseModel):
    runId: str
    total: int = 0
    limit: int = 100
    offset: int = 0
    events: list[RunEvent] = Field(default_factory=list)


class RetryPolicy(BaseModel):
    maxRetries: int = 0
    retryDelayMs: int = 0


class TaskSchedule(BaseModel):
    mode: ScheduleMode = "manual"
    runAt: str | None = None
    intervalSeconds: int | None = None
    timezone: str | None = None
    timeOfDay: str | None = None
    weekdays: list[WeekdayName] = Field(default_factory=list)
    dayOfMonth: int | None = None
    cronExpr: str | None = None


class TaskDefinition(BaseModel):
    taskId: str
    name: str
    type: TaskType
    status: TaskStatus = "active"
    flow: FlowModel | None = None
    batchFlows: list[FlowModel] = Field(default_factory=list)
    schedule: TaskSchedule = Field(default_factory=TaskSchedule)
    runOptions: RunOptions | None = None
    retryPolicy: RetryPolicy = Field(default_factory=RetryPolicy)
    tags: list[str] = Field(default_factory=list)
    createdAt: str
    updatedAt: str
    nextRunAt: str | None = None
    lastRunAt: str | None = None
    lastRunStatus: RunStatus | None = None
    lastRunId: str | None = None


class CreateTaskRequest(BaseModel):
    name: str
    type: TaskType
    flow: FlowModel | None = None
    batchFlows: list[FlowModel] = Field(default_factory=list)
    schedule: TaskSchedule | None = None
    runOptions: RunOptions | None = None
    retryPolicy: RetryPolicy | None = None
    tags: list[str] = Field(default_factory=list)


class UpdateTaskRequest(BaseModel):
    name: str | None = None
    status: TaskStatus | None = None
    flow: FlowModel | None = None
    batchFlows: list[FlowModel] | None = None
    schedule: TaskSchedule | None = None
    runOptions: RunOptions | None = None
    retryPolicy: RetryPolicy | None = None
    tags: list[str] | None = None


class TaskTriggerResponse(BaseModel):
    taskId: str
    queuedRuns: int
    message: str


class TaskListResponse(BaseModel):
    total: int
    tasks: list[TaskDefinition] = Field(default_factory=list)


class SchedulePreviewRequest(BaseModel):
    schedule: TaskSchedule
    count: int = 5
    fromAt: str | None = None


class SchedulePreviewResponse(BaseModel):
    total: int
    nextRuns: list[str] = Field(default_factory=list)


class RunListResponse(BaseModel):
    total: int
    runs: list[RunResult] = Field(default_factory=list)


class RunStatsResponse(BaseModel):
    totalRuns: int
    successRuns: int
    failedRuns: int
    canceledRuns: int
    avgDurationMs: int
    p95DurationMs: int
    failureByCode: dict[str, int] = Field(default_factory=dict)
    byStatus: dict[str, int] = Field(default_factory=dict)


class AlertRecord(BaseModel):
    alertId: str
    level: AlertLevel
    message: str
    createdAt: str
    data: dict[str, Any] = Field(default_factory=dict)


class AlertsResponse(BaseModel):
    total: int
    alerts: list[AlertRecord] = Field(default_factory=list)


class ExportedRunLogs(BaseModel):
    runId: str
    format: LogExportFormat
    fileName: str
    content: str


class CredentialsCreateRequest(BaseModel):
    name: str
    value: str
    description: str | None = None


class CredentialSummary(BaseModel):
    credentialId: str
    name: str
    description: str | None = None
    createdAt: str
    updatedAt: str


class CredentialListResponse(BaseModel):
    total: int
    credentials: list[CredentialSummary] = Field(default_factory=list)


class CredentialSecretResponse(BaseModel):
    credentialId: str
    name: str
    value: str
    updatedAt: str


class AuditRecord(BaseModel):
    auditId: str
    action: str
    actor: str
    target: str
    timestamp: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class AuditListResponse(BaseModel):
    total: int
    records: list[AuditRecord] = Field(default_factory=list)


class PickerSelectorCandidate(BaseModel):
    type: PickerSelectorType
    value: str
    score: float = 0.5
    primary: bool = False


class PickerFrameSegment(BaseModel):
    index: int = -1
    hint: str = ""
    name: str | None = None
    id: str | None = None
    src: str | None = None
    selector: str | None = None
    crossOrigin: bool = False


class PickerFrameLocatorSegment(BaseModel):
    depth: int = 0
    hint: str = ""
    crossOrigin: bool = False
    index: int = -1
    primary: str | None = None
    selectorCandidates: list[PickerSelectorCandidate] = Field(default_factory=list)


class PickerResult(BaseModel):
    selector: str
    selectorType: PickerSelectorType = "css"
    selectorCandidates: list[PickerSelectorCandidate] = Field(default_factory=list)
    playwrightPrimary: PickerSelectorCandidate | None = None
    playwrightCandidates: list[PickerSelectorCandidate] = Field(default_factory=list)
    frameLocatorChain: list[PickerFrameLocatorSegment] = Field(default_factory=list)
    pageUrl: str | None = None
    framePath: list[PickerFrameSegment] = Field(default_factory=list)
    framePathString: str | None = None
    elementMeta: dict[str, Any] = Field(default_factory=dict)


class StartPickerSessionRequest(BaseModel):
    url: str
    timeoutMs: int = 180_000
    headless: bool = False


class PickerSession(BaseModel):
    sessionId: str
    status: PickerSessionStatus = "pending"
    url: str
    timeoutMs: int
    headless: bool = False
    createdAt: str
    startedAt: str | None = None
    finishedAt: str | None = None
    result: PickerResult | None = None
    errorCode: str | None = None
    errorMessage: str | None = None
    diagnostics: dict[str, Any] = Field(default_factory=dict)


def now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def duration_ms(started_at: str, finished_at: str | None) -> int | None:
    start = parse_iso(started_at)
    end = parse_iso(finished_at)
    if start is None or end is None:
        return None
    return max(int((end - start).total_seconds() * 1000), 0)

