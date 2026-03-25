from __future__ import annotations

from collections import deque
import json

from app.schemas.contracts import FLOW_SCHEMA_VERSION, FlowEdge, FlowModel

SELECTOR_TYPES = {"css", "xpath", "text", "role", "playwright"}
SELECTOR_PREFIXES = {"xpath": "xpath=", "text": "text=", "role": "role="}
REQUIRED_SELECTOR_NODE_TYPES = {
    "click",
    "input",
    "extract",
    "hover",
    "doubleClick",
    "rightClick",
    "assertVisible",
    "waitForVisible",
    "waitForClickable",
    "select",
    "upload",
    "assertText",
    "assertCount",
    "tableExtract",
    "rowLocate",
    "waitForText",
}
OPTIONAL_SELECTOR_NODE_TYPES = {"scroll", "switchFrame"}
AUTO_WAIT_NODE_TYPES = {
    "click",
    "input",
    "extract",
    "hover",
    "doubleClick",
    "rightClick",
    "scroll",
    "select",
    "upload",
    "assertText",
    "assertCount",
}
WAIT_STATES = {"attached", "visible", "hidden", "detached", "enabled", "editable"}
IF_ALLOWED_OPERATORS = {
    "==",
    "eq",
    "equals",
    "equal",
    "!=",
    "<>",
    "ne",
    "not_equals",
    "not_equal",
    ">",
    "gt",
    ">=",
    "ge",
    "gte",
    "<",
    "lt",
    "<=",
    "le",
    "lte",
    "contains",
    "in",
    "exists",
    "empty",
    "regex",
    "matches",
    "truthy",
    "falsy",
}
IF_OPERATORS_NEED_RIGHT = {
    "==",
    "eq",
    "equals",
    "equal",
    "!=",
    "<>",
    "ne",
    "not_equals",
    "not_equal",
    ">",
    "gt",
    ">=",
    "ge",
    "gte",
    "<",
    "lt",
    "<=",
    "le",
    "lte",
    "contains",
    "in",
    "regex",
    "matches",
}


def _validate_selector_value(
    node_id: str,
    node_type: str,
    selector: str,
    selector_type: str | None,
    errors: list[str],
) -> None:
    if not selector_type:
        return
    prefix = SELECTOR_PREFIXES.get(selector_type)
    if not prefix:
        return
    if not selector.strip().lower().startswith(prefix):
        errors.append(
            f"Node {node_id} ({node_type}) expects config.selector prefixed with '{prefix}' "
            f"when config.selectorType is '{selector_type}'."
        )


def _validate_selector_config(
    node_id: str,
    node_type: str,
    config: dict[str, object],
    errors: list[str],
    *,
    required: bool,
) -> None:
    selector = config.get("selector")
    selector_type_raw = config.get("selectorType")

    if required and (not isinstance(selector, str) or not selector.strip()):
        errors.append(
            f"Node {node_id} ({node_type}) requires non-empty config.selector "
            "(supports css/xpath/text/role/playwright)."
        )
    if selector is not None and not isinstance(selector, str):
        errors.append(f"Node {node_id} ({node_type}) config.selector must be a string.")

    selector_type: str | None = None
    if selector_type_raw is not None:
        if not isinstance(selector_type_raw, str) or selector_type_raw not in SELECTOR_TYPES:
            errors.append(
                f"Node {node_id} ({node_type}) config.selectorType must be one of: "
                f"{', '.join(sorted(SELECTOR_TYPES))}."
            )
        else:
            selector_type = selector_type_raw

    if isinstance(selector, str) and selector.strip():
        _validate_selector_value(node_id, node_type, selector, selector_type, errors)

    selector_candidates = config.get("selectorCandidates")
    if selector_candidates is None:
        return
    if not isinstance(selector_candidates, list):
        errors.append(f"Node {node_id} ({node_type}) config.selectorCandidates must be a list.")
        return
    for index, candidate in enumerate(selector_candidates):
        if isinstance(candidate, str):
            if not candidate.strip():
                errors.append(f"Node {node_id} ({node_type}) selectorCandidates[{index}] must be non-empty.")
            continue
        if not isinstance(candidate, dict):
            errors.append(f"Node {node_id} ({node_type}) selectorCandidates[{index}] must be string or object.")
            continue
        value = candidate.get("value")
        candidate_type_raw = candidate.get("type")
        if not isinstance(value, str) or not value.strip():
            errors.append(
                f"Node {node_id} ({node_type}) selectorCandidates[{index}].value must be non-empty string."
            )
            continue
        candidate_type: str | None = None
        if candidate_type_raw is not None:
            if not isinstance(candidate_type_raw, str) or candidate_type_raw not in SELECTOR_TYPES:
                errors.append(
                    f"Node {node_id} ({node_type}) selectorCandidates[{index}].type must be one of: "
                    f"{', '.join(sorted(SELECTOR_TYPES))}."
                )
            else:
                candidate_type = candidate_type_raw
        _validate_selector_value(
            node_id,
            node_type,
            value,
            candidate_type,
            errors,
        )


def _validate_node_config(flow: FlowModel, errors: list[str]) -> None:
    for node in flow.nodes:
        config = node.config
        if node.type in AUTO_WAIT_NODE_TYPES:
            auto_wait = config.get("autoWait")
            if auto_wait is not None and not isinstance(auto_wait, bool):
                errors.append(f"Node {node.id} ({node.type}) config.autoWait must be boolean.")
            wait_state = config.get("waitState")
            if wait_state is not None:
                if not isinstance(wait_state, str) or wait_state.strip().lower() not in WAIT_STATES:
                    errors.append(
                        f"Node {node.id} ({node.type}) config.waitState must be one of: "
                        f"{', '.join(sorted(WAIT_STATES))}."
                    )
            wait_timeout_ms = config.get("waitTimeoutMs")
            if wait_timeout_ms is not None and (not isinstance(wait_timeout_ms, int) or wait_timeout_ms <= 0):
                errors.append(f"Node {node.id} ({node.type}) config.waitTimeoutMs must be int > 0.")

        if node.type in REQUIRED_SELECTOR_NODE_TYPES:
            _validate_selector_config(node.id, node.type, config, errors, required=True)
        elif node.type in OPTIONAL_SELECTOR_NODE_TYPES:
            _validate_selector_config(node.id, node.type, config, errors, required=False)

        if node.type == "navigate":
            url = config.get("url")
            if not isinstance(url, str) or not url.strip():
                errors.append(f"Node {node.id} (navigate) requires non-empty config.url.")
        elif node.type == "wait":
            wait_ms = config.get("ms")
            if not isinstance(wait_ms, int) or wait_ms < 0:
                errors.append(f"Node {node.id} (wait) requires config.ms >= 0.")
        elif node.type == "input":
            text_value = config.get("text", config.get("value"))
            if not isinstance(text_value, str):
                errors.append(f"Node {node.id} (input) requires string config.text or config.value.")
        elif node.type == "if":
            has_legacy = "expression" in config or "value" in config
            has_structured = (
                isinstance(config.get("operator"), str)
                and bool(config.get("operator", "").strip())
            ) or config.get("left") is not None or config.get("right") is not None
            if not has_legacy and not has_structured:
                errors.append(
                    f"Node {node.id} (if) requires legacy config.expression/config.value or structured config.left/config.operator."
                )
            operator = config.get("operator")
            if isinstance(operator, str) and operator.strip():
                normalized = operator.strip().lower()
                if normalized not in IF_ALLOWED_OPERATORS:
                    errors.append(
                        f"Node {node.id} (if) config.operator is invalid: {operator}."
                    )
                elif normalized in IF_OPERATORS_NEED_RIGHT and config.get("right") is None:
                    errors.append(
                        f"Node {node.id} (if) config.right is required when operator is '{operator}'."
                    )
        elif node.type == "loop":
            source = config.get("source")
            has_source = source is not None and (not isinstance(source, str) or bool(source.strip()))
            if not has_source:
                times = config.get("times")
                if not isinstance(times, int) or times < 1:
                    errors.append(f"Node {node.id} (loop) requires config.times >= 1 when config.source is empty.")
            item_var = config.get("itemVar")
            if item_var is not None and not isinstance(item_var, str):
                errors.append(f"Node {node.id} (loop) config.itemVar must be string when provided.")
            index_var = config.get("indexVar")
            if index_var is not None and not isinstance(index_var, str):
                errors.append(f"Node {node.id} (loop) config.indexVar must be string when provided.")
        elif node.type == "rowLocate":
            match_mode = config.get("matchMode", "index")
            normalized_mode = match_mode.strip().lower() if isinstance(match_mode, str) else ""
            if normalized_mode not in {"index", "contains", "equals", "regex"}:
                errors.append(f"Node {node.id} (rowLocate) config.matchMode must be one of: index/contains/equals/regex.")
            row_index = config.get("rowIndex")
            if row_index is not None and (not isinstance(row_index, int) or row_index < 0):
                errors.append(f"Node {node.id} (rowLocate) config.rowIndex must be int >= 0.")
            column_index = config.get("columnIndex")
            if column_index is not None and (not isinstance(column_index, int) or column_index < -1):
                errors.append(f"Node {node.id} (rowLocate) config.columnIndex must be int >= -1.")
            rules_logic = config.get("rulesLogic")
            if rules_logic is not None and (
                not isinstance(rules_logic, str) or rules_logic.strip().lower() not in {"all", "any"}
            ):
                errors.append(f"Node {node.id} (rowLocate) config.rulesLogic must be one of: all/any.")
            on_not_found = config.get("onNotFound")
            if on_not_found is not None and (
                not isinstance(on_not_found, str) or on_not_found.strip().lower() not in {"fail", "branch"}
            ):
                errors.append(f"Node {node.id} (rowLocate) config.onNotFound must be one of: fail/branch.")

            raw_match_rules = config.get("matchRules")
            match_rules: list[object] = []
            if isinstance(raw_match_rules, list):
                match_rules = list(raw_match_rules)
            elif isinstance(raw_match_rules, dict):
                match_rules = [raw_match_rules]
            elif isinstance(raw_match_rules, str):
                text = raw_match_rules.strip()
                if text:
                    try:
                        parsed = json.loads(text)
                    except json.JSONDecodeError:
                        errors.append(f"Node {node.id} (rowLocate) config.matchRules must be valid JSON when string is provided.")
                    else:
                        if isinstance(parsed, list):
                            match_rules = list(parsed)
                        elif isinstance(parsed, dict):
                            match_rules = [parsed]
                        else:
                            errors.append(f"Node {node.id} (rowLocate) config.matchRules must decode to list/dict.")
            elif raw_match_rules is not None:
                errors.append(f"Node {node.id} (rowLocate) config.matchRules must be list/dict/string when provided.")

            has_valid_match_rule = False
            for index, rule in enumerate(match_rules):
                if not isinstance(rule, dict):
                    errors.append(f"Node {node.id} (rowLocate) config.matchRules[{index}] must be object.")
                    continue
                rule_mode = rule.get("mode", "contains")
                normalized_rule_mode = rule_mode.strip().lower() if isinstance(rule_mode, str) else ""
                if normalized_rule_mode not in {"contains", "equals", "regex"}:
                    errors.append(
                        f"Node {node.id} (rowLocate) config.matchRules[{index}].mode must be one of: contains/equals/regex."
                    )
                rule_text = rule.get("text")
                if not isinstance(rule_text, str) or not rule_text:
                    errors.append(f"Node {node.id} (rowLocate) config.matchRules[{index}].text must be non-empty string.")
                else:
                    has_valid_match_rule = True
                rule_column_index = rule.get("columnIndex")
                if rule_column_index is not None:
                    parsed_column_index: int | None = None
                    if isinstance(rule_column_index, int):
                        parsed_column_index = rule_column_index
                    elif isinstance(rule_column_index, str) and rule_column_index.strip().lstrip("-").isdigit():
                        parsed_column_index = int(rule_column_index.strip())
                    if parsed_column_index is None or parsed_column_index < -1:
                        errors.append(f"Node {node.id} (rowLocate) config.matchRules[{index}].columnIndex must be int >= -1.")
                rule_case_sensitive = rule.get("caseSensitive")
                if rule_case_sensitive is not None and not isinstance(rule_case_sensitive, bool):
                    errors.append(f"Node {node.id} (rowLocate) config.matchRules[{index}].caseSensitive must be boolean.")

            text = config.get("text")
            if normalized_mode in {"contains", "equals", "regex"} and not has_valid_match_rule:
                if not isinstance(text, str) or not text:
                    errors.append(
                        f"Node {node.id} (rowLocate) config.text must be non-empty string when matchMode is {normalized_mode} and matchRules is empty."
                    )


def _validate_graph(flow: FlowModel, errors: list[str]) -> None:
    node_ids: set[str] = set()
    edge_ids: set[str] = set()
    outgoing: dict[str, list[str]] = {}
    outgoing_edges: dict[str, list[FlowEdge]] = {}
    incoming_count: dict[str, int] = {}

    for node in flow.nodes:
        if node.id in node_ids:
            errors.append(f"Duplicate node id found: {node.id}")
        node_ids.add(node.id)
        outgoing[node.id] = []
        outgoing_edges[node.id] = []
        incoming_count[node.id] = 0

    for edge in flow.edges:
        if edge.id in edge_ids:
            errors.append(f"Duplicate edge id found: {edge.id}")
        edge_ids.add(edge.id)

        if edge.source not in node_ids:
            errors.append(f"Edge {edge.id} source node not found: {edge.source}")
            continue
        if edge.target not in node_ids:
            errors.append(f"Edge {edge.id} target node not found: {edge.target}")
            continue
        outgoing[edge.source].append(edge.target)
        outgoing_edges[edge.source].append(edge)
        incoming_count[edge.target] += 1

    start_nodes = [node for node in flow.nodes if node.type == "start"]
    end_nodes = [node for node in flow.nodes if node.type == "end"]
    if len(start_nodes) != 1:
        errors.append("Flow must contain exactly one start node.")
        return
    if len(end_nodes) < 1:
        errors.append("Flow must contain at least one end node.")
        return

    start_id = start_nodes[0].id
    if incoming_count[start_id] > 0:
        errors.append("Start node must not have incoming edges.")

    for node in end_nodes:
        if outgoing.get(node.id):
            errors.append(f"End node {node.id} must not have outgoing edges.")

    visited: set[str] = set()
    queue: deque[str] = deque([start_id])
    while queue:
        node_id = queue.popleft()
        if node_id in visited:
            continue
        visited.add(node_id)
        for next_id in outgoing.get(node_id, []):
            if next_id not in visited:
                queue.append(next_id)

    unreachable = sorted(node_ids - visited)
    for node_id in unreachable:
        errors.append(f"Node {node_id} is unreachable from start node.")

    if not any(node.id in visited for node in end_nodes):
        errors.append("No end node is reachable from start node.")

    for node in flow.nodes:
        node_outgoing_edges = outgoing_edges.get(node.id, [])
        if node.type != "start" and incoming_count.get(node.id, 0) == 0:
            errors.append(f"Node {node.id} has no incoming edge.")
        if node.type != "end" and not outgoing.get(node.id):
            errors.append(f"Node {node.id} has no outgoing edge.")
        out_count = len(outgoing.get(node.id, []))
        if node.type == "if" and out_count < 1:
            errors.append(f"Node {node.id} (if) must have at least one outgoing edge.")
        if node.type == "loop" and out_count < 1:
            errors.append(f"Node {node.id} (loop) must have at least one outgoing edge.")
        if node.type == "if":
            branch_counts = {"true": 0, "false": 0}
            for edge in node_outgoing_edges:
                condition = getattr(edge, "condition", None)
                normalized = condition.strip().lower() if isinstance(condition, str) else ""
                if normalized in branch_counts:
                    branch_counts[normalized] += 1
            for branch, count in branch_counts.items():
                if count > 1:
                    errors.append(f"Node {node.id} (if) has duplicated '{branch}' branch edges.")
        if node.type == "loop":
            branch_counts = {"body": 0, "exit": 0}
            for edge in node_outgoing_edges:
                condition = getattr(edge, "condition", None)
                normalized = condition.strip().lower() if isinstance(condition, str) else ""
                if normalized in branch_counts:
                    branch_counts[normalized] += 1
            for branch, count in branch_counts.items():
                if count > 1:
                    errors.append(f"Node {node.id} (loop) has duplicated '{branch}' branch edges.")
        if node.type == "switchCase":
            seen_case: set[str] = set()
            for edge in node_outgoing_edges:
                condition = getattr(edge, "condition", None)
                normalized = condition.strip().lower() if isinstance(condition, str) else ""
                if not normalized:
                    continue
                if normalized in seen_case:
                    errors.append(f"Node {node.id} (switchCase) has duplicated '{normalized}' branch edges.")
                    break
                seen_case.add(normalized)
        if node.type == "rowLocate":
            branch_counts = {"found": 0, "notfound": 0}
            for edge in node_outgoing_edges:
                condition = getattr(edge, "condition", None)
                normalized = condition.strip().lower() if isinstance(condition, str) else ""
                if normalized in branch_counts:
                    branch_counts[normalized] += 1
            for branch, count in branch_counts.items():
                if count > 1:
                    errors.append(f"Node {node.id} (rowLocate) has duplicated '{branch}' branch edges.")


def validate_flow_model(flow: FlowModel) -> list[str]:
    errors: list[str] = []

    if flow.schemaVersion != FLOW_SCHEMA_VERSION:
        errors.append(f"Unsupported schemaVersion, expected {FLOW_SCHEMA_VERSION}")
    _validate_graph(flow, errors)
    _validate_node_config(flow, errors)

    return errors
