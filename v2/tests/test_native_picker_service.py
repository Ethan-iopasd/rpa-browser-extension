from __future__ import annotations

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
AGENT_ROOT = ROOT / "apps" / "agent"
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

HAS_IMPORT = True
try:
    from app.repositories.native_picker_repository import native_picker_repository  # noqa: E402
    from app.schemas.native_picker_protocol import (  # noqa: E402
        NativePickerMessageEnvelope,
        NativePickerSessionCreateRequest,
    )
    from app.services.native_picker_service import (  # noqa: E402
        create_native_picker_session,
        get_native_picker_session,
        handle_native_picker_message,
        pull_native_picker_result,
    )
except ModuleNotFoundError:
    HAS_IMPORT = False


@unittest.skipUnless(HAS_IMPORT, "api or agent dependencies are not installed")
class TestNativePickerService(unittest.TestCase):
    def setUp(self) -> None:
        native_picker_repository.clear()

    def test_create_session_and_query(self) -> None:
        session = create_native_picker_session(
            NativePickerSessionCreateRequest(
                nodeId="node_click_01",
                launchMode="attach_existing",
                timeoutMs=60_000,
                requestedBy="tester",
                source="designer",
            )
        )
        self.assertEqual(session.status, "pending")
        self.assertEqual(session.launchMode, "attach_existing")
        loaded = get_native_picker_session(session.sessionId)
        self.assertEqual(loaded.nodeId, "node_click_01")
        self.assertEqual(loaded.pageUrl, "")

    def test_pick_result_roundtrip(self) -> None:
        session = create_native_picker_session(
            NativePickerSessionCreateRequest(
                nodeId="node_click_02",
                pageUrl="https://example.com/secure",
                launchMode="open_url",
                timeoutMs=60_000,
            )
        )

        ack = handle_native_picker_message(
            NativePickerMessageEnvelope(
                type="pick_result",
                requestId="req_test_001",
                sessionId=session.sessionId,
                payload={"result": {"selector": "#submit-button"}},
            ),
            source="native_host",
        )
        self.assertTrue(ack.ok)
        self.assertEqual(ack.sessionStatus, "succeeded")

        updated = get_native_picker_session(session.sessionId)
        self.assertEqual(updated.status, "succeeded")

        pulled = pull_native_picker_result(session_id=session.sessionId)
        self.assertTrue(pulled.found)
        self.assertIsNotNone(pulled.result)
        self.assertEqual(pulled.result.result.selector, "#submit-button")

        pulled_again = pull_native_picker_result(session_id=session.sessionId)
        self.assertFalse(pulled_again.found)


if __name__ == "__main__":
    unittest.main()
