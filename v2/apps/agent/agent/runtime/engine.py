from __future__ import annotations

from collections.abc import Callable
import os
from uuid import uuid4

from agent.executors import ExecutionContext, NodeExecutionError, get_executor
from agent.models.contracts import (
    FlowEdge,
    FlowModel,
    FlowNode,
    RunEvent,
    RunOptions,
    RunResult,
    ensure_flow_model,
    now_iso,
)
from agent.models.error_codes import (
    BROWSER_STARTUP_FAILED,
    FLOW_VALIDATION_FAILED,
    NODE_EXECUTION_FAILED,
    NODE_TIMEOUT,
    RUN_CANCELED,
    RUN_DEBUG_PAUSED,
    RUN_STEP_LIMIT_EXCEEDED,
)
from agent.runtime.flow_migration import FlowMigrationError, migrate_flow
from agent.runtime.browser_session import BrowserSession, browser_runtime_available, resolve_headless
from agent.runtime.planner import PlanningError, build_plan

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"running", "canceled"},
    "running": {"success", "failed", "canceled"},
    "success": set(),
    "failed": set(),
    "canceled": set(),
}


def _resolve_browser_mode(flow: FlowModel) -> str:
    variable_mode = flow.variables.get("_browserMode")
    if isinstance(variable_mode, str) and variable_mode.strip():
        mode = variable_mode.strip().lower()
    else:
        mode = os.getenv("RPA_AGENT_BROWSER_MODE", "auto").strip().lower()
    if mode not in {"auto", "real", "simulate"}:
        return "auto"
    return mode


def _create_browser_session(flow: FlowModel, browser_mode: str) -> tuple[bool, BrowserSession | None]:
    if browser_mode == "simulate":
        return False, None
    if browser_mode == "auto":
        auto_real = os.getenv("RPA_AGENT_BROWSER_AUTO_REAL", "").strip().lower() in {"1", "true", "yes"}
        if not auto_real:
            return False, None
    if browser_mode == "auto" and not browser_runtime_available():
        return False, None

    variable_headless = flow.variables.get("_browserHeadless")
    if isinstance(variable_headless, bool):
        headless = variable_headless
    else:
        headless = resolve_headless(default_value=True)
    return True, BrowserSession(headless=headless)


def _transition(current: str, target: str) -> str:
    if target not in ALLOWED_TRANSITIONS.get(current, set()):
        raise RuntimeError(f"Invalid run status transition: {current} -> {target}")
    return target


def _new_event(
    *,
    run_id: str,
    node_id: str,
    node_type: str,
    level: str,
    message: str,
    duration_ms: int | None,
    data: dict[str, object] | None = None,
) -> RunEvent:
    return RunEvent(
        eventId=f"evt_{uuid4().hex[:12]}",
        timestamp=now_iso(),
        runId=run_id,
        nodeId=node_id,
        nodeType=node_type,  # type: ignore[arg-type]
        level=level,  # type: ignore[arg-type]
        message=message,
        durationMs=duration_ms,
        data=data or {},
    )


# 这些节点类型本身就是长耗时操作，引擎不应对它们应用默认节点超时限制。
_NO_TIMEOUT_NODE_TYPES: frozenset[str] = frozenset({
    # 和流程控制相关：
    "start", "end", "if", "loop", "break", "continue",
    "tryCatch", "switchCase", "parallel",
    # subflow 自带 timeoutMs 配置，单独处理
    "subflow",
})


def _resolve_retry_and_timeout(node_config: dict[str, object], options: RunOptions, node_type: str = "") -> tuple[int, int]:
    retries = node_config.get("maxRetries", options.defaultMaxRetries)
    timeout_candidate = node_config.get("timeoutMs")
    timeout_configured = isinstance(timeout_candidate, int) and timeout_candidate > 0
    timeout_ms = timeout_candidate if timeout_configured else options.defaultTimeoutMs
    if not isinstance(retries, int) or retries < 0:
        retries = options.defaultMaxRetries
    if not isinstance(timeout_ms, int) or timeout_ms <= 0:
        timeout_ms = options.defaultTimeoutMs

    # wait 节点在未显式配置 timeoutMs 时，按等待时长推导一个更稳健的默认超时。
    # 显式配置的 timeoutMs 必须被尊重，不能被自动扩展覆盖。
    if node_type == "wait" and not timeout_configured:
        wait_ms = node_config.get("ms", 1000)
        if isinstance(wait_ms, (int, float)) and wait_ms > 0:
            timeout_ms = max(timeout_ms, int(wait_ms) + 2000)

    # 这些节点类型没有实际超时风险，设置为极大值跳过标志。
    if node_type in _NO_TIMEOUT_NODE_TYPES:
        timeout_ms = 24 * 60 * 60 * 1000  # 24h 实际上等于不限制

    return retries, timeout_ms


def _allow_browser_startup_fallback(context: ExecutionContext, node_config: dict[str, object]) -> bool:
    node_override = node_config.get("fallbackToSimulate")
    if isinstance(node_override, bool):
        return node_override
    variable_override = context.variables.get("_browserStartupFallback")
    if isinstance(variable_override, bool):
        return variable_override
    return True


def _resolve_error_edge(outgoing_edges: list[FlowEdge]) -> str | None:
    for edge in outgoing_edges:
        if isinstance(edge.condition, str) and edge.condition.strip().lower() in {"catch", "error"}:
            return edge.target
    return None


def _run_single_node(
    *,
    run_id: str,
    context: ExecutionContext,
    node: FlowNode,
    options: RunOptions,
    outgoing_edges: list[FlowEdge],
    events: list[RunEvent],
) -> str | None:
    retries, timeout_ms = _resolve_retry_and_timeout(node.config, options, node.type)
    attempt = 0
    while attempt <= retries:
        attempt += 1
        try:
            executor = get_executor(node.type)
            result = executor(context, node, outgoing_edges)
            if result.duration_ms > timeout_ms:
                raise NodeExecutionError(
                    code=NODE_TIMEOUT,
                    message=f"Node timeout after {timeout_ms} ms.",
                    details={
                        "timeoutMs": timeout_ms,
                        "durationMs": result.duration_ms,
                        "attempt": attempt,
                    },
                )
            events.append(
                _new_event(
                    run_id=run_id,
                    node_id=node.id,
                    node_type=node.type,
                    level="info",
                    message=result.message,
                    duration_ms=result.duration_ms,
                    data={
                        "attempt": attempt,
                        "maxRetries": retries,
                        "nextNodeId": result.next_node_id,
                        **result.data,
                    },
                )
            )
            return result.next_node_id
        except NodeExecutionError as exc:
            if (
                exc.code == BROWSER_STARTUP_FAILED
                and context.browser_enabled
                and _allow_browser_startup_fallback(context, node.config)
            ):
                if context.browser_session is not None:
                    context.browser_session.close()
                    context.browser_session = None
                context.browser_enabled = False
                events.append(
                    _new_event(
                        run_id=run_id,
                        node_id=node.id,
                        node_type=node.type,
                        level="warn",
                        message="Browser startup failed, downgraded to simulate mode.",
                        duration_ms=None,
                        data={"errorCode": BROWSER_STARTUP_FAILED, "degradedTo": "simulate"},
                    )
                )
                attempt -= 1
                continue
            remaining = retries - attempt + 1
            level = "warn" if remaining > 0 else "error"
            events.append(
                _new_event(
                    run_id=run_id,
                    node_id=node.id,
                    node_type=node.type,
                    level=level,
                    message=exc.message,
                    duration_ms=None,
                    data={
                        "attempt": attempt,
                        "maxRetries": retries,
                        "remainingRetries": max(remaining, 0),
                        "errorCode": exc.code,
                        "details": exc.details,
                    },
                )
            )
            if remaining <= 0:
                raise
    raise NodeExecutionError(
        code=NODE_EXECUTION_FAILED,
        message=f"Node execution failed after retries: {node.id}",
        details={"nodeId": node.id},
    )


def run_flow(
    flow: FlowModel | dict[str, object],
    *,
    options: RunOptions | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> RunResult:
    run_id = f"run_{uuid4().hex[:12]}"
    started_at = now_iso()
    status: str = "pending"
    events: list[RunEvent] = []
    final_flow_id = "unknown"
    browser_session: BrowserSession | None = None

    run_options = options or RunOptions()

    try:
        flow_model = ensure_flow_model(flow)
        final_flow_id = flow_model.id
        migrated_flow = migrate_flow(flow_model)
        plan = build_plan(migrated_flow)
        browser_mode = _resolve_browser_mode(migrated_flow)
        browser_enabled, browser_session = _create_browser_session(migrated_flow, browser_mode)
        context = ExecutionContext(
            flow=migrated_flow,
            variables=dict(migrated_flow.variables),
            browser_enabled=browser_enabled,
            browser_session=browser_session,
        )
        status = _transition(status, "running")
        events.append(
            _new_event(
                run_id=run_id,
                node_id="runtime",
                node_type="start",
                level="debug",
                message="Runtime initialized.",
                duration_ms=None,
                data={
                    "browserMode": browser_mode,
                    "realBrowserEnabled": browser_enabled,
                    "playwrightAvailable": browser_runtime_available(),
                },
            )
        )

        current_node_id: str | None = plan.start_node_id
        steps = 0
        node_by_id = plan.node_by_id

        while current_node_id is not None:
            if should_cancel and should_cancel():
                status = _transition(status, "canceled")
                node = node_by_id[current_node_id]
                events.append(
                    _new_event(
                        run_id=run_id,
                        node_id=node.id,
                        node_type=node.type,
                        level="warn",
                        message="Run canceled before node execution.",
                        duration_ms=None,
                        data={"errorCode": RUN_CANCELED},
                    )
                )
                break

            steps += 1
            if steps > run_options.maxSteps:
                raise NodeExecutionError(
                    code=RUN_STEP_LIMIT_EXCEEDED,
                    message=f"Run exceeded max steps: {run_options.maxSteps}",
                    details={"maxSteps": run_options.maxSteps},
                )

            node = node_by_id[current_node_id]
            outgoing_edges = plan.outgoing(current_node_id)
            try:
                next_node_id = _run_single_node(
                    run_id=run_id,
                    context=context,
                    node=node,
                    options=run_options,
                    outgoing_edges=outgoing_edges,
                    events=events,
                )
            except NodeExecutionError as exc:
                catch_target = _resolve_error_edge(outgoing_edges)
                if catch_target is None:
                    raise
                context.variables["__last_error_code"] = exc.code
                context.variables["__last_error_message"] = exc.message
                context.variables["__last_error_details"] = exc.details
                events.append(
                    _new_event(
                        run_id=run_id,
                        node_id=node.id,
                        node_type=node.type,
                        level="warn",
                        message="Node failed and routed to catch edge.",
                        duration_ms=None,
                        data={
                            "errorCode": exc.code,
                            "catchTarget": catch_target,
                            "details": exc.details,
                        },
                    )
                )
                current_node_id = catch_target
                continue

            if node.type == "end":
                status = _transition(status, "success")
                break
            pause_type: str | None = None
            if run_options.pauseAfterEachNode:
                pause_type = "step"
            elif node.id in run_options.breakpointNodeIds:
                pause_type = "breakpoint"
            if pause_type:
                status = _transition(status, "canceled")
                events.append(
                    _new_event(
                        run_id=run_id,
                        node_id=node.id,
                        node_type=node.type,
                        level="warn",
                        message="Run paused by debugger.",
                        duration_ms=None,
                        data={
                            "errorCode": RUN_DEBUG_PAUSED,
                            "pauseType": pause_type,
                            "pausedNodeId": node.id,
                            "nextNodeId": next_node_id,
                        },
                    )
                )
                break
            if next_node_id is None:
                raise NodeExecutionError(
                    code=NODE_EXECUTION_FAILED,
                    message=f"Node {node.id} has no next edge and is not end.",
                    details={"nodeId": node.id, "nodeType": node.type},
                )
            current_node_id = next_node_id
        else:
            status = _transition(status, "success")
    except (FlowMigrationError, PlanningError) as exc:
        status = "failed" if status == "pending" else _transition(status, "failed")
        events.append(
            _new_event(
                run_id=run_id,
                node_id="flow",
                node_type="start",
                level="error",
                message=str(exc),
                duration_ms=None,
                data={"errorCode": exc.code, "details": exc.details},
            )
        )
    except NodeExecutionError as exc:
        status = "failed" if status == "pending" else _transition(status, "failed")
        events.append(
            _new_event(
                run_id=run_id,
                node_id="runtime",
                node_type="start",
                level="error",
                message=exc.message,
                duration_ms=None,
                data={"errorCode": exc.code, "details": exc.details},
            )
        )
    except Exception as exc:  # pragma: no cover
        status = "failed" if status == "pending" else _transition(status, "failed")
        events.append(
            _new_event(
                run_id=run_id,
                node_id="runtime",
                node_type="start",
                level="error",
                message="Unexpected runtime error.",
                duration_ms=None,
                data={"errorCode": FLOW_VALIDATION_FAILED, "details": {"reason": str(exc)}},
            )
        )
    finally:
        if browser_session is not None:
            browser_session.close()

    return RunResult(
        runId=run_id,
        flowId=final_flow_id,
        status=status,  # type: ignore[arg-type]
        startedAt=started_at,
        finishedAt=now_iso(),
        events=events,
    )
