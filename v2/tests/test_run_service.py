from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path

from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
os.environ["RPA_RUNTIME_DIR"] = str(ROOT / ".test_runtime")
os.environ["RPA_TASK_SCHEDULER_ENABLED"] = "0"
API_ROOT = ROOT / "services" / "api"
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))
AGENT_ROOT = ROOT / "apps" / "agent"
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

HAS_IMPORT = True
try:
    from app.repositories.run_repository import run_repository  # noqa: E402
    from app.schemas.contracts import FlowModel, StartRunRequest  # noqa: E402
    from app.services.run_service import get_run, get_run_events, start_run, validate_flow  # noqa: E402
except ModuleNotFoundError:
    HAS_IMPORT = False


@unittest.skipUnless(HAS_IMPORT, "api or agent dependencies are not installed")
class TestRunService(unittest.TestCase):
    def setUp(self) -> None:
        run_repository.clear()

    def _load_minimal_flow(self) -> FlowModel:
        flow_path = ROOT / "packages" / "flow-schema" / "examples" / "minimal.flow.json"
        payload = json.loads(flow_path.read_text(encoding="utf-8"))
        return FlowModel.model_validate(payload)

    def test_start_run_persists_result(self) -> None:
        flow = self._load_minimal_flow()
        request = StartRunRequest(flow=flow)
        result = start_run(request)

        self.assertEqual(result.status, "success")
        stored = get_run(result.runId)
        self.assertEqual(stored.runId, result.runId)
        events = get_run_events(result.runId)
        self.assertGreater(len(events.events), 0)

    def test_start_run_invalid_flow_raises_http_400(self) -> None:
        flow = self._load_minimal_flow()
        flow.nodes = [node for node in flow.nodes if node.type != "start"]
        request = StartRunRequest(flow=flow)

        with self.assertRaises(HTTPException) as ctx:
            start_run(request)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail["code"], "FLOW_VALIDATION_FAILED")

    def test_validate_flow_normalizes_selector_type_mismatch(self) -> None:
        flow = self._load_minimal_flow()
        for node in flow.nodes:
            if node.id == "n_wait":
                node.type = "input"
                node.label = "Input"
                node.config = {
                    "selector": '[name="email"]',
                    "selectorType": "xpath",
                    "text": "demo",
                }
        result = validate_flow(flow)
        self.assertTrue(result.valid)
        self.assertEqual(result.errors, [])

    def test_start_run_normalizes_selector_type_mismatch_in_snapshot(self) -> None:
        flow = self._load_minimal_flow()
        for node in flow.nodes:
            if node.id == "n_wait":
                node.type = "input"
                node.label = "Input"
                node.config = {
                    "selector": '[name="email"]',
                    "selectorType": "xpath",
                    "text": "demo",
                }

        result = start_run(StartRunRequest(flow=flow))
        self.assertEqual(result.status, "success")
        snapshot = result.flowSnapshot
        self.assertIsNotNone(snapshot)
        assert snapshot is not None
        input_node = next((node for node in snapshot.nodes if node.id == "n_wait"), None)
        self.assertIsNotNone(input_node)
        assert input_node is not None
        self.assertEqual(input_node.config.get("selector"), '[name="email"]')
        self.assertEqual(input_node.config.get("selectorType"), "css")


if __name__ == "__main__":
    unittest.main()
