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
    from app.services.flow_migration import FlowMigrationError  # noqa: E402
    from app.services.flow_migration import migrate_flow_model  # noqa: E402
    from app.services.flow_validation import validate_flow_model  # noqa: E402
except ModuleNotFoundError:
    HAS_API_IMPORT = False


@unittest.skipUnless(HAS_API_IMPORT, "api dependencies are not installed")
class TestFlowValidation(unittest.TestCase):
    def _load_minimal_flow(self) -> dict[str, object]:
        flow_path = ROOT / "packages" / "flow-schema" / "examples" / "minimal.flow.json"
        return json.loads(flow_path.read_text(encoding="utf-8"))

    def test_minimal_flow_is_valid(self) -> None:
        payload = self._load_minimal_flow()
        flow = FlowModel.model_validate(payload)
        errors = validate_flow_model(flow)
        self.assertEqual(errors, [])

    def test_missing_start_is_invalid(self) -> None:
        payload = self._load_minimal_flow()
        payload["nodes"] = [node for node in payload["nodes"] if node["type"] != "start"]
        flow = FlowModel.model_validate(payload)
        errors = validate_flow_model(flow)
        self.assertTrue(any("start node" in item for item in errors))

    def test_duplicate_node_id_is_invalid(self) -> None:
        payload = self._load_minimal_flow()
        payload["nodes"].append(
            {
                "id": "n_wait",
                "type": "wait",
                "label": "dup",
                "config": {"ms": 1},
            }
        )
        flow = FlowModel.model_validate(payload)
        errors = validate_flow_model(flow)
        self.assertTrue(any("Duplicate node id" in item for item in errors))

    def test_unreachable_node_is_invalid(self) -> None:
        payload = self._load_minimal_flow()
        payload["nodes"].append(
            {
                "id": "n_orphan",
                "type": "wait",
                "label": "orphan",
                "config": {"ms": 1},
            }
        )
        flow = FlowModel.model_validate(payload)
        errors = validate_flow_model(flow)
        self.assertTrue(any("unreachable" in item for item in errors))

    def test_unsupported_schema_version_fails_migration(self) -> None:
        payload = self._load_minimal_flow()
        payload["schemaVersion"] = "0.9.0"
        flow = FlowModel.model_validate(payload)
        with self.assertRaises(FlowMigrationError):
            migrate_flow_model(flow)

    def test_if_duplicate_true_branch_is_invalid(self) -> None:
        payload = self._load_minimal_flow()
        payload["nodes"] = [
            {"id": "n_start", "type": "start", "label": "Start", "config": {}},
            {"id": "n_if", "type": "if", "label": "If", "config": {"expression": "{{flag}}"}},
            {"id": "n_wait_a", "type": "wait", "label": "A", "config": {"ms": 1}},
            {"id": "n_wait_b", "type": "wait", "label": "B", "config": {"ms": 1}},
            {"id": "n_end", "type": "end", "label": "End", "config": {}},
        ]
        payload["edges"] = [
            {"id": "e1", "source": "n_start", "target": "n_if"},
            {"id": "e2", "source": "n_if", "target": "n_wait_a", "condition": "true"},
            {"id": "e3", "source": "n_if", "target": "n_wait_b", "condition": "true"},
            {"id": "e4", "source": "n_wait_a", "target": "n_end"},
            {"id": "e5", "source": "n_wait_b", "target": "n_end"},
        ]
        flow = FlowModel.model_validate(payload)
        errors = validate_flow_model(flow)
        self.assertTrue(any("duplicated 'true' branch" in item for item in errors))

    def test_if_structured_condition_is_valid(self) -> None:
        payload = self._load_minimal_flow()
        payload["nodes"] = [
            {"id": "n_start", "type": "start", "label": "Start", "config": {}},
            {
                "id": "n_if",
                "type": "if",
                "label": "If",
                "config": {"left": "{{status}}", "operator": "eq", "right": "success"},
            },
            {"id": "n_wait", "type": "wait", "label": "Wait", "config": {"ms": 1}},
            {"id": "n_end", "type": "end", "label": "End", "config": {}},
        ]
        payload["edges"] = [
            {"id": "e1", "source": "n_start", "target": "n_if"},
            {"id": "e2", "source": "n_if", "target": "n_wait", "condition": "true"},
            {"id": "e3", "source": "n_if", "target": "n_end", "condition": "false"},
            {"id": "e4", "source": "n_wait", "target": "n_end"},
        ]
        flow = FlowModel.model_validate(payload)
        errors = validate_flow_model(flow)
        self.assertEqual(errors, [])

    def test_if_structured_invalid_operator_is_invalid(self) -> None:
        payload = self._load_minimal_flow()
        payload["nodes"] = [
            {"id": "n_start", "type": "start", "label": "Start", "config": {}},
            {
                "id": "n_if",
                "type": "if",
                "label": "If",
                "config": {"left": "{{status}}", "operator": "bad_op", "right": "success"},
            },
            {"id": "n_end", "type": "end", "label": "End", "config": {}},
        ]
        payload["edges"] = [
            {"id": "e1", "source": "n_start", "target": "n_if"},
            {"id": "e2", "source": "n_if", "target": "n_end", "condition": "true"},
        ]
        flow = FlowModel.model_validate(payload)
        errors = validate_flow_model(flow)
        self.assertTrue(any("config.operator is invalid" in item for item in errors))


if __name__ == "__main__":
    unittest.main()
