from __future__ import annotations

import csv
import importlib
import io
import json
from typing import Any
from uuid import uuid4

from app.core.config import settings
from app.core.error_codes import (
    AGENT_RUNTIME_UNAVAILABLE,
    FLOW_VALIDATION_FAILED,
    RUN_EXPORT_INVALID,
    RUN_NOT_FOUND,
)
from app.core.errors import raise_api_error
from app.repositories.run_repository import run_repository
from app.schemas.contracts import (
    AlertRecord,
    AlertsResponse,
    ExportedRunLogs,
    FlowModel,
    RunEventsResponse,
    RunOptions,
    RunResult,
    RunStatsResponse,
    StartRunRequest,
    TaskTriggerType,
    ValidateResponse,
)
from app.services.flow_migration import FlowMigrationError, migrate_flow_model
from app.services.flow_validation import validate_flow_model
from app.services.security_service import sanitize_run_result
from app.core.run_broadcaster import run_broadcaster

SELECTOR_TYPES = {"css", "xpath", "text", "role", "playwright"}


def _is_xpath_literal(value: str) -> bool:
    token = value.strip()
    return token.startswith("//") or token.startswith(".//") or token.startswith("(/")


def _normalize_selector_type_and_value(raw_type: Any, raw_value: str) -> tuple[str, str]:
    value = raw_value.strip()
    lowered = value.lower()

    if lowered.startswith("xpath="):
        body = value[len("xpath=") :].strip()
        return "xpath", f"xpath={body}" if body else "xpath="
    if lowered.startswith("text="):
        body = value[len("text=") :].strip()
        return "text", f"text={body}" if body else "text="
    if lowered.startswith("role="):
        body = value[len("role=") :].strip()
        return "role", f"role={body}" if body else "role="
    if lowered.startswith("css="):
        return "css", value[len("css=") :].strip()
    if _is_xpath_literal(value):
        return "xpath", f"xpath={value}"

    selector_type = raw_type.strip().lower() if isinstance(raw_type, str) else ""
    if selector_type == "xpath":
        # Downgrade invalid xpath config to css so validation can pass safely.
        return "css", value
    if selector_type in {"text", "role"}:
        return selector_type, f"{selector_type}={value}"
    if selector_type == "playwright":
        return "playwright", value
    return "css", value


def _normalize_selector_candidates(raw_candidates: Any) -> tuple[Any, bool]:
    if not isinstance(raw_candidates, list):
        return raw_candidates, False
    changed = False
    normalized: list[Any] = []
    for item in raw_candidates:
        if isinstance(item, str):
            _, next_value = _normalize_selector_type_and_value(None, item)
            if next_value != item:
                changed = True
            normalized.append(next_value)
            continue
        if not isinstance(item, dict):
            normalized.append(item)
            continue
        value = item.get("value")
        if not isinstance(value, str) or not value.strip():
            normalized.append(item)
            continue
        next_type, next_value = _normalize_selector_type_and_value(item.get("type"), value)
        next_item = dict(item)
        if next_value != value:
            next_item["value"] = next_value
            changed = True
        item_type = item.get("type")
        if isinstance(item_type, str):
            normalized_type = item_type.strip().lower()
            if normalized_type in SELECTOR_TYPES and normalized_type != next_type:
                next_item["type"] = next_type
                changed = True
        normalized.append(next_item)
    return normalized, changed


def _normalize_node_config(config: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    next_config = dict(config)
    changed = False

    selector = next_config.get("selector")
    if isinstance(selector, str) and selector.strip():
        next_type, next_selector = _normalize_selector_type_and_value(next_config.get("selectorType"), selector)
        if next_selector != selector:
            next_config["selector"] = next_selector
            changed = True
        selector_type = next_config.get("selectorType")
        if selector_type != next_type:
            next_config["selectorType"] = next_type
            changed = True

    selector_candidates, candidates_changed = _normalize_selector_candidates(next_config.get("selectorCandidates"))
    if candidates_changed:
        next_config["selectorCandidates"] = selector_candidates
        changed = True

    return next_config, changed


def _normalize_flow_selectors(flow: FlowModel) -> FlowModel:
    changed = False
    next_nodes = []
    for node in flow.nodes:
        next_config, config_changed = _normalize_node_config(node.config)
        if config_changed:
            changed = True
            next_nodes.append(node.model_copy(update={"config": next_config}))
        else:
            next_nodes.append(node)
    if not changed:
        return flow
    return flow.model_copy(update={"nodes": next_nodes})


def validate_flow(flow: FlowModel) -> ValidateResponse:
    try:
        migrated_flow = migrate_flow_model(flow)
    except FlowMigrationError as exc:
        return ValidateResponse(valid=False, errors=[exc.message])
    normalized_flow = _normalize_flow_selectors(migrated_flow)
    errors = validate_flow_model(normalized_flow)
    return ValidateResponse(valid=len(errors) == 0, errors=errors)


def _run_with_agent(flow: FlowModel, run_options: RunOptions | None) -> RunResult:
    try:
        agent_contracts = importlib.import_module("agent.models.contracts")
        agent_engine = importlib.import_module("agent.runtime.engine")
    except ModuleNotFoundError:
        raise_api_error(
            status_code=500,
            code=AGENT_RUNTIME_UNAVAILABLE,
            message="Agent runtime is not installed in current environment.",
            details={"hint": "Install editable package: .\\apps\\agent[dev]"},
        )
    agent_run_options_cls = getattr(agent_contracts, "RunOptions")
    agent_run_flow = getattr(agent_engine, "run_flow")
    options = None
    if run_options is not None:
        options = agent_run_options_cls(
            maxSteps=run_options.maxSteps,
            defaultTimeoutMs=run_options.defaultTimeoutMs,
            defaultMaxRetries=run_options.defaultMaxRetries,
            breakpointNodeIds=run_options.breakpointNodeIds,
            pauseAfterEachNode=run_options.pauseAfterEachNode,
        )
    agent_result = agent_run_flow(flow.model_dump(), options=options)
    payload: dict[str, Any] = agent_result.model_dump()
    return RunResult.model_validate(payload)


def execute_flow(
    flow: FlowModel,
    *,
    run_options: RunOptions | None = None,
    task_id: str | None = None,
    trigger_type: TaskTriggerType = "manual",
    attempt: int = 0,
) -> RunResult:
    try:
        migrated_flow = migrate_flow_model(flow)
    except FlowMigrationError as exc:
        raise_api_error(
            status_code=400,
            code=exc.code,
            message=exc.message,
            details=exc.details,
        )

    normalized_flow = _normalize_flow_selectors(migrated_flow)
    errors = validate_flow_model(normalized_flow)
    if errors:
        raise_api_error(
            status_code=400,
            code=FLOW_VALIDATION_FAILED,
            message="Flow validation failed before run.",
            details={"errors": errors},
        )

    result = _run_with_agent(normalized_flow, run_options)
    normalized = RunResult(
        runId=result.runId,
        flowId=result.flowId,
        flowSnapshot=normalized_flow,
        status=result.status,
        startedAt=result.startedAt,
        finishedAt=result.finishedAt,
        events=result.events,
        taskId=task_id,
        triggerType=trigger_type,
        attempt=attempt,
    )
    sanitized = sanitize_run_result(normalized)
    run_repository.save(sanitized)
    # 向所有等待该 run 的 WebSocket 订阅者推送完整事件列表
    run_broadcaster.broadcast_run_done(
        sanitized.runId,
        [evt.model_dump() for evt in sanitized.events],
    )
    return sanitized


def start_run(payload: StartRunRequest) -> RunResult:
    flow = payload.flow
    if payload.inputVariables:
        flow = flow.model_copy(
            update={
                "variables": {
                    **flow.variables,
                    **payload.inputVariables,
                }
            }
        )
    return execute_flow(flow, run_options=payload.runOptions, trigger_type="manual")


def get_run(run_id: str) -> RunResult:
    result = run_repository.get(run_id)
    if result is None:
        raise_api_error(
            status_code=404,
            code=RUN_NOT_FOUND,
            message=f"Run not found: {run_id}",
            details={"runId": run_id},
        )
    return result


def list_runs(
    *,
    status: str | None = None,
    task_id: str | None = None,
    flow_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[int, list[RunResult]]:
    return run_repository.list(
        status=status,
        task_id=task_id,
        flow_id=flow_id,
        limit=limit,
        offset=offset,
    )


def get_run_events(
    run_id: str,
    *,
    level: str | None = None,
    node_id: str | None = None,
    node_type: str | None = None,
    keyword: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> RunEventsResponse:
    get_run(run_id)
    total, events = run_repository.filter_events(
        run_id,
        level=level,
        node_id=node_id,
        node_type=node_type,
        keyword=keyword,
        limit=limit,
        offset=offset,
    )
    return RunEventsResponse(runId=run_id, total=total, limit=limit, offset=offset, events=events)


def export_run_events(
    run_id: str,
    *,
    export_format: str,
    level: str | None = None,
    node_id: str | None = None,
    node_type: str | None = None,
    keyword: str | None = None,
) -> ExportedRunLogs:
    events = get_run_events(
        run_id,
        level=level,
        node_id=node_id,
        node_type=node_type,
        keyword=keyword,
        limit=50_000,
        offset=0,
    ).events
    if export_format == "jsonl":
        lines = [json.dumps(item.model_dump(), ensure_ascii=False) for item in events]
        content = "\n".join(lines)
        return ExportedRunLogs(
            runId=run_id,
            format="jsonl",
            fileName=f"{run_id}.jsonl",
            content=content,
        )
    if export_format == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["eventId", "timestamp", "nodeId", "nodeType", "level", "message", "durationMs"])
        for item in events:
            writer.writerow(
                [
                    item.eventId,
                    item.timestamp,
                    item.nodeId,
                    item.nodeType,
                    item.level,
                    item.message,
                    item.durationMs if item.durationMs is not None else "",
                ]
            )
        return ExportedRunLogs(
            runId=run_id,
            format="csv",
            fileName=f"{run_id}.csv",
            content=buffer.getvalue(),
        )
    raise_api_error(
        status_code=400,
        code=RUN_EXPORT_INVALID,
        message=f"Unsupported export format: {export_format}",
        details={"format": export_format, "allowed": ["jsonl", "csv"]},
    )


def get_run_stats() -> RunStatsResponse:
    payload = run_repository.stats()
    return RunStatsResponse.model_validate(payload)


def get_alerts() -> AlertsResponse:
    failures = run_repository.recent_failures(limit=100)
    threshold = settings.failures_alert_threshold()
    alerts: list[AlertRecord] = []
    if len(failures) >= threshold:
        alerts.append(
            AlertRecord(
                alertId=f"alert_{uuid4().hex[:12]}",
                level="error",
                message=f"最近失败运行 {len(failures)} 次，超过阈值 {threshold}。",
                createdAt=failures[0].startedAt,
                data={
                    "threshold": threshold,
                    "failedRuns": len(failures),
                    "recentRunIds": [item.runId for item in failures[:10]],
                },
            )
        )
    for item in failures[:5]:
        alerts.append(
            AlertRecord(
                alertId=f"alert_{uuid4().hex[:12]}",
                level="warn",
                message=f"运行失败：{item.runId}",
                createdAt=item.startedAt,
                data={
                    "runId": item.runId,
                    "taskId": item.taskId,
                    "flowId": item.flowId,
                },
            )
        )
    return AlertsResponse(total=len(alerts), alerts=alerts)


def execute_stub(run_id: str, flow: FlowModel) -> RunResult:
    del run_id
    return execute_flow(flow)

