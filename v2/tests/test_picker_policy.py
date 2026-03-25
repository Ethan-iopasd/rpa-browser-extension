from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AGENT_ROOT = ROOT / "apps" / "agent"
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

HAS_IMPORT = True
try:
    from agent.runtime.picker_policy import DEFAULT_PICKER_SELECTOR_POLICY  # noqa: E402
except ModuleNotFoundError:
    HAS_IMPORT = False


@unittest.skipUnless(HAS_IMPORT, "agent dependencies are not installed")
class TestPickerPolicy(unittest.TestCase):
    def test_default_frame_policy_contains_attribute_filters(self) -> None:
        frame = DEFAULT_PICKER_SELECTOR_POLICY.get("frame", {})
        self.assertIsInstance(frame, dict)
        filters = frame.get("attributeFilters")
        self.assertIsInstance(filters, list)
        self.assertGreaterEqual(len(filters), 1)

        first = filters[0]
        self.assertIsInstance(first, dict)
        self.assertIn("attribute", first)
        self.assertIn("value", first)
        self.assertFalse(bool(first.get("include")))


if __name__ == "__main__":
    unittest.main()
