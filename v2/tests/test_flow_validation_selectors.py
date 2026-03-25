from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ["RPA_RUNTIME_DIR"] = str(ROOT / ".test_runtime")
os.environ["RPA_TASK_SCHEDULER_ENABLED"] = "0"
API_ROOT = ROOT / "services" / "api"
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

HAS_API_IMPORT = True
try:
    from app.schemas.contracts import FlowModel  # noqa: E402
    from app.services.flow_validation import validate_flow_model  # noqa: E402
except ModuleNotFoundError:
    HAS_API_IMPORT = False


@unittest.skipUnless(HAS_API_IMPORT, "api dependencies are not installed")
class TestFlowValidationSelectors(unittest.TestCase):
    def _load_click_flow(self) -> dict[str, object]:
        flow_path = ROOT / "packages" / "flow-schema" / "examples" / "minimal.flow.json"
        payload = json.loads(flow_path.read_text(encoding="utf-8"))
        for node in payload["nodes"]:
            if node["id"] == "n_wait":
                node["type"] = "click"
                node["label"] = "Click button"
                node["config"] = {"selector": "#submit-btn"}
        return payload

    def test_click_selector_type_xpath_requires_prefix(self) -> None:
        payload = self._load_click_flow()
        for node in payload["nodes"]:
            if node["id"] == "n_wait":
                node["config"]["selectorType"] = "xpath"
                node["config"]["selector"] = "//button[@id='submit']".replace("//", "/")
        flow = FlowModel.model_validate(payload)
        errors = validate_flow_model(flow)
        self.assertTrue(any("prefixed with 'xpath='" in item for item in errors))

    def test_click_selector_type_xpath_with_prefix_is_valid(self) -> None:
        payload = self._load_click_flow()
        for node in payload["nodes"]:
            if node["id"] == "n_wait":
                node["config"]["selectorType"] = "xpath"
                node["config"]["selector"] = "xpath=//button[@id='submit']"
        flow = FlowModel.model_validate(payload)
        errors = validate_flow_model(flow)
        self.assertEqual(errors, [])

    def test_selector_type_must_be_known(self) -> None:
        payload = self._load_click_flow()
        for node in payload["nodes"]:
            if node["id"] == "n_wait":
                node["config"]["selectorType"] = "unknown"
        flow = FlowModel.model_validate(payload)
        errors = validate_flow_model(flow)
        self.assertTrue(any("config.selectorType must be one of" in item for item in errors))

    def test_selector_candidates_must_have_non_empty_value(self) -> None:
        payload = self._load_click_flow()
        for node in payload["nodes"]:
            if node["id"] == "n_wait":
                node["config"]["selectorCandidates"] = [{"type": "css", "value": ""}]
        flow = FlowModel.model_validate(payload)
        errors = validate_flow_model(flow)
        self.assertTrue(any("selectorCandidates[0].value must be non-empty string" in item for item in errors))

    def test_wait_state_must_be_known(self) -> None:
        payload = self._load_click_flow()
        for node in payload["nodes"]:
            if node["id"] == "n_wait":
                node["config"]["waitState"] = "unknown-state"
        flow = FlowModel.model_validate(payload)
        errors = validate_flow_model(flow)
        self.assertTrue(any("config.waitState must be one of" in item for item in errors))

    def test_wait_timeout_ms_must_be_positive_int(self) -> None:
        payload = self._load_click_flow()
        for node in payload["nodes"]:
            if node["id"] == "n_wait":
                node["config"]["waitTimeoutMs"] = 0
        flow = FlowModel.model_validate(payload)
        errors = validate_flow_model(flow)
        self.assertTrue(any("config.waitTimeoutMs must be int > 0" in item for item in errors))


if __name__ == "__main__":
    unittest.main()
