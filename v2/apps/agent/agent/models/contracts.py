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
    status: RunStatus
    startedAt: str
    finishedAt: str | None = None
    events: list[RunEvent] = Field(default_factory=list)


class RunOptions(BaseModel):
    maxSteps: int = 1000
    defaultTimeoutMs: int = 5_000
    defaultMaxRetries: int = 0
    breakpointNodeIds: list[str] = Field(default_factory=list)
    pauseAfterEachNode: bool = False


class PickerSelectorCandidate(BaseModel):
    type: PickerSelectorType
    value: str
    score: float = 0.5
    primary: bool = False


class PickerFrameSegment(BaseModel):
    index: int = -1
    hint: str = ""
    tag: str | None = None
    name: str | None = None
    id: str | None = None
    idStable: bool | None = None
    src: str | None = None
    srcHostPath: str | None = None
    srcStableFragment: str | None = None
    frameBorder: str | None = None
    selector: str | None = None
    crossOrigin: bool = False
    attrHints: dict[str, str] = Field(default_factory=dict)


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


def ensure_flow_model(flow: FlowModel | dict[str, Any]) -> FlowModel:
    if isinstance(flow, FlowModel):
        return flow
    return FlowModel.model_validate(flow)


def now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()

