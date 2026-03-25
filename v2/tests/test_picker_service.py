from __future__ import annotations

import os
import sys
import time
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
    from app.repositories.picker_repository import picker_repository  # noqa: E402
    from app.schemas.contracts import (  # noqa: E402
        PickerResult,
        PickerSelectorCandidate,
        StartPickerSessionRequest,
    )
    from app.services import picker_service  # noqa: E402
except ModuleNotFoundError:
    HAS_IMPORT = False


def _wait_until_terminal(session_id: str, timeout_seconds: float = 3.0):
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        session = picker_service.get_picker_session(session_id)
        if session.status in {"succeeded", "failed", "cancelled"}:
            return session
        time.sleep(0.05)
    return picker_service.get_picker_session(session_id)


@unittest.skipUnless(HAS_IMPORT, "api or agent dependencies are not installed")
class TestPickerService(unittest.TestCase):
    def setUp(self) -> None:
        picker_repository.clear()
        picker_service.stop_picker_runtime()
        self._origin_pick = picker_service._pick_with_agent

    def tearDown(self) -> None:
        picker_service._pick_with_agent = self._origin_pick
        picker_service.stop_picker_runtime()

    def test_start_session_succeeds(self) -> None:
        def fake_pick_with_agent(*, url: str, timeout_ms: int, headless: bool, should_cancel):
            del timeout_ms, headless, should_cancel
            return PickerResult(
                selector="#submit",
                selectorType="css",
                selectorCandidates=[
                    PickerSelectorCandidate(type="css", value="#submit", score=1.0, primary=True)
                ],
                playwrightPrimary=None,
                playwrightCandidates=[],
                frameLocatorChain=[],
                pageUrl=url,
                framePath=[],
                framePathString="top",
                elementMeta={"tagName": "button"},
            )

        picker_service._pick_with_agent = fake_pick_with_agent
        started = picker_service.start_picker_session(
            StartPickerSessionRequest(url="https://example.com", timeoutMs=60_000, headless=False)
        )
        final = _wait_until_terminal(started.sessionId)
        self.assertEqual(final.status, "succeeded")
        self.assertIsNotNone(final.result)
        self.assertEqual(final.result.selector, "#submit")

    def test_cancel_session_marks_cancelled(self) -> None:
        def fake_pick_with_agent(*, url: str, timeout_ms: int, headless: bool, should_cancel):
            del url, timeout_ms, headless
            while not should_cancel():
                time.sleep(0.05)
            raise picker_service.PickerServiceError(
                code="PICKER_CANCELED",
                message="cancelled",
                details={},
            )

        picker_service._pick_with_agent = fake_pick_with_agent
        started = picker_service.start_picker_session(
            StartPickerSessionRequest(url="https://example.com", timeoutMs=60_000, headless=False)
        )
        time.sleep(0.1)
        picker_service.cancel_picker_session(started.sessionId)
        final = _wait_until_terminal(started.sessionId)
        self.assertEqual(final.status, "cancelled")


if __name__ == "__main__":
    unittest.main()

