from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
AGENT_ROOT = ROOT / "apps" / "agent"
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

HAS_AGENT_IMPORT = True
try:
    from agent.models.error_codes import BROWSER_STARTUP_FAILED, ELEMENT_NOT_FOUND  # noqa: E402
    from agent.models.contracts import RunOptions  # noqa: E402
    from agent.runtime.browser_session import BrowserActionError  # noqa: E402
    from agent.runtime.engine import run_flow  # noqa: E402
except ModuleNotFoundError:
    HAS_AGENT_IMPORT = False


@unittest.skipUnless(HAS_AGENT_IMPORT, "agent dependencies are not installed")
class TestAgentEngine(unittest.TestCase):
    def _load_minimal_flow(self) -> dict[str, object]:
        flow_path = ROOT / "packages" / "flow-schema" / "examples" / "minimal.flow.json"
        return json.loads(flow_path.read_text(encoding="utf-8"))

    def test_run_flow_returns_events(self) -> None:
        payload = self._load_minimal_flow()
        result = run_flow(payload)

        self.assertEqual(result.status, "success")
        self.assertGreater(len(result.events), 0)
        self.assertTrue(result.runId.startswith("run_"))
        self.assertIsNotNone(result.startedAt)

    def test_timeout_with_retries_transitions_to_failed(self) -> None:
        payload = self._load_minimal_flow()
        for node in payload["nodes"]:
            if node["type"] == "wait":
                node["config"]["timeoutMs"] = 100
                node["config"]["maxRetries"] = 1
                node["config"]["ms"] = 500
        result = run_flow(payload)

        self.assertEqual(result.status, "failed")
        timeout_events = [event for event in result.events if event.data.get("errorCode") == "NODE_TIMEOUT"]
        self.assertGreaterEqual(len(timeout_events), 2)

    def test_if_branch_selects_true_path(self) -> None:
        payload = {
            "schemaVersion": "1.0.0",
            "id": "flow_if",
            "name": "if flow",
            "variables": {"flag": True},
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {"id": "if1", "type": "if", "config": {"expression": "{{flag}}"}},
                {"id": "true_end", "type": "end", "config": {}},
                {"id": "false_end", "type": "end", "config": {}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "if1"},
                {"id": "e2", "source": "if1", "target": "true_end", "condition": "true"},
                {"id": "e3", "source": "if1", "target": "false_end", "condition": "false"},
            ],
        }
        result = run_flow(payload)

        self.assertEqual(result.status, "success")
        executed_ids = [event.nodeId for event in result.events if event.level == "info"]
        self.assertIn("true_end", executed_ids)
        self.assertNotIn("false_end", executed_ids)

    def test_if_structured_equals_selects_true_path(self) -> None:
        payload = {
            "schemaVersion": "1.0.0",
            "id": "flow_if_struct_eq",
            "name": "if structured equals",
            "variables": {"status": "success"},
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "if1",
                    "type": "if",
                    "config": {"left": "{{status}}", "operator": "eq", "right": "success"},
                },
                {"id": "true_end", "type": "end", "config": {}},
                {"id": "false_end", "type": "end", "config": {}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "if1"},
                {"id": "e2", "source": "if1", "target": "true_end", "condition": "true"},
                {"id": "e3", "source": "if1", "target": "false_end", "condition": "false"},
            ],
        }
        result = run_flow(payload)

        self.assertEqual(result.status, "success")
        executed_ids = [event.nodeId for event in result.events if event.level == "info"]
        self.assertIn("true_end", executed_ids)
        self.assertNotIn("false_end", executed_ids)

    def test_if_structured_numeric_compare(self) -> None:
        payload = {
            "schemaVersion": "1.0.0",
            "id": "flow_if_struct_gt",
            "name": "if structured gt",
            "variables": {"score": 92},
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "if1",
                    "type": "if",
                    "config": {"left": "{{score}}", "operator": "gt", "right": 90},
                },
                {"id": "true_end", "type": "end", "config": {}},
                {"id": "false_end", "type": "end", "config": {}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "if1"},
                {"id": "e2", "source": "if1", "target": "true_end", "condition": "true"},
                {"id": "e3", "source": "if1", "target": "false_end", "condition": "false"},
            ],
        }
        result = run_flow(payload)

        self.assertEqual(result.status, "success")
        if_event = next((event for event in result.events if event.nodeId == "if1" and event.level == "info"), None)
        self.assertIsNotNone(if_event)
        self.assertEqual(if_event.data.get("operator"), "gt")
        self.assertEqual(if_event.data.get("mode"), "structured")
        self.assertTrue(if_event.data.get("bool"))

    def test_set_variable_boolean_normalize_drives_if(self) -> None:
        payload = {
            "schemaVersion": "1.0.0",
            "id": "flow_set_normalize_bool",
            "name": "set variable normalize bool",
            "variables": {},
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "set_status",
                    "type": "setVariable",
                    "config": {"key": "loginStatus", "value": "SUCCESS"},
                },
                {
                    "id": "set_bool",
                    "type": "setVariable",
                    "config": {
                        "key": "isLoginOk",
                        "source": "{{loginStatus}}",
                        "normalizeAs": "boolean",
                        "trueValues": "success,ok,passed",
                        "falseValues": "failed,error",
                        "defaultBoolean": "false",
                    },
                },
                {"id": "if1", "type": "if", "config": {"expression": "{{isLoginOk}}"}},
                {"id": "true_end", "type": "end", "config": {}},
                {"id": "false_end", "type": "end", "config": {}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "set_status"},
                {"id": "e2", "source": "set_status", "target": "set_bool"},
                {"id": "e3", "source": "set_bool", "target": "if1"},
                {"id": "e4", "source": "if1", "target": "true_end", "condition": "true"},
                {"id": "e5", "source": "if1", "target": "false_end", "condition": "false"},
            ],
        }
        result = run_flow(payload)

        self.assertEqual(result.status, "success")
        executed_ids = [event.nodeId for event in result.events if event.level == "info"]
        self.assertIn("true_end", executed_ids)
        self.assertNotIn("false_end", executed_ids)

    def test_loop_executes_and_exits(self) -> None:
        payload = {
            "schemaVersion": "1.0.0",
            "id": "flow_loop",
            "name": "loop flow",
            "variables": {},
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {"id": "loop1", "type": "loop", "config": {"times": 3}},
                {"id": "wait1", "type": "wait", "config": {"ms": 1}},
                {"id": "end", "type": "end", "config": {}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "loop1"},
                {"id": "e2", "source": "loop1", "target": "wait1", "condition": "body"},
                {"id": "e3", "source": "wait1", "target": "loop1"},
                {"id": "e4", "source": "loop1", "target": "end", "condition": "exit"},
            ],
        }
        result = run_flow(payload, options=RunOptions(maxSteps=50))

        self.assertEqual(result.status, "success")
        loop_infos = [event for event in result.events if event.nodeId == "loop1" and event.level == "info"]
        self.assertEqual(len(loop_infos), 3)

    def test_run_can_be_canceled(self) -> None:
        payload = self._load_minimal_flow()
        called = {"count": 0}

        def should_cancel() -> bool:
            called["count"] += 1
            return called["count"] >= 2

        result = run_flow(payload, should_cancel=should_cancel)
        self.assertEqual(result.status, "canceled")
        self.assertTrue(any(event.data.get("errorCode") == "RUN_CANCELED" for event in result.events))

    def test_simulate_browser_mode_marks_real_browser_false(self) -> None:
        payload = self._load_minimal_flow()
        payload.setdefault("variables", {})["_browserMode"] = "simulate"
        result = run_flow(payload)

        self.assertEqual(result.status, "success")
        navigate_events = [event for event in result.events if event.nodeType == "navigate" and event.level == "info"]
        self.assertGreaterEqual(len(navigate_events), 1)
        self.assertTrue(all(event.data.get("realBrowser") is False for event in navigate_events))

    def test_selector_candidates_can_drive_click_in_simulation(self) -> None:
        payload = {
            "schemaVersion": "1.0.0",
            "id": "flow_candidates",
            "name": "selector candidate flow",
            "variables": {"_browserMode": "simulate"},
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "click1",
                    "type": "click",
                    "config": {"selectorCandidates": [{"value": "[data-testid='submit']", "score": 0.9}]},
                },
                {"id": "end", "type": "end", "config": {}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "click1"},
                {"id": "e2", "source": "click1", "target": "end"},
            ],
        }
        result = run_flow(payload)

        self.assertEqual(result.status, "success")
        click_event = next(event for event in result.events if event.nodeId == "click1" and event.level == "info")
        self.assertEqual(click_event.data.get("selector"), "[data-testid='submit']")

    def test_row_locate_node_runs_in_simulation(self) -> None:
        payload = {
            "schemaVersion": "1.0.0",
            "id": "flow_row_locate",
            "name": "row locate flow",
            "variables": {"_browserMode": "simulate"},
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "row1",
                    "type": "rowLocate",
                    "config": {
                        "selector": "table.user-list",
                        "rowSelector": "tr",
                        "matchMode": "index",
                        "rowIndex": 2,
                        "var": "selectedRow",
                    },
                },
                {"id": "end", "type": "end", "config": {}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "row1"},
                {"id": "e2", "source": "row1", "target": "end"},
            ],
        }
        result = run_flow(payload)

        self.assertEqual(result.status, "success")
        row_event = next(event for event in result.events if event.nodeId == "row1" and event.level == "info")
        self.assertEqual(row_event.data.get("rowIndex"), 2)
        self.assertEqual(row_event.data.get("rowSelector"), "table.user-list tr:nth-of-type(3)")

    def test_row_locate_not_found_routes_not_found_branch(self) -> None:
        payload = {
            "schemaVersion": "1.0.0",
            "id": "flow_row_locate_not_found",
            "name": "row locate not found flow",
            "variables": {"_browserMode": "real"},
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "row1",
                    "type": "rowLocate",
                    "config": {
                        "selector": "table.user-list",
                        "matchMode": "contains",
                        "text": "missing",
                        "onNotFound": "branch",
                    },
                },
                {"id": "found_end", "type": "end", "config": {}},
                {"id": "not_found_end", "type": "end", "config": {}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "row1"},
                {"id": "e2", "source": "row1", "target": "found_end", "condition": "found"},
                {"id": "e3", "source": "row1", "target": "not_found_end", "condition": "notFound"},
            ],
        }

        with patch(
            "agent.runtime.browser_session.BrowserSession.locate_row",
            side_effect=BrowserActionError(
                code=ELEMENT_NOT_FOUND,
                message="not found",
                details={"reason": "No matching row found.", "durationMs": 12},
            ),
        ):
            result = run_flow(payload)

        self.assertEqual(result.status, "success")
        executed_ids = [event.nodeId for event in result.events if event.level == "info"]
        self.assertIn("not_found_end", executed_ids)
        self.assertNotIn("found_end", executed_ids)
        row_event = next(event for event in result.events if event.nodeId == "row1" and event.level == "info")
        self.assertFalse(row_event.data.get("found"))
        self.assertEqual(row_event.data.get("branch"), "notFound")

    def test_row_locate_resolves_match_rules_payload(self) -> None:
        payload = {
            "schemaVersion": "1.0.0",
            "id": "flow_row_locate_rules",
            "name": "row locate rules flow",
            "variables": {"_browserMode": "real"},
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "row1",
                    "type": "rowLocate",
                    "config": {
                        "selector": "table.user-list",
                        "matchMode": "contains",
                        "rulesLogic": "any",
                        "matchRules": '[{"mode":"contains","text":"alice","columnIndex":"1"},{"mode":"equals","text":"active","columnIndex":2,"caseSensitive":true}]',
                        "onNotFound": "branch",
                    },
                },
                {"id": "end", "type": "end", "config": {}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "row1"},
                {"id": "e2", "source": "row1", "target": "end", "condition": "found"},
            ],
        }
        captured: dict[str, object] = {}

        def fake_locate_row(self, selectors, timeout_ms, **kwargs):
            captured["selectors"] = selectors
            captured["timeout_ms"] = timeout_ms
            captured["kwargs"] = kwargs
            return (
                9,
                selectors[0],
                {
                    "rowIndex": 0,
                    "rowCount": 2,
                    "rowSelector": "table.user-list tr:nth-of-type(1)",
                    "row": ["alice", "active"],
                    "rowText": "alice active",
                    "matchMode": "contains",
                    "rulesLogic": "any",
                },
            )

        with patch("agent.runtime.browser_session.BrowserSession.locate_row", new=fake_locate_row):
            result = run_flow(payload)

        self.assertEqual(result.status, "success")
        kwargs = captured.get("kwargs")
        self.assertIsInstance(kwargs, dict)
        self.assertEqual(kwargs.get("rules_logic"), "any")
        match_rules = kwargs.get("match_rules")
        self.assertIsInstance(match_rules, list)
        self.assertEqual(len(match_rules), 2)
        self.assertEqual(match_rules[0].get("columnIndex"), 1)
        self.assertEqual(match_rules[1].get("mode"), "equals")
        self.assertTrue(match_rules[1].get("caseSensitive"))

    def test_env_browser_mode_simulate(self) -> None:
        payload = self._load_minimal_flow()
        original = os.environ.get("RPA_AGENT_BROWSER_MODE")
        os.environ["RPA_AGENT_BROWSER_MODE"] = "simulate"
        try:
            result = run_flow(payload)
        finally:
            if original is None:
                os.environ.pop("RPA_AGENT_BROWSER_MODE", None)
            else:
                os.environ["RPA_AGENT_BROWSER_MODE"] = original

        self.assertEqual(result.status, "success")
        runtime_event = next((event for event in result.events if event.nodeId == "runtime"), None)
        self.assertIsNotNone(runtime_event)
        self.assertEqual(runtime_event.data.get("browserMode"), "simulate")

    def test_pause_after_each_node_generates_debug_pause(self) -> None:
        payload = self._load_minimal_flow()
        payload.setdefault("variables", {})["_browserMode"] = "simulate"
        result = run_flow(payload, options=RunOptions(pauseAfterEachNode=True))

        self.assertEqual(result.status, "canceled")
        pause_event = next((event for event in result.events if event.data.get("errorCode") == "RUN_DEBUG_PAUSED"), None)
        self.assertIsNotNone(pause_event)
        self.assertEqual(pause_event.data.get("pauseType"), "step")

    def test_breakpoint_node_generates_debug_pause(self) -> None:
        payload = self._load_minimal_flow()
        payload.setdefault("variables", {})["_browserMode"] = "simulate"
        result = run_flow(payload, options=RunOptions(breakpointNodeIds=["n_nav"]))

        self.assertEqual(result.status, "canceled")
        pause_event = next((event for event in result.events if event.data.get("errorCode") == "RUN_DEBUG_PAUSED"), None)
        self.assertIsNotNone(pause_event)
        self.assertEqual(pause_event.data.get("pauseType"), "breakpoint")
        self.assertEqual(pause_event.data.get("pausedNodeId"), "n_nav")

    def test_error_edge_routes_to_catch(self) -> None:
        payload = {
            "schemaVersion": "1.0.0",
            "id": "flow_catch",
            "name": "catch flow",
            "variables": {"_browserMode": "simulate"},
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {"id": "set_fail", "type": "setVariable", "config": {"key": "actual", "value": "x"}},
                {"id": "assert_fail", "type": "click", "config": {}},
                {"id": "catch_set", "type": "setVariable", "config": {"key": "caught", "value": "yes"}},
                {"id": "end", "type": "end", "config": {}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "set_fail"},
                {"id": "e2", "source": "set_fail", "target": "assert_fail"},
                {"id": "e3", "source": "assert_fail", "target": "catch_set", "condition": "catch"},
                {"id": "e4", "source": "catch_set", "target": "end"},
            ],
        }
        result = run_flow(payload)
        self.assertEqual(result.status, "success")
        messages = [event.message for event in result.events]
        self.assertTrue(any("routed to catch edge" in msg for msg in messages))

    def test_subflow_node_executes_inline_payload(self) -> None:
        payload = {
            "schemaVersion": "1.0.0",
            "id": "flow_subflow_parent",
            "name": "subflow parent",
            "variables": {"_browserMode": "simulate"},
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "sub1",
                    "type": "subflow",
                    "config": {
                        "flow": {
                            "schemaVersion": "1.0.0",
                            "id": "flow_child",
                            "name": "child",
                            "variables": {"_browserMode": "simulate"},
                            "nodes": [
                                {"id": "c_start", "type": "start", "config": {}},
                                {"id": "c_wait", "type": "wait", "config": {"ms": 1}},
                                {"id": "c_end", "type": "end", "config": {}},
                            ],
                            "edges": [
                                {"id": "ce1", "source": "c_start", "target": "c_wait"},
                                {"id": "ce2", "source": "c_wait", "target": "c_end"},
                            ],
                        }
                    },
                },
                {"id": "end", "type": "end", "config": {}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "sub1"},
                {"id": "e2", "source": "sub1", "target": "end"},
            ],
        }
        result = run_flow(payload)
        self.assertEqual(result.status, "success")
        sub_event = next((event for event in result.events if event.nodeId == "sub1" and event.level == "info"), None)
        self.assertIsNotNone(sub_event)
        self.assertIn("subRunId", sub_event.data)

    def test_subflow_can_run_katalon_payload(self) -> None:
        payload = {
            "schemaVersion": "1.0.0",
            "id": "flow_katalon_subflow",
            "name": "katalon subflow",
            "variables": {"katalonProjectPath": "C:/katalon/project"},
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "sub_katalon",
                    "type": "subflow",
                    "config": {
                        "timeoutMs": 600000,
                        "katalon": {
                            "command": "katalonc",
                            "projectPath": "{{katalonProjectPath}}",
                            "testSuitePath": "Test Suites/Smoke",
                            "executionProfile": "default",
                        },
                    },
                },
                {"id": "end", "type": "end", "config": {}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "sub_katalon"},
                {"id": "e2", "source": "sub_katalon", "target": "end"},
            ],
        }
        with patch(
            "agent.executors.registry.run_katalon",
            return_value={
                "success": True,
                "exitCode": 0,
                "durationMs": 3210,
                "projectPath": "C:/katalon/project",
                "testSuitePath": "Test Suites/Smoke",
                "testSuiteCollectionPath": None,
                "reportFolder": "Reports/latest",
            },
        ) as mocked:
            result = run_flow(payload)

        mocked.assert_called_once()
        self.assertEqual(result.status, "success")
        info_event = next((event for event in result.events if event.nodeId == "sub_katalon" and event.level == "info"), None)
        self.assertIsNotNone(info_event)
        self.assertEqual(info_event.data.get("engine"), "katalon")

    def test_browser_startup_fallback_to_simulate(self) -> None:
        payload = self._load_minimal_flow()
        payload.setdefault("variables", {})["_browserMode"] = "real"
        payload["variables"]["_browserHeadless"] = True
        payload["variables"]["_browserStartupFallback"] = True

        startup_error = BrowserActionError(
            code=BROWSER_STARTUP_FAILED,
            message="mock startup failed",
            details={"reason": "mock"},
        )
        with patch("agent.runtime.browser_session.BrowserSession.navigate", side_effect=startup_error):
            result = run_flow(payload)

        self.assertEqual(result.status, "success")
        degrade_event = next(
            (
                event
                for event in result.events
                if event.data.get("errorCode") == BROWSER_STARTUP_FAILED and event.data.get("degradedTo") == "simulate"
            ),
            None,
        )
        self.assertIsNotNone(degrade_event)


if __name__ == "__main__":
    unittest.main()
