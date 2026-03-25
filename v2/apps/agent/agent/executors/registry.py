from __future__ import annotations

import json
import re
import sqlite3
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable

from agent.executors.errors import NodeExecutionError
from agent.models.contracts import FlowEdge, FlowModel, FlowNode, NodeType
from agent.models.error_codes import ELEMENT_NOT_FOUND, NODE_CONFIG_INVALID, NODE_EXECUTION_FAILED
from agent.runtime.browser_session import BrowserActionError, BrowserSession
from agent.runtime.katalon_runner import KatalonRunError, run_katalon

TEMPLATE_PATTERN = re.compile(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}")
IF_OPERATOR_ALIASES: dict[str, str] = {
    "==": "eq",
    "eq": "eq",
    "equals": "eq",
    "equal": "eq",
    "!=": "ne",
    "<>": "ne",
    "ne": "ne",
    "not_equals": "ne",
    "not_equal": "ne",
    ">": "gt",
    "gt": "gt",
    ">=": "gte",
    "ge": "gte",
    "gte": "gte",
    "<": "lt",
    "lt": "lt",
    "<=": "lte",
    "le": "lte",
    "lte": "lte",
    "contains": "contains",
    "in": "in",
    "exists": "exists",
    "empty": "empty",
    "regex": "regex",
    "matches": "regex",
    "truthy": "truthy",
    "falsy": "falsy",
}
DEFAULT_TRUE_TOKENS = {"true", "1", "yes", "on", "ok", "success", "passed"}
DEFAULT_FALSE_TOKENS = {"false", "0", "no", "off", "fail", "failed", "error"}


@dataclass(slots=True)
class ExecutionContext:
    flow: FlowModel
    variables: dict[str, Any]
    browser_enabled: bool
    browser_session: BrowserSession | None = None


@dataclass(slots=True)
class NodeExecutionResult:
    next_node_id: str | None
    duration_ms: int
    message: str
    data: dict[str, Any]


NodeExecutor = Callable[[ExecutionContext, FlowNode, list[FlowEdge]], NodeExecutionResult]


def _int(value: Any, default: int) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return default


def _bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off"}:
            return False
    return default


def _coerce_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return float(int(value))
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return float(stripped)
        except ValueError:
            return None
    return None


def _coerce_bool_token(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off"}:
            return False
    return None


def _value_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _is_empty_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, tuple, dict, set)):
        return len(value) == 0
    return False


def _normalize_if_operator(operator: Any) -> str:
    if not isinstance(operator, str):
        return "truthy"
    normalized = operator.strip().lower()
    if not normalized:
        return "truthy"
    return IF_OPERATOR_ALIASES.get(normalized, "truthy")


def _evaluate_if_condition(context: ExecutionContext, node: FlowNode) -> tuple[bool, dict[str, Any]]:
    config = node.config
    raw_operator = config.get("operator")
    raw_left = config.get("left")
    raw_right = config.get("right")
    has_structured = (
        isinstance(raw_operator, str)
        and raw_operator.strip() != ""
    ) or raw_left is not None or raw_right is not None

    if not has_structured:
        value = _resolve(config.get("expression", config.get("value", False)), context.variables)
        flag = _bool(value, False)
        return flag, {"mode": "legacy", "operator": "truthy", "value": value, "bool": flag}

    operator = _normalize_if_operator(raw_operator)
    left = _resolve(raw_left, context.variables)
    right = _resolve(raw_right, context.variables)

    if operator == "truthy":
        flag = _bool(left, False)
    elif operator == "falsy":
        flag = not _bool(left, False)
    elif operator == "exists":
        flag = left is not None and not (isinstance(left, str) and left.strip() == "")
    elif operator == "empty":
        flag = _is_empty_value(left)
    elif operator in {"eq", "ne"}:
        left_bool = _coerce_bool_token(left)
        right_bool = _coerce_bool_token(right)
        if left_bool is not None and right_bool is not None:
            equal = left_bool == right_bool
        else:
            left_number = _coerce_float(left)
            right_number = _coerce_float(right)
            if left_number is not None and right_number is not None:
                equal = left_number == right_number
            else:
                equal = _value_text(left) == _value_text(right)
        flag = equal if operator == "eq" else not equal
    elif operator in {"gt", "gte", "lt", "lte"}:
        left_number = _coerce_float(left)
        right_number = _coerce_float(right)
        if left_number is not None and right_number is not None:
            left_cmp: float | str = left_number
            right_cmp: float | str = right_number
        else:
            left_cmp = _value_text(left)
            right_cmp = _value_text(right)
        if operator == "gt":
            flag = left_cmp > right_cmp
        elif operator == "gte":
            flag = left_cmp >= right_cmp
        elif operator == "lt":
            flag = left_cmp < right_cmp
        else:
            flag = left_cmp <= right_cmp
    elif operator == "contains":
        if isinstance(left, str):
            flag = _value_text(right) in left
        elif isinstance(left, dict):
            flag = _value_text(right) in left
        elif isinstance(left, (list, tuple, set)):
            flag = right in left
        else:
            flag = False
    elif operator == "in":
        if isinstance(right, str):
            flag = _value_text(left) in right
        elif isinstance(right, dict):
            flag = _value_text(left) in right
        elif isinstance(right, (list, tuple, set)):
            flag = left in right
        else:
            flag = False
    elif operator == "regex":
        pattern = _value_text(right)
        try:
            flag = bool(re.search(pattern, _value_text(left)))
        except re.error:
            flag = False
    else:
        flag = _bool(left, False)

    return flag, {
        "mode": "structured",
        "operator": operator,
        "left": left,
        "right": right,
        "bool": flag,
    }


def _parse_bool_tokens(raw: Any, fallback: set[str]) -> set[str]:
    if isinstance(raw, str):
        tokens = [item.strip().lower() for item in re.split(r"[,\n|]", raw) if item.strip()]
        return set(tokens) if tokens else set(fallback)
    if isinstance(raw, (list, tuple, set)):
        tokens = [str(item).strip().lower() for item in raw if str(item).strip()]
        return set(tokens) if tokens else set(fallback)
    return set(fallback)


def _normalize_set_variable_value(value: Any, node: FlowNode, context: ExecutionContext) -> Any:
    raw_mode = _resolve(node.config.get("normalizeAs", "none"), context.variables)
    mode = str(raw_mode).strip().lower() if raw_mode is not None else "none"
    if mode in {"", "none"}:
        return value
    if mode in {"bool", "boolean"}:
        raw_true_values = _resolve(node.config.get("trueValues"), context.variables)
        raw_false_values = _resolve(node.config.get("falseValues"), context.variables)
        true_tokens = _parse_bool_tokens(raw_true_values, DEFAULT_TRUE_TOKENS)
        false_tokens = _parse_bool_tokens(raw_false_values, DEFAULT_FALSE_TOKENS)
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in true_tokens:
                return True
            if normalized in false_tokens:
                return False
        bool_value = _coerce_bool_token(value)
        if bool_value is not None:
            return bool_value
        if "defaultBoolean" in node.config:
            default_value = _coerce_bool_token(_resolve(node.config.get("defaultBoolean"), context.variables))
            if default_value is not None:
                return default_value
        return False
    if mode == "number":
        number = _coerce_float(value)
        if number is not None:
            return int(number) if number.is_integer() else number
        return value
    text = _value_text(value)
    if mode == "string":
        return text
    if mode == "trim":
        return text.strip()
    if mode == "lower":
        return text.lower()
    if mode == "upper":
        return text.upper()
    return value


def _lookup(variables: dict[str, Any], key: str) -> Any:
    if key in variables:
        return variables[key]
    current: Any = variables
    normalized_parts = [part for part in re.split(r"[.\[\]]+", key) if part]
    for part in normalized_parts:
        if isinstance(current, dict):
            if part not in current:
                return None
            current = current[part]
            continue
        if isinstance(current, (list, tuple)):
            if not part.isdigit():
                return None
            index = int(part)
            if index < 0 or index >= len(current):
                return None
            current = current[index]
            continue
        return None
    return current


def _render(text: str, variables: dict[str, Any]) -> str:
    def replace(match: re.Match[str]) -> str:
        value = _lookup(variables, match.group(1))
        if value is None:
            return ""
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False)
        return str(value)

    return TEMPLATE_PATTERN.sub(replace, text)


def _resolve(value: Any, variables: dict[str, Any]) -> Any:
    if isinstance(value, str):
        stripped = value.strip()
        full = TEMPLATE_PATTERN.fullmatch(stripped)
        if full:
            looked = _lookup(variables, full.group(1))
            if looked is not None:
                return looked
        return _render(value, variables)
    return value


def _resolve_deep(value: Any, variables: dict[str, Any]) -> Any:
    if isinstance(value, dict):
        return {str(key): _resolve_deep(candidate, variables) for key, candidate in value.items()}
    if isinstance(value, list):
        return [_resolve_deep(candidate, variables) for candidate in value]
    return _resolve(value, variables)


def _selectors(config: dict[str, Any]) -> list[str]:
    values: list[str] = []
    playwright_primary = config.get("playwrightPrimary")
    if isinstance(playwright_primary, str) and playwright_primary.strip():
        values.append(playwright_primary.strip())
    elif isinstance(playwright_primary, dict):
        primary_value = playwright_primary.get("value")
        if isinstance(primary_value, str) and primary_value.strip():
            values.append(primary_value.strip())
    playwright_candidates = config.get("playwrightCandidates")
    if isinstance(playwright_candidates, list):
        for item in playwright_candidates:
            if isinstance(item, str) and item.strip():
                values.append(item.strip())
            elif isinstance(item, dict):
                cand = item.get("value")
                if isinstance(cand, str) and cand.strip():
                    values.append(cand.strip())
    candidates = config.get("selectorCandidates")
    if isinstance(candidates, list):
        for item in candidates:
            if isinstance(item, str) and item.strip():
                values.append(item.strip())
            elif isinstance(item, dict):
                cand = item.get("value")
                if isinstance(cand, str) and cand.strip():
                    values.append(cand.strip())
    selector = config.get("selector")
    if isinstance(selector, str) and selector.strip():
        values.insert(0, selector.strip())
    return list(dict.fromkeys(values))


def _scope_selector(config: dict[str, Any], variables: dict[str, Any]) -> str | None:
    resolved = _resolve(config.get("scopeSelector"), variables)
    if isinstance(resolved, str) and resolved.strip():
        return resolved.strip()
    return None


def _parse_string_list(raw: Any) -> list[str]:
    if isinstance(raw, list):
        values = [str(item).strip() for item in raw if str(item).strip()]
        return list(dict.fromkeys(values))
    if isinstance(raw, str):
        values = [item.strip() for item in re.split(r"[,\n|]", raw) if item.strip()]
        return list(dict.fromkeys(values))
    return []


def _resolve_loop_items(node: FlowNode, context: ExecutionContext) -> list[Any] | None:
    source_configured = "source" in node.config
    raw_source = node.config.get("source")
    if not source_configured:
        return None
    if isinstance(raw_source, str) and not raw_source.strip():
        return None
    if raw_source is None:
        return []
    resolved = _resolve(raw_source, context.variables)
    if resolved is None:
        return []
    if isinstance(resolved, list):
        return list(resolved)
    if isinstance(resolved, tuple):
        return list(resolved)
    if isinstance(resolved, set):
        return list(resolved)
    if isinstance(resolved, dict):
        return [{"key": key, "value": value} for key, value in resolved.items()]
    if isinstance(resolved, str):
        text = resolved.strip()
        if not text:
            return []
        if text.startswith("[") and text.endswith("]"):
            try:
                parsed = json.loads(text)
                if isinstance(parsed, list):
                    return parsed
            except json.JSONDecodeError:
                pass
        return [resolved]
    return [resolved]


def _loop_variable_name(config: dict[str, Any], key: str, fallback: str | None = None) -> str | None:
    raw = config.get(key, fallback)
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return fallback


def _table_columns(config: dict[str, Any], variables: dict[str, Any]) -> list[str]:
    resolved = _resolve(config.get("columns"), variables)
    return _parse_string_list(resolved)


def _row_locate_match_rules(config: dict[str, Any], variables: dict[str, Any], *, default_case_sensitive: bool) -> list[dict[str, Any]]:
    resolved = _resolve(config.get("matchRules"), variables)
    if isinstance(resolved, str):
        text = resolved.strip()
        if not text:
            return []
        try:
            resolved = json.loads(text)
        except json.JSONDecodeError:
            return []
    if isinstance(resolved, dict):
        resolved = [resolved]
    if not isinstance(resolved, list):
        return []

    rules: list[dict[str, Any]] = []
    for item in resolved:
        if not isinstance(item, dict):
            continue
        rule = _resolve_deep(item, variables)
        if not isinstance(rule, dict):
            continue
        mode_raw = rule.get("mode")
        mode = str(mode_raw).strip().lower() if mode_raw is not None else "contains"
        if mode not in {"contains", "equals", "regex"}:
            mode = "contains"

        text_raw = rule.get("text")
        if text_raw is None:
            continue
        text_value = str(text_raw)
        if not text_value:
            continue

        raw_column_index = rule.get("columnIndex", -1)
        if isinstance(raw_column_index, bool):
            column_index = -1
        elif isinstance(raw_column_index, (int, float)):
            column_index = int(raw_column_index)
        elif isinstance(raw_column_index, str) and raw_column_index.strip().lstrip("-").isdigit():
            column_index = int(raw_column_index.strip())
        else:
            column_index = -1
        if column_index < -1:
            column_index = -1

        raw_case_sensitive = rule.get("caseSensitive")
        case_sensitive = (
            bool(raw_case_sensitive)
            if isinstance(raw_case_sensitive, bool)
            else default_case_sensitive
        )

        rules.append(
            {
                "mode": mode,
                "text": text_value,
                "columnIndex": column_index,
                "caseSensitive": case_sensitive,
            }
        )
    return rules


def _frame_path(config: dict[str, Any]) -> list[dict[str, Any]]:
    raw = config.get("framePath")
    if not isinstance(raw, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        segment: dict[str, Any] = {}
        index = item.get("index")
        if isinstance(index, int):
            segment["index"] = index
        for key in ("name", "id", "src", "srcHostPath", "srcStableFragment", "selector", "hint", "tag", "frameBorder"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                segment[key] = value.strip()
        id_stable = item.get("idStable")
        if isinstance(id_stable, bool):
            segment["idStable"] = id_stable
        raw_attr_hints = item.get("attrHints")
        if isinstance(raw_attr_hints, dict):
            attr_hints: dict[str, str] = {}
            for raw_name, raw_value in raw_attr_hints.items():
                if not isinstance(raw_name, str):
                    continue
                if not isinstance(raw_value, str):
                    continue
                name = raw_name.strip().lower()
                value = raw_value.strip()
                if not name or not value:
                    continue
                attr_hints[name] = value
            if attr_hints:
                segment["attrHints"] = attr_hints
        if item.get("crossOrigin") is True:
            segment["crossOrigin"] = True
        if segment:
            normalized.append(segment)
    return normalized


def _frame_locator_chain(config: dict[str, Any]) -> list[dict[str, Any]]:
    raw = config.get("frameLocatorChain")
    if not isinstance(raw, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        segment: dict[str, Any] = {}
        for key in ("depth", "index"):
            value = item.get(key)
            if isinstance(value, int):
                segment[key] = value
        for key in ("hint", "primary"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                segment[key] = value.strip()
        if item.get("crossOrigin") is True:
            segment["crossOrigin"] = True
        selector_candidates: list[str] = []
        candidates = item.get("selectorCandidates")
        if isinstance(candidates, list):
            for candidate in candidates:
                if isinstance(candidate, str) and candidate.strip():
                    selector_candidates.append(candidate.strip())
                elif isinstance(candidate, dict):
                    value = candidate.get("value")
                    if isinstance(value, str) and value.strip():
                        selector_candidates.append(value.strip())
        if selector_candidates:
            segment["selectorCandidates"] = list(dict.fromkeys(selector_candidates))
        if segment:
            normalized.append(segment)
    return normalized


def _next_default(outgoing: list[FlowEdge]) -> str | None:
    return outgoing[0].target if outgoing else None


def _next_by_condition(outgoing: list[FlowEdge], condition: str) -> str | None:
    want = condition.strip().lower()
    fallback: str | None = None
    for edge in outgoing:
        if edge.condition is None and fallback is None:
            fallback = edge.target
            continue
        if isinstance(edge.condition, str) and edge.condition.strip().lower() == want:
            return edge.target
    return fallback


def _loop_stack(variables: dict[str, Any]) -> list[str]:
    raw = variables.get("__loop_stack")
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, str)]
    return []


def _save_loop_stack(variables: dict[str, Any], stack: list[str]) -> None:
    if stack:
        variables["__loop_stack"] = stack
    else:
        variables.pop("__loop_stack", None)


def _nearest_loop_id(variables: dict[str, Any]) -> str | None:
    stack = _loop_stack(variables)
    if not stack:
        return None
    return stack[-1]


def _pick_if(outgoing: list[FlowEdge], flag: bool) -> str | None:
    return _next_by_condition(outgoing, "true" if flag else "false") or _next_default(outgoing)


def _action_error(exc: BrowserActionError) -> NodeExecutionError:
    return NodeExecutionError(code=exc.code, message=exc.message, details=exc.details)


def _resolve_action_wait(
    node: FlowNode,
    *,
    default_state: str,
    timeout_ms: int,
) -> tuple[bool, str, int]:
    auto_wait = _bool(node.config.get("autoWait"), True)
    state_raw = node.config.get("waitState")
    wait_state = default_state
    if isinstance(state_raw, str) and state_raw.strip():
        candidate = state_raw.strip().lower()
        allowed = {"attached", "visible", "hidden", "detached", "enabled", "editable"}
        if candidate not in allowed:
            raise NodeExecutionError(
                code=NODE_CONFIG_INVALID,
                message=f"Node {node.id} has invalid waitState: {state_raw}",
                details={"nodeId": node.id, "waitState": state_raw, "allowed": sorted(allowed)},
            )
        wait_state = candidate
    wait_timeout_ms = _int(node.config.get("waitTimeoutMs"), timeout_ms)
    if wait_timeout_ms <= 0:
        wait_timeout_ms = timeout_ms
    return auto_wait, wait_state, wait_timeout_ms


def _require_selector(node: FlowNode) -> list[str]:
    selectors = _selectors(node.config)
    if selectors:
        return selectors
    raise NodeExecutionError(
        code=NODE_CONFIG_INVALID,
        message=f"Node {node.id} missing selector.",
        details={"nodeId": node.id, "nodeType": node.type},
    )


def _start(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    del context, node
    return NodeExecutionResult(_next_default(outgoing), 0, "Start node executed.", {})


def _end(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    del context, node, outgoing
    return NodeExecutionResult(None, 0, "End node reached.", {})


def _navigate(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    url = str(_resolve(node.config.get("url", ""), context.variables)).strip()
    if not url:
        raise NodeExecutionError(
            code=NODE_CONFIG_INVALID,
            message=f"Node {node.id} missing url.",
            details={"nodeId": node.id},
        )
    timeout_ms = _int(node.config.get("timeoutMs"), 5000)
    duration = 1
    if context.browser_enabled and context.browser_session is not None:
        try:
            duration = context.browser_session.navigate(url, timeout_ms)
        except BrowserActionError as exc:
            raise _action_error(exc) from exc
    return NodeExecutionResult(
        _next_default(outgoing),
        duration,
        f"Navigated to {url}.",
        {"url": url, "realBrowser": context.browser_enabled},
    )


def _click_like(
    context: ExecutionContext,
    node: FlowNode,
    outgoing: list[FlowEdge],
    *,
    button: str,
    click_count: int,
    action_name: str,
) -> NodeExecutionResult:
    selectors = _require_selector(node)
    frame_path = _frame_path(node.config)
    frame_locator_chain = _frame_locator_chain(node.config)
    scope_selector = _scope_selector(node.config, context.variables)
    timeout_ms = _int(node.config.get("timeoutMs"), 5000)
    auto_wait, wait_state, wait_timeout_ms = _resolve_action_wait(node, default_state="enabled", timeout_ms=timeout_ms)
    selector = selectors[0]
    duration = 1
    if context.browser_enabled and context.browser_session is not None:
        try:
            duration, selector = context.browser_session.click(
                selectors,
                timeout_ms=timeout_ms,
                button=button,
                click_count=click_count,
                auto_wait=auto_wait,
                wait_state=wait_state,
                wait_timeout_ms=wait_timeout_ms,
                frame_path=frame_path,
                frame_locator_chain=frame_locator_chain,
                scope_selector=scope_selector,
            )
        except BrowserActionError as exc:
            raise _action_error(exc) from exc
    return NodeExecutionResult(
        _next_default(outgoing),
        duration,
        f"{action_name} succeeded on {selector}.",
        {
            "selector": selector,
            "realBrowser": context.browser_enabled,
            "autoWait": auto_wait,
            "waitState": wait_state,
            "waitTimeoutMs": wait_timeout_ms,
            "scopeSelector": scope_selector,
        },
    )


def _click(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    return _click_like(context, node, outgoing, button="left", click_count=1, action_name="Click")


def _double_click(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    return _click_like(context, node, outgoing, button="left", click_count=2, action_name="Double click")


def _right_click(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    return _click_like(context, node, outgoing, button="right", click_count=1, action_name="Right click")


def _hover(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    selectors = _require_selector(node)
    frame_path = _frame_path(node.config)
    frame_locator_chain = _frame_locator_chain(node.config)
    scope_selector = _scope_selector(node.config, context.variables)
    timeout_ms = _int(node.config.get("timeoutMs"), 5000)
    auto_wait, wait_state, wait_timeout_ms = _resolve_action_wait(node, default_state="visible", timeout_ms=timeout_ms)
    selector = selectors[0]
    duration = 1
    if context.browser_enabled and context.browser_session is not None:
        try:
            duration, selector = context.browser_session.hover(
                selectors,
                timeout_ms,
                auto_wait=auto_wait,
                wait_state=wait_state,
                wait_timeout_ms=wait_timeout_ms,
                frame_path=frame_path,
                frame_locator_chain=frame_locator_chain,
                scope_selector=scope_selector,
            )
        except BrowserActionError as exc:
            raise _action_error(exc) from exc
    return NodeExecutionResult(
        _next_default(outgoing),
        duration,
        f"Hover succeeded on {selector}.",
        {
            "selector": selector,
            "autoWait": auto_wait,
            "waitState": wait_state,
            "waitTimeoutMs": wait_timeout_ms,
            "scopeSelector": scope_selector,
        },
    )


def _input(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    selectors = _require_selector(node)
    frame_path = _frame_path(node.config)
    frame_locator_chain = _frame_locator_chain(node.config)
    scope_selector = _scope_selector(node.config, context.variables)
    value = str(_resolve(node.config.get("text", node.config.get("value", "")), context.variables))
    timeout_ms = _int(node.config.get("timeoutMs"), 5000)
    auto_wait, wait_state, wait_timeout_ms = _resolve_action_wait(node, default_state="editable", timeout_ms=timeout_ms)
    selector = selectors[0]
    duration = 1
    if context.browser_enabled and context.browser_session is not None:
        try:
            duration, selector = context.browser_session.input_text(
                selectors,
                value,
                timeout_ms,
                auto_wait=auto_wait,
                wait_state=wait_state,
                wait_timeout_ms=wait_timeout_ms,
                frame_path=frame_path,
                frame_locator_chain=frame_locator_chain,
                scope_selector=scope_selector,
            )
        except BrowserActionError as exc:
            raise _action_error(exc) from exc
    return NodeExecutionResult(
        _next_default(outgoing),
        duration,
        f"Input succeeded on {selector}.",
        {
            "selector": selector,
            "autoWait": auto_wait,
            "waitState": wait_state,
            "waitTimeoutMs": wait_timeout_ms,
            "scopeSelector": scope_selector,
        },
    )


def _wait(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    ms = max(_int(_resolve(node.config.get("ms", 1000), context.variables), 1000), 0)
    if context.browser_enabled and context.browser_session is not None:
        duration = context.browser_session.wait(ms)
    else:
        started = time.perf_counter()
        time.sleep(ms / 1000)
        duration = int((time.perf_counter() - started) * 1000)
    return NodeExecutionResult(_next_default(outgoing), duration, f"Waited {ms} ms.", {"ms": ms})


def _extract(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    selectors = _require_selector(node)
    frame_path = _frame_path(node.config)
    frame_locator_chain = _frame_locator_chain(node.config)
    scope_selector = _scope_selector(node.config, context.variables)
    timeout_ms = _int(node.config.get("timeoutMs"), 5000)
    auto_wait, wait_state, wait_timeout_ms = _resolve_action_wait(node, default_state="visible", timeout_ms=timeout_ms)
    selector = selectors[0]
    text = f"simulated:{selector}"
    duration = 1
    if context.browser_enabled and context.browser_session is not None:
        try:
            duration, selector, text = context.browser_session.extract_text(
                selectors,
                timeout_ms,
                auto_wait=auto_wait,
                wait_state=wait_state,
                wait_timeout_ms=wait_timeout_ms,
                frame_path=frame_path,
                frame_locator_chain=frame_locator_chain,
                scope_selector=scope_selector,
            )
        except BrowserActionError as exc:
            raise _action_error(exc) from exc
    out_var = node.config.get("var")
    if isinstance(out_var, str) and out_var.strip():
        context.variables[out_var.strip()] = text
    # 命名空间输出：{{nodeId.value}}
    context.variables[f"{node.id}.value"] = text
    return NodeExecutionResult(
        _next_default(outgoing),
        duration,
        f"Extracted text from {selector}.",
        {
            "selector": selector,
            "value": text,
            "var": out_var,
            "autoWait": auto_wait,
            "waitState": wait_state,
            "waitTimeoutMs": wait_timeout_ms,
            "scopeSelector": scope_selector,
        },
    )


def _if(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    flag, details = _evaluate_if_condition(context, node)
    # 命名空间输出：{{nodeId.result}}
    context.variables[f"{node.id}.result"] = flag
    return NodeExecutionResult(_pick_if(outgoing, flag), 0, f"If evaluated to {flag}.", details)


def _loop(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    stack = _loop_stack(context.variables)
    if not stack or stack[-1] != node.id:
        stack.append(node.id)
    _save_loop_stack(context.variables, stack)
    counter_key = f"__loop_counter_{node.id}"
    source_cache_key = f"__loop_items_{node.id}"

    break_target = context.variables.get("__loop_break_target")
    if break_target == "*" or break_target == node.id:
        context.variables.pop("__loop_break_target", None)
        context.variables.pop(counter_key, None)
        context.variables.pop(source_cache_key, None)
        stack = [item for item in stack if item != node.id]
        _save_loop_stack(context.variables, stack)
        return NodeExecutionResult(
            _next_by_condition(outgoing, "exit") or _next_default(outgoing),
            0,
            f"Loop {node.id} exited by break.",
            {"branch": "exit", "reason": "break"},
        )

    continue_target = context.variables.get("__loop_continue_target")
    continue_active = continue_target == "*" or continue_target == node.id
    if continue_active:
        context.variables.pop("__loop_continue_target", None)

    cached_items = context.variables.get(source_cache_key)
    loop_items: list[Any] | None = cached_items if isinstance(cached_items, list) else None
    if loop_items is None:
        resolved_items = _resolve_loop_items(node, context)
        if resolved_items is not None:
            loop_items = list(resolved_items)
            context.variables[source_cache_key] = loop_items

    if loop_items is not None:
        total = len(loop_items)
        current_index = _int(context.variables.get(counter_key), 0)
        context.variables[f"{node.id}.count"] = total
        if current_index >= total:
            context.variables.pop(counter_key, None)
            context.variables.pop(source_cache_key, None)
            stack = [item for item in _loop_stack(context.variables) if item != node.id]
            _save_loop_stack(context.variables, stack)
            return NodeExecutionResult(
                _next_by_condition(outgoing, "exit") or _next_default(outgoing),
                0,
                f"Loop exit at iteration {current_index}/{total}.",
                {"iteration": current_index, "count": total, "branch": "exit", "continued": continue_active, "mode": "items"},
            )
        current = current_index + 1
        item = loop_items[current_index]
        context.variables[counter_key] = current
        # 命名空间输出：{{nodeId.iteration}}, {{nodeId.item}}, {{nodeId.index}}, {{nodeId.count}}
        context.variables[f"{node.id}.iteration"] = current
        context.variables[f"{node.id}.item"] = item
        context.variables[f"{node.id}.index"] = current_index
        item_var = _loop_variable_name(node.config, "itemVar", "item")
        index_var = _loop_variable_name(node.config, "indexVar", "index")
        if item_var:
            context.variables[item_var] = item
        if index_var:
            context.variables[index_var] = current_index
        return NodeExecutionResult(
            _next_by_condition(outgoing, "body") or _next_default(outgoing),
            0,
            f"Loop body iteration {current}/{total}.",
            {
                "iteration": current,
                "count": total,
                "index": current_index,
                "branch": "body",
                "continued": continue_active,
                "mode": "items",
                "itemVar": item_var,
                "indexVar": index_var,
            },
        )

    times = max(_int(_resolve(node.config.get("times", 1), context.variables), 1), 1)
    current = _int(context.variables.get(counter_key), 0) + 1
    context.variables[counter_key] = current
    # 命名空间输出：{{nodeId.iteration}}
    context.variables[f"{node.id}.iteration"] = current
    if current >= times:
        context.variables.pop(counter_key, None)
        context.variables.pop(source_cache_key, None)
        stack = [item for item in _loop_stack(context.variables) if item != node.id]
        _save_loop_stack(context.variables, stack)
        return NodeExecutionResult(
            _next_by_condition(outgoing, "exit") or _next_default(outgoing),
            0,
            f"Loop exit at iteration {current}/{times}.",
            {"iteration": current, "times": times, "branch": "exit", "continued": continue_active},
        )
    return NodeExecutionResult(
        _next_by_condition(outgoing, "body") or _next_default(outgoing),
        0,
        f"Loop body iteration {current}/{times}.",
        {"iteration": current, "times": times, "branch": "body", "continued": continue_active},
    )


def _wait_visible(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    selectors = _require_selector(node)
    frame_path = _frame_path(node.config)
    frame_locator_chain = _frame_locator_chain(node.config)
    scope_selector = _scope_selector(node.config, context.variables)
    timeout_ms = _int(node.config.get("timeoutMs"), 8000)
    selector = selectors[0]
    duration = 1
    if context.browser_enabled and context.browser_session is not None:
        try:
            duration, selector = context.browser_session.wait_for_selector(
                selectors,
                state="visible",
                timeout_ms=timeout_ms,
                frame_path=frame_path,
                frame_locator_chain=frame_locator_chain,
                scope_selector=scope_selector,
            )
        except BrowserActionError as exc:
            raise _action_error(exc) from exc
    return NodeExecutionResult(
        _next_default(outgoing),
        duration,
        f"Element visible: {selector}.",
        {"selector": selector, "scopeSelector": scope_selector},
    )


def _wait_text(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    selectors = _require_selector(node)
    frame_path = _frame_path(node.config)
    frame_locator_chain = _frame_locator_chain(node.config)
    scope_selector = _scope_selector(node.config, context.variables)
    text = str(_resolve(node.config.get("text", ""), context.variables))
    timeout_ms = _int(node.config.get("timeoutMs"), 8000)
    selector = selectors[0]
    duration = 1
    if context.browser_enabled and context.browser_session is not None:
        try:
            duration, selector = context.browser_session.wait_for_selector(
                selectors,
                state="attached",
                text=text,
                timeout_ms=timeout_ms,
                frame_path=frame_path,
                frame_locator_chain=frame_locator_chain,
                scope_selector=scope_selector,
            )
        except BrowserActionError as exc:
            raise _action_error(exc) from exc
    return NodeExecutionResult(
        _next_default(outgoing),
        duration,
        f"Detected text on {selector}.",
        {"selector": selector, "text": text, "scopeSelector": scope_selector},
    )

def _wait_network_idle(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    timeout_ms = _int(node.config.get("timeoutMs"), 8000)
    duration = min(50, timeout_ms)
    if context.browser_enabled and context.browser_session is not None:
        try:
            duration = context.browser_session.wait_for_network_idle(timeout_ms)
        except BrowserActionError as exc:
            raise _action_error(exc) from exc
    return NodeExecutionResult(_next_default(outgoing), duration, "Network is idle.", {})


def _switch_frame(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    duration = 1
    target = "simulate"
    if context.browser_enabled and context.browser_session is not None:
        try:
            duration, target = context.browser_session.switch_frame(
                selector=node.config.get("selector") if isinstance(node.config.get("selector"), str) else None,
                frame_url=node.config.get("url") if isinstance(node.config.get("url"), str) else None,
                index=_int(node.config.get("index"), 0) if node.config.get("index") is not None else None,
                timeout_ms=_int(node.config.get("timeoutMs"), 5000),
            )
        except BrowserActionError as exc:
            raise _action_error(exc) from exc
    return NodeExecutionResult(_next_default(outgoing), duration, f"Switched frame: {target}.", {"target": target})


def _switch_tab(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    duration = 1
    target = "simulate"
    if context.browser_enabled and context.browser_session is not None:
        try:
            duration, target = context.browser_session.switch_tab(
                index=_int(node.config.get("index"), 0) if node.config.get("index") is not None else None,
                url=node.config.get("url") if isinstance(node.config.get("url"), str) else None,
                timeout_ms=_int(node.config.get("timeoutMs"), 5000),
            )
        except BrowserActionError as exc:
            raise _action_error(exc) from exc
    return NodeExecutionResult(_next_default(outgoing), duration, f"Switched tab: {target}.", {"target": target})


def _scroll(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    selectors = _selectors(node.config)
    frame_path = _frame_path(node.config)
    frame_locator_chain = _frame_locator_chain(node.config)
    scope_selector = _scope_selector(node.config, context.variables)
    x = _int(_resolve(node.config.get("x", 0), context.variables), 0)
    y = _int(_resolve(node.config.get("y", 0), context.variables), 0)
    timeout_ms = _int(node.config.get("timeoutMs"), 5000)
    auto_wait, wait_state, wait_timeout_ms = _resolve_action_wait(node, default_state="visible", timeout_ms=timeout_ms)
    duration = 1
    selector = selectors[0] if selectors else "window"
    if context.browser_enabled and context.browser_session is not None:
        try:
            duration, selector = context.browser_session.scroll(
                selectors,
                x=x,
                y=y,
                timeout_ms=timeout_ms,
                auto_wait=auto_wait,
                wait_state=wait_state,
                wait_timeout_ms=wait_timeout_ms,
                frame_path=frame_path,
                frame_locator_chain=frame_locator_chain,
                scope_selector=scope_selector,
            )
        except BrowserActionError as exc:
            raise _action_error(exc) from exc
    return NodeExecutionResult(
        _next_default(outgoing),
        duration,
        f"Scrolled on {selector}.",
        {
            "selector": selector,
            "x": x,
            "y": y,
            "autoWait": auto_wait,
            "waitState": wait_state,
            "waitTimeoutMs": wait_timeout_ms,
            "scopeSelector": scope_selector,
        },
    )


def _select(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    selectors = _require_selector(node)
    frame_path = _frame_path(node.config)
    frame_locator_chain = _frame_locator_chain(node.config)
    scope_selector = _scope_selector(node.config, context.variables)
    value = str(_resolve(node.config.get("value", ""), context.variables))
    timeout_ms = _int(node.config.get("timeoutMs"), 5000)
    auto_wait, wait_state, wait_timeout_ms = _resolve_action_wait(node, default_state="visible", timeout_ms=timeout_ms)
    selector = selectors[0]
    duration = 1
    if context.browser_enabled and context.browser_session is not None:
        try:
            duration, selector = context.browser_session.select_option(
                selectors,
                value,
                timeout_ms,
                auto_wait=auto_wait,
                wait_state=wait_state,
                wait_timeout_ms=wait_timeout_ms,
                frame_path=frame_path,
                frame_locator_chain=frame_locator_chain,
                scope_selector=scope_selector,
            )
        except BrowserActionError as exc:
            raise _action_error(exc) from exc
    return NodeExecutionResult(
        _next_default(outgoing),
        duration,
        f"Selected {value} on {selector}.",
        {
            "selector": selector,
            "value": value,
            "autoWait": auto_wait,
            "waitState": wait_state,
            "waitTimeoutMs": wait_timeout_ms,
            "scopeSelector": scope_selector,
        },
    )


def _upload(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    selectors = _require_selector(node)
    frame_path = _frame_path(node.config)
    frame_locator_chain = _frame_locator_chain(node.config)
    scope_selector = _scope_selector(node.config, context.variables)
    file_path = str(_resolve(node.config.get("filePath", ""), context.variables)).strip()
    if not file_path:
        raise NodeExecutionError(code=NODE_CONFIG_INVALID, message=f"Node {node.id} missing filePath.", details={"nodeId": node.id})
    timeout_ms = _int(node.config.get("timeoutMs"), 5000)
    auto_wait, wait_state, wait_timeout_ms = _resolve_action_wait(node, default_state="visible", timeout_ms=timeout_ms)
    selector = selectors[0]
    duration = 1
    if context.browser_enabled and context.browser_session is not None:
        try:
            duration, selector = context.browser_session.upload_files(
                selectors,
                file_path,
                timeout_ms,
                auto_wait=auto_wait,
                wait_state=wait_state,
                wait_timeout_ms=wait_timeout_ms,
                frame_path=frame_path,
                frame_locator_chain=frame_locator_chain,
                scope_selector=scope_selector,
            )
        except BrowserActionError as exc:
            raise _action_error(exc) from exc
    return NodeExecutionResult(
        _next_default(outgoing),
        duration,
        f"Uploaded file on {selector}.",
        {
            "selector": selector,
            "filePath": file_path,
            "autoWait": auto_wait,
            "waitState": wait_state,
            "waitTimeoutMs": wait_timeout_ms,
            "scopeSelector": scope_selector,
        },
    )


def _press_key(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    key = str(_resolve(node.config.get("key", "Enter"), context.variables))
    duration = 1
    if context.browser_enabled and context.browser_session is not None:
        try:
            duration = context.browser_session.press_key(key, _int(node.config.get("timeoutMs"), 5000))
        except BrowserActionError as exc:
            raise _action_error(exc) from exc
    return NodeExecutionResult(_next_default(outgoing), duration, f"Pressed {key}.", {"key": key})


def _screenshot(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    name = str(_resolve(node.config.get("name", "snapshot"), context.variables))
    full_page = _bool(node.config.get("fullPage"), True)
    path = None
    if context.browser_enabled and context.browser_session is not None:
        path = context.browser_session.screenshot(name, full_page=full_page)
    out_var = node.config.get("var")
    if isinstance(out_var, str) and out_var.strip():
        context.variables[out_var.strip()] = path
    # 命名空间输出：{{nodeId.path}}
    context.variables[f"{node.id}.path"] = path
    return NodeExecutionResult(_next_default(outgoing), 1, f"Screenshot: {path or 'none'}.", {"path": path})


def _assert_text(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    selectors = _require_selector(node)
    frame_path = _frame_path(node.config)
    frame_locator_chain = _frame_locator_chain(node.config)
    scope_selector = _scope_selector(node.config, context.variables)
    expected = str(_resolve(node.config.get("expected", ""), context.variables))
    contains = _bool(node.config.get("contains"), True)
    timeout_ms = _int(node.config.get("timeoutMs"), 5000)
    auto_wait, wait_state, wait_timeout_ms = _resolve_action_wait(node, default_state="visible", timeout_ms=timeout_ms)
    actual = expected
    selector = selectors[0]
    if context.browser_enabled and context.browser_session is not None:
        try:
            _, selector, actual = context.browser_session.extract_text(
                selectors,
                timeout_ms,
                auto_wait=auto_wait,
                wait_state=wait_state,
                wait_timeout_ms=wait_timeout_ms,
                frame_path=frame_path,
                frame_locator_chain=frame_locator_chain,
                scope_selector=scope_selector,
            )
        except BrowserActionError as exc:
            raise _action_error(exc) from exc
    passed = expected in actual if contains else expected == actual
    if not passed:
        raise NodeExecutionError(
            code=NODE_EXECUTION_FAILED,
            message=f"Assert text failed on {selector}.",
            details={"selector": selector, "expected": expected, "actual": actual, "contains": contains},
        )
    return NodeExecutionResult(_next_default(outgoing), 1, f"Assert text passed on {selector}.", {"selector": selector})


def _assert_visible(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    return _wait_visible(context, node, outgoing)


def _assert_url(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    expected = str(_resolve(node.config.get("expected", ""), context.variables))
    contains = _bool(node.config.get("contains"), True)
    actual = expected
    if context.browser_enabled and context.browser_session is not None:
        actual = context.browser_session.current_url()
    passed = expected in actual if contains else expected == actual
    if not passed:
        raise NodeExecutionError(
            code=NODE_EXECUTION_FAILED,
            message="Assert url failed.",
            details={"expected": expected, "actual": actual, "contains": contains},
        )
    # 命名空间输出：{{nodeId.url}}
    context.variables[f"{node.id}.url"] = actual
    return NodeExecutionResult(_next_default(outgoing), 1, "Assert url passed.", {"expected": expected, "actual": actual})


def _assert_count(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    selectors = _require_selector(node)
    frame_path = _frame_path(node.config)
    frame_locator_chain = _frame_locator_chain(node.config)
    scope_selector = _scope_selector(node.config, context.variables)
    expected = _int(_resolve(node.config.get("expected", 0), context.variables), 0)
    timeout_ms = _int(node.config.get("timeoutMs"), 5000)
    auto_wait, wait_state, wait_timeout_ms = _resolve_action_wait(node, default_state="attached", timeout_ms=timeout_ms)
    actual = expected
    selector = selectors[0]
    if context.browser_enabled and context.browser_session is not None:
        try:
            _, selector, actual = context.browser_session.element_count(
                selectors,
                timeout_ms,
                auto_wait=auto_wait,
                wait_state=wait_state,
                wait_timeout_ms=wait_timeout_ms,
                frame_path=frame_path,
                frame_locator_chain=frame_locator_chain,
                scope_selector=scope_selector,
            )
        except BrowserActionError as exc:
            raise _action_error(exc) from exc
    if actual != expected:
        raise NodeExecutionError(
            code=NODE_EXECUTION_FAILED,
            message=f"Assert count failed on {selector}.",
            details={"selector": selector, "expected": expected, "actual": actual},
        )
    return NodeExecutionResult(_next_default(outgoing), 1, f"Assert count passed on {selector}.", {"selector": selector})


def _set_variable(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    key = node.config.get("key")
    if not isinstance(key, str) or not key.strip():
        raise NodeExecutionError(code=NODE_CONFIG_INVALID, message=f"Node {node.id} missing variable key.", details={"nodeId": node.id})
    source = node.config.get("source") if "source" in node.config else node.config.get("value")
    resolved = _resolve(source, context.variables)
    final_value = _normalize_set_variable_value(resolved, node, context)
    context.variables[key.strip()] = final_value
    # 命名空间输出：{{nodeId.value}}
    context.variables[f"{node.id}.value"] = final_value
    return NodeExecutionResult(_next_default(outgoing), 0, f"Variable '{key.strip()}' updated.", {"key": key.strip()})


def _template_render(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    template = str(node.config.get("template", ""))
    rendered = _render(template, context.variables)
    out_var = node.config.get("var")
    if isinstance(out_var, str) and out_var.strip():
        context.variables[out_var.strip()] = rendered
    # 命名空间输出：{{nodeId.value}}
    context.variables[f"{node.id}.value"] = rendered
    return NodeExecutionResult(_next_default(outgoing), 0, "Template rendered.", {"rendered": rendered})


def _json_parse(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    source = _resolve(node.config.get("source", ""), context.variables)
    text = source.strip() if isinstance(source, str) else json.dumps(source, ensure_ascii=False)
    try:
        parsed: Any = json.loads(text) if text else {}
    except json.JSONDecodeError as exc:
        raise NodeExecutionError(
            code=NODE_EXECUTION_FAILED,
            message=f"Node {node.id} failed to parse JSON.",
            details={"nodeId": node.id, "reason": str(exc)},
        ) from exc

    path = node.config.get("path")
    value = parsed
    if isinstance(path, str) and path.strip():
        for part in path.strip().split("."):
            if isinstance(value, dict) and part in value:
                value = value[part]
            elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
                value = value[int(part)]
            else:
                value = None
                break
    out_var = node.config.get("var")
    if isinstance(out_var, str) and out_var.strip():
        context.variables[out_var.strip()] = value
    # 命名空间输出：{{nodeId.result}}
    context.variables[f"{node.id}.result"] = value
    return NodeExecutionResult(_next_default(outgoing), 0, "JSON parsed.", {"value": value})


def _regex_extract(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    source = str(_resolve(node.config.get("source", ""), context.variables))
    pattern = node.config.get("pattern")
    if not isinstance(pattern, str) or not pattern:
        raise NodeExecutionError(code=NODE_CONFIG_INVALID, message=f"Node {node.id} missing regex pattern.", details={"nodeId": node.id})
    group = _int(node.config.get("group"), 1)
    matched = None
    result = re.search(pattern, source)
    if result is not None:
        try:
            matched = result.group(group)
        except IndexError:
            matched = None
    out_var = node.config.get("var")
    if isinstance(out_var, str) and out_var.strip():
        context.variables[out_var.strip()] = matched
    # 命名空间输出：{{nodeId.result}}
    context.variables[f"{node.id}.result"] = matched
    return NodeExecutionResult(_next_default(outgoing), 0, "Regex extraction done.", {"matched": matched, "group": group})


def _table_extract(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    selector = str(node.config.get("selector", "")).strip()
    frame_path = _frame_path(node.config)
    frame_locator_chain = _frame_locator_chain(node.config)
    scope_selector = _scope_selector(node.config, context.variables)
    row_selector = str(_resolve(node.config.get("rowSelector", "tr"), context.variables)).strip() or "tr"
    cell_selector = str(_resolve(node.config.get("cellSelector", "th,td"), context.variables)).strip() or "th,td"
    use_header = _bool(_resolve(node.config.get("useHeader"), context.variables), False)
    output_as_raw = _resolve(node.config.get("outputAs", "rows"), context.variables)
    output_as = str(output_as_raw).strip().lower() if output_as_raw is not None else "rows"
    if output_as not in {"rows", "records"}:
        output_as = "rows"
    columns = _table_columns(node.config, context.variables)
    if not selector:
        raise NodeExecutionError(code=NODE_CONFIG_INVALID, message=f"Node {node.id} missing selector.", details={"nodeId": node.id})
    rows: list[list[str]] = []
    duration = 1
    if context.browser_enabled and context.browser_session is not None:
        try:
            duration, rows = context.browser_session.table_extract(
                selector,
                _int(node.config.get("timeoutMs"), 5000),
                row_selector=row_selector,
                cell_selector=cell_selector,
                frame_path=frame_path,
                frame_locator_chain=frame_locator_chain,
                scope_selector=scope_selector,
            )
        except BrowserActionError as exc:
            raise _action_error(exc) from exc
    data_rows = rows
    row_offset = 0
    if use_header and rows:
        header_row = rows[0]
        data_rows = rows[1:]
        row_offset = 1
        if not columns:
            columns = [item.strip() or f"col{index + 1}" for index, item in enumerate(header_row)]
    if not columns:
        max_columns = max((len(row) for row in data_rows), default=0)
        columns = [f"col{index + 1}" for index in range(max_columns)]
    records: list[dict[str, Any]] = []
    for row in data_rows:
        record: dict[str, Any] = {}
        for index, value in enumerate(row):
            key = columns[index] if index < len(columns) and columns[index].strip() else f"col{index + 1}"
            record[key] = value
        for index in range(len(row), len(columns)):
            key = columns[index].strip() or f"col{index + 1}"
            if key not in record:
                record[key] = ""
        records.append(record)
    row_selectors = [f"{selector} {row_selector}:nth-of-type({index + 1})" for index in range(row_offset, len(rows))]
    for index, record in enumerate(records):
        if index < len(row_selectors):
            record["__rowSelector"] = row_selectors[index]
        record["__rowIndex"] = index
    output_payload: Any = records if output_as == "records" else rows
    out_var = node.config.get("var")
    if isinstance(out_var, str) and out_var.strip():
        context.variables[out_var.strip()] = output_payload
    # 命名空间输出：{{nodeId.rows}}, {{nodeId.count}}, {{nodeId.first}}, {{nodeId.records}}, {{nodeId.firstRecord}}, {{nodeId.rowSelectors}}
    context.variables[f"{node.id}.rows"] = rows
    context.variables[f"{node.id}.count"] = len(rows)
    context.variables[f"{node.id}.first"] = rows[0] if rows else None
    context.variables[f"{node.id}.records"] = records
    context.variables[f"{node.id}.recordCount"] = len(records)
    context.variables[f"{node.id}.firstRecord"] = records[0] if records else None
    context.variables[f"{node.id}.headers"] = columns
    context.variables[f"{node.id}.rowSelectors"] = row_selectors
    return NodeExecutionResult(
        _next_default(outgoing),
        duration,
        f"Table extracted from {selector}.",
        {
            "rowCount": len(rows),
            "recordCount": len(records),
            "outputAs": output_as,
            "useHeader": use_header,
            "scopeSelector": scope_selector,
        },
    )


def _row_locate(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    selectors = _require_selector(node)
    frame_path = _frame_path(node.config)
    frame_locator_chain = _frame_locator_chain(node.config)
    scope_selector = _scope_selector(node.config, context.variables)
    row_selector = str(_resolve(node.config.get("rowSelector", "tr"), context.variables)).strip() or "tr"
    cell_selector = str(_resolve(node.config.get("cellSelector", "th,td"), context.variables)).strip() or "th,td"
    raw_match_mode = _resolve(node.config.get("matchMode", "index"), context.variables)
    match_mode = str(raw_match_mode).strip().lower() if raw_match_mode is not None else "index"
    if match_mode not in {"index", "contains", "equals", "regex"}:
        raise NodeExecutionError(
            code=NODE_CONFIG_INVALID,
            message=f"Node {node.id} has invalid matchMode: {raw_match_mode}",
            details={"nodeId": node.id, "matchMode": raw_match_mode, "allowed": ["index", "contains", "equals", "regex"]},
        )
    row_index = _int(_resolve(node.config.get("rowIndex", 0), context.variables), 0)
    if row_index < 0:
        row_index = 0
    column_index = _int(_resolve(node.config.get("columnIndex", -1), context.variables), -1)
    raw_text = _resolve(node.config.get("text", ""), context.variables)
    text = str(raw_text) if raw_text is not None else ""
    case_sensitive = _bool(_resolve(node.config.get("caseSensitive"), context.variables), False)
    match_rules = _row_locate_match_rules(node.config, context.variables, default_case_sensitive=case_sensitive)
    raw_rules_logic = _resolve(node.config.get("rulesLogic", "all"), context.variables)
    rules_logic = str(raw_rules_logic).strip().lower() if raw_rules_logic is not None else "all"
    if rules_logic not in {"all", "any"}:
        raise NodeExecutionError(
            code=NODE_CONFIG_INVALID,
            message=f"Node {node.id} has invalid rulesLogic: {raw_rules_logic}",
            details={"nodeId": node.id, "rulesLogic": raw_rules_logic, "allowed": ["all", "any"]},
        )
    raw_on_not_found = _resolve(node.config.get("onNotFound", "fail"), context.variables)
    on_not_found = str(raw_on_not_found).strip().lower() if raw_on_not_found is not None else "fail"
    if on_not_found not in {"fail", "branch"}:
        raise NodeExecutionError(
            code=NODE_CONFIG_INVALID,
            message=f"Node {node.id} has invalid onNotFound: {raw_on_not_found}",
            details={"nodeId": node.id, "onNotFound": raw_on_not_found, "allowed": ["fail", "branch"]},
        )
    if match_mode in {"contains", "equals", "regex"} and not text and not match_rules:
        raise NodeExecutionError(
            code=NODE_CONFIG_INVALID,
            message=f"Node {node.id} requires config.text or config.matchRules when matchMode is {match_mode}.",
            details={"nodeId": node.id, "matchMode": match_mode},
        )

    timeout_ms = _int(node.config.get("timeoutMs"), 5000)
    selector_used = selectors[0]
    found = True
    row_result: dict[str, Any] = {
        "rowIndex": row_index,
        "rowCount": max(row_index + 1, 1),
        "rowSelector": f"{selector_used} {row_selector}:nth-of-type({row_index + 1})",
        "row": [],
        "rowText": "",
        "matchMode": match_mode,
        "rulesLogic": rules_logic if match_rules else None,
    }
    duration = 1
    if context.browser_enabled and context.browser_session is not None:
        try:
            duration, selector_used, row_result = context.browser_session.locate_row(
                selectors,
                timeout_ms,
                row_selector=row_selector,
                cell_selector=cell_selector,
                match_mode=match_mode,
                row_index=row_index,
                text=text,
                column_index=column_index,
                case_sensitive=case_sensitive,
                match_rules=match_rules,
                rules_logic=rules_logic,
                frame_path=frame_path,
                frame_locator_chain=frame_locator_chain,
                scope_selector=scope_selector,
            )
        except BrowserActionError as exc:
            if exc.code == ELEMENT_NOT_FOUND and on_not_found == "branch":
                found = False
                details = exc.details if isinstance(exc.details, dict) else {}
                duration = max(_int(details.get("durationMs"), 0), 0)
                row_result = {
                    "rowIndex": -1,
                    "rowCount": _int(details.get("rowCount"), 0),
                    "rowSelector": "",
                    "row": [],
                    "rowText": "",
                    "matchMode": match_mode,
                    "rulesLogic": rules_logic if match_rules else None,
                }
            else:
                raise _action_error(exc) from exc

    row_values = row_result.get("row")
    if not isinstance(row_values, list):
        row_values = []
    row_text = row_result.get("rowText")
    row_text_value = str(row_text) if isinstance(row_text, str) else ""
    default_row_index = row_index if found else -1
    resolved_row_index = _int(row_result.get("rowIndex"), default_row_index)
    if resolved_row_index < -1:
        resolved_row_index = -1
    row_selector_value = row_result.get("rowSelector")
    if (not isinstance(row_selector_value, str) or not row_selector_value.strip()) and found:
        row_selector_value = f"{selector_used} {row_selector}:nth-of-type({resolved_row_index + 1})"
    elif not isinstance(row_selector_value, str):
        row_selector_value = ""
    columns = _table_columns(node.config, context.variables)
    if not columns:
        columns = [f"col{index + 1}" for index in range(len(row_values))]
    record: dict[str, Any] = {}
    for index, value in enumerate(row_values):
        key = columns[index] if index < len(columns) and columns[index].strip() else f"col{index + 1}"
        record[key] = value
    record["__rowSelector"] = row_selector_value
    record["__rowIndex"] = resolved_row_index

    output_payload = {
        "selector": selector_used,
        "found": found,
        "rowSelector": row_selector_value,
        "rowIndex": resolved_row_index,
        "row": row_values,
        "rowText": row_text_value,
        "record": record,
    }
    out_var = node.config.get("var")
    if isinstance(out_var, str) and out_var.strip():
        context.variables[out_var.strip()] = output_payload
    # 命名空间输出：{{nodeId.rowSelector}}, {{nodeId.rowIndex}}, {{nodeId.row}}, {{nodeId.rowText}}, {{nodeId.record}}
    context.variables[f"{node.id}.selector"] = selector_used
    context.variables[f"{node.id}.found"] = found
    context.variables[f"{node.id}.rowSelector"] = row_selector_value
    context.variables[f"{node.id}.rowIndex"] = resolved_row_index
    context.variables[f"{node.id}.row"] = row_values
    context.variables[f"{node.id}.rowText"] = row_text_value
    context.variables[f"{node.id}.record"] = record

    branch = "found" if found else "notFound"
    next_target = _next_by_condition(outgoing, branch) or _next_default(outgoing)
    return NodeExecutionResult(
        next_target,
        duration,
        f"Row located on {selector_used}." if found else f"Row not found on {selector_used}, routed to '{branch}' branch.",
        {
            "selector": selector_used,
            "found": found,
            "rowSelector": row_selector_value,
            "rowIndex": resolved_row_index,
            "rowCount": _int(row_result.get("rowCount"), 0),
            "matchMode": row_result.get("matchMode", match_mode),
            "rulesLogic": row_result.get("rulesLogic"),
            "onNotFound": on_not_found,
            "branch": branch,
            "scopeSelector": scope_selector,
        },
    )


def _http_request(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    method = str(_resolve(node.config.get("method", "GET"), context.variables)).upper()
    url = str(_resolve(node.config.get("url", ""), context.variables)).strip()
    if not url:
        raise NodeExecutionError(code=NODE_CONFIG_INVALID, message=f"Node {node.id} missing request url.", details={"nodeId": node.id})
    body = _resolve(node.config.get("body", ""), context.variables)
    data: bytes | None = None
    if method in {"POST", "PUT", "PATCH", "DELETE"}:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8") if isinstance(body, (dict, list)) else str(body).encode("utf-8")
    started = time.perf_counter()
    try:
        req = urllib.request.Request(url=url, method=method, data=data)
        if data is not None:
            req.add_header("Content-Type", "application/json; charset=utf-8")
        with urllib.request.urlopen(req, timeout=max(_int(node.config.get("timeoutMs"), 5000), 1) / 1000) as response:
            content = response.read().decode("utf-8", errors="replace")
            status = int(getattr(response, "status", 200))
    except urllib.error.URLError as exc:
        raise NodeExecutionError(
            code=NODE_EXECUTION_FAILED,
            message=f"HTTP request failed: {method} {url}",
            details={"nodeId": node.id, "reason": str(exc)},
        ) from exc
    duration = int((time.perf_counter() - started) * 1000)
    out_var = node.config.get("var")
    if isinstance(out_var, str) and out_var.strip():
        context.variables[out_var.strip()] = content
    # 命名空间输出：{{nodeId.response}}, {{nodeId.status}}, {{nodeId.body}}
    context.variables[f"{node.id}.response"] = content
    context.variables[f"{node.id}.body"] = content
    context.variables[f"{node.id}.status"] = status
    return NodeExecutionResult(_next_default(outgoing), duration, f"HTTP request succeeded: {status}", {"statusCode": status})


def _db_query(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    db_path = str(_resolve(node.config.get("dbPath", ""), context.variables)).strip()
    query = str(_resolve(node.config.get("query", ""), context.variables)).strip()
    if not db_path or not query:
        raise NodeExecutionError(code=NODE_CONFIG_INVALID, message=f"Node {node.id} missing dbPath or query.", details={"nodeId": node.id})
    started = time.perf_counter()
    try:
        with sqlite3.connect(db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(query)
            if query.lower().startswith("select"):
                columns = [item[0] for item in cursor.description or []]
                rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
            else:
                conn.commit()
                rows = [{"affectedRows": cursor.rowcount}]
    except sqlite3.Error as exc:
        raise NodeExecutionError(
            code=NODE_EXECUTION_FAILED,
            message=f"DB query failed on {db_path}",
            details={"nodeId": node.id, "reason": str(exc)},
        ) from exc
    duration = int((time.perf_counter() - started) * 1000)
    out_var = node.config.get("var")
    if isinstance(out_var, str) and out_var.strip():
        context.variables[out_var.strip()] = rows
    # 命名空间输出：{{nodeId.rows}}, {{nodeId.count}}, {{nodeId.first}}
    context.variables[f"{node.id}.rows"] = rows
    context.variables[f"{node.id}.count"] = len(rows)
    context.variables[f"{node.id}.first"] = rows[0] if rows else None
    return NodeExecutionResult(_next_default(outgoing), duration, f"DB query executed on {db_path}.", {"rowCount": len(rows)})


def _notify(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    channel = str(_resolve(node.config.get("channel", "log"), context.variables))
    message = str(_resolve(node.config.get("message", ""), context.variables))
    return NodeExecutionResult(_next_default(outgoing), 0, f"Notify[{channel}]: {message}", {"channel": channel})


def _switch_case(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    case_value = str(_resolve(node.config.get("expression", node.config.get("value", "")), context.variables)).strip()
    target = _next_by_condition(outgoing, case_value)
    if target is None:
        target = _next_by_condition(outgoing, "default") or _next_default(outgoing)
    # 命名空间输出：{{nodeId.case}}
    context.variables[f"{node.id}.case"] = case_value
    return NodeExecutionResult(target, 0, f"Switch case matched '{case_value or 'default'}'.", {"case": case_value})


def _parallel(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    del node
    branch_targets = [edge.target for edge in outgoing]
    primary_target = _next_by_condition(outgoing, "main") or _next_default(outgoing)
    context.variables["__parallel_branches"] = branch_targets
    return NodeExecutionResult(
        primary_target,
        0,
        "Parallel node scheduled branches (primary branch executed in current runtime).",
        {"branchTargets": branch_targets, "primaryTarget": primary_target},
    )


def _try_catch(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    del context, node
    try_target = _next_by_condition(outgoing, "try") or _next_default(outgoing)
    catch_target = _next_by_condition(outgoing, "catch")
    finally_target = _next_by_condition(outgoing, "finally")
    return NodeExecutionResult(
        try_target,
        0,
        "TryCatch node entered try branch.",
        {"tryTarget": try_target, "catchTarget": catch_target, "finallyTarget": finally_target},
    )


def _resolve_subflow_payload(context: ExecutionContext, node: FlowNode) -> dict[str, Any] | None:
    inline_flow = node.config.get("flow")
    if isinstance(inline_flow, dict):
        return inline_flow
    flow_id = node.config.get("flowId")
    subflows = context.variables.get("_subflows")
    if isinstance(flow_id, str) and isinstance(subflows, dict):
        candidate = subflows.get(flow_id)
        if isinstance(candidate, dict):
            return candidate
    return None


def _resolve_katalon_payload(context: ExecutionContext, node: FlowNode) -> dict[str, Any] | None:
    raw = node.config.get("katalon")
    if not isinstance(raw, dict):
        return None
    resolved = _resolve_deep(raw, context.variables)
    if not isinstance(resolved, dict):
        return None
    payload: dict[str, Any] = {}
    for key, value in resolved.items():
        payload[str(key)] = value
    return payload


def _subflow(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    katalon_payload = _resolve_katalon_payload(context, node)
    if katalon_payload is not None:
        timeout_ms = _int(node.config.get("timeoutMs"), 10 * 60 * 1000)
        try:
            result = run_katalon(katalon_payload, timeout_ms=timeout_ms)
        except KatalonRunError as exc:
            raise NodeExecutionError(
                code=NODE_EXECUTION_FAILED,
                message=f"Katalon run failed on node {node.id}.",
                details={"nodeId": node.id, "katalon": exc.details},
            ) from exc
        output_var = node.config.get("outputVar")
        if isinstance(output_var, str) and output_var.strip():
            context.variables[output_var.strip()] = result
        return NodeExecutionResult(
            _next_default(outgoing),
            int(result.get("durationMs") or 0),
            "Katalon run succeeded.",
            {
                "engine": "katalon",
                "exitCode": result.get("exitCode"),
                "reportFolder": result.get("reportFolder"),
                "projectPath": result.get("projectPath"),
                "testSuitePath": result.get("testSuitePath"),
                "testSuiteCollectionPath": result.get("testSuiteCollectionPath"),
            },
        )

    payload = _resolve_subflow_payload(context, node)
    if payload is None:
        flow_id = node.config.get("flowId")
        raise NodeExecutionError(
            code=NODE_CONFIG_INVALID,
            message=f"Node {node.id} missing subflow payload.",
            details={"nodeId": node.id, "flowId": flow_id},
        )

    try:
        from agent.runtime.engine import run_flow  # local import to avoid circular dependency
    except Exception as exc:  # pragma: no cover
        raise NodeExecutionError(
            code=NODE_EXECUTION_FAILED,
            message="Subflow runtime import failed.",
            details={"nodeId": node.id, "reason": str(exc)},
        ) from exc

    sub_result = run_flow(payload)
    if sub_result.status != "success":
        raise NodeExecutionError(
            code=NODE_EXECUTION_FAILED,
            message=f"Subflow failed: {sub_result.flowId}",
            details={"nodeId": node.id, "subRunId": sub_result.runId, "status": sub_result.status},
        )
    output_var = node.config.get("outputVar")
    if isinstance(output_var, str) and output_var.strip():
        context.variables[output_var.strip()] = {
            "runId": sub_result.runId,
            "status": sub_result.status,
            "flowId": sub_result.flowId,
        }
    return NodeExecutionResult(
        _next_default(outgoing),
        0,
        f"Subflow executed successfully: {sub_result.flowId}",
        {"subRunId": sub_result.runId, "subFlowId": sub_result.flowId},
    )


def _passthrough(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    del context
    return NodeExecutionResult(_next_default(outgoing), 0, f"Node {node.type} completed.", {"stub": True})


def _break_node(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    configured = node.config.get("loopId")
    target_loop_id = configured if isinstance(configured, str) and configured.strip() else _nearest_loop_id(context.variables)
    context.variables["__loop_break_target"] = target_loop_id or "*"
    return NodeExecutionResult(
        _next_default(outgoing),
        0,
        f"Loop break requested for {target_loop_id or '*'}",
        {"break": True, "loopId": target_loop_id},
    )


def _continue_node(context: ExecutionContext, node: FlowNode, outgoing: list[FlowEdge]) -> NodeExecutionResult:
    configured = node.config.get("loopId")
    target_loop_id = configured if isinstance(configured, str) and configured.strip() else _nearest_loop_id(context.variables)
    context.variables["__loop_continue_target"] = target_loop_id or "*"
    return NodeExecutionResult(
        _next_default(outgoing),
        0,
        f"Loop continue requested for {target_loop_id or '*'}",
        {"continue": True, "loopId": target_loop_id},
    )


EXECUTORS: dict[NodeType, NodeExecutor] = {
    "start": _start,
    "end": _end,
    "navigate": _navigate,
    "click": _click,
    "input": _input,
    "wait": _wait,
    "extract": _extract,
    "if": _if,
    "loop": _loop,
    "hover": _hover,
    "scroll": _scroll,
    "select": _select,
    "upload": _upload,
    "pressKey": _press_key,
    "doubleClick": _double_click,
    "rightClick": _right_click,
    "switchFrame": _switch_frame,
    "switchTab": _switch_tab,
    "screenshot": _screenshot,
    "assertText": _assert_text,
    "assertVisible": _assert_visible,
    "assertUrl": _assert_url,
    "assertCount": _assert_count,
    "setVariable": _set_variable,
    "templateRender": _template_render,
    "jsonParse": _json_parse,
    "regexExtract": _regex_extract,
    "tableExtract": _table_extract,
    "rowLocate": _row_locate,
    "waitForVisible": _wait_visible,
    "waitForClickable": _wait_visible,
    "waitForNetworkIdle": _wait_network_idle,
    "waitForText": _wait_text,
    "tryCatch": _try_catch,
    "switchCase": _switch_case,
    "parallel": _parallel,
    "break": _break_node,
    "continue": _continue_node,
    "httpRequest": _http_request,
    "webhook": _http_request,
    "dbQuery": _db_query,
    "notify": _notify,
    "subflow": _subflow,
}


def get_executor(node_type: NodeType) -> NodeExecutor:
    executor = EXECUTORS.get(node_type)
    if executor is None:
        raise NodeExecutionError(
            code=NODE_EXECUTION_FAILED,
            message=f"Unsupported node type: {node_type}",
            details={"nodeType": node_type},
        )
    return executor
