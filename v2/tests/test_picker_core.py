from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ["RPA_RUNTIME_DIR"] = str(ROOT / ".test_runtime")
AGENT_ROOT = ROOT / "apps" / "agent"
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

HAS_IMPORT = True
try:
    from agent.runtime.picker_core import PickerPayloadError, build_picker_result  # noqa: E402
except ModuleNotFoundError:
    HAS_IMPORT = False


@unittest.skipUnless(HAS_IMPORT, "agent dependencies are not installed")
class TestPickerCore(unittest.TestCase):
    def test_prefers_primary_selector_candidate_over_payload_selector(self) -> None:
        payload = {
            "selector": 'role=textbox[name="邮箱账号或手机号码"]',
            "selectorType": "playwright",
            "selectorCandidates": [
                {
                    "type": "playwright",
                    "value": 'role=textbox[name="邮箱账号或手机号码"]',
                    "score": 0.72,
                    "primary": False,
                },
                {"type": "css", "value": '[name="email"]', "score": 0.95, "primary": True},
            ],
        }

        result = build_picker_result(payload, source_frame=None, page_url="https://mail.163.com/")

        self.assertEqual(result.selector, '[name="email"]')
        self.assertEqual(result.selectorType, "css")

    def test_accepts_missing_payload_selector_when_candidates_exist(self) -> None:
        payload = {
            "selectorCandidates": [
                {"type": "css", "value": "#submit", "score": 0.88, "primary": True},
            ]
        }

        result = build_picker_result(payload, source_frame=None, page_url="https://example.com")

        self.assertEqual(result.selector, "#submit")
        self.assertEqual(result.selectorType, "css")

    def test_raises_when_selector_candidates_missing(self) -> None:
        with self.assertRaises(PickerPayloadError):
            build_picker_result({}, source_frame=None, page_url="https://example.com")


if __name__ == "__main__":
    unittest.main()
