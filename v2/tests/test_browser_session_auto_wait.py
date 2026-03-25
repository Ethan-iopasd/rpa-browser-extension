from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AGENT_ROOT = ROOT / "apps" / "agent"
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

HAS_AGENT_IMPORT = True
try:
    from agent.runtime.browser_session import BrowserActionError, BrowserSession  # noqa: E402
except ModuleNotFoundError:
    HAS_AGENT_IMPORT = False


class _LocatorWrapper:
    def __init__(self, locator: "_FakeLocator") -> None:
        self.first = locator


class _FakeLocator:
    def __init__(self, *, fail_on_wait: bool = False) -> None:
        self.fail_on_wait = fail_on_wait
        self.calls: list[tuple[str, object]] = []

    def wait_for(self, *, state: str, timeout: int) -> None:
        self.calls.append(("wait_for", state, timeout))
        if self.fail_on_wait:
            raise RuntimeError(f"not ready: {state}")

    def is_enabled(self, *, timeout: int) -> bool:
        self.calls.append(("is_enabled", timeout))
        return True

    def is_editable(self, *, timeout: int) -> bool:
        self.calls.append(("is_editable", timeout))
        return True

    def click(self, *, timeout: int, button: str, click_count: int) -> None:
        self.calls.append(("click", timeout, button, click_count))

    def fill(self, value: str, *, timeout: int) -> None:
        self.calls.append(("fill", value, timeout))

    def text_content(self, *, timeout: int) -> str:
        self.calls.append(("text_content", timeout))
        return "ok"


class _FakeTarget:
    def __init__(self, mapping: dict[str, _FakeLocator]) -> None:
        self.mapping = mapping

    def locator(self, selector: str) -> _LocatorWrapper:
        locator = self.mapping.get(selector)
        if locator is None:
            raise RuntimeError(f"selector missing: {selector}")
        return _LocatorWrapper(locator)


@unittest.skipUnless(HAS_AGENT_IMPORT, "agent dependencies are not installed")
class TestBrowserSessionAutoWait(unittest.TestCase):
    def test_click_waits_before_action(self) -> None:
        locator = _FakeLocator()
        session = BrowserSession(headless=True)
        session._active_target = lambda: _FakeTarget({"#submit": locator})  # type: ignore[method-assign]

        _, selector = session.click(["#submit"], timeout_ms=3000)

        self.assertEqual(selector, "#submit")
        self.assertIn(("wait_for", "attached", 3000), locator.calls)
        self.assertIn(("wait_for", "visible", 3000), locator.calls)
        self.assertIn(("is_enabled", 3000), locator.calls)
        self.assertIn(("click", 3000, "left", 1), locator.calls)

    def test_click_can_disable_auto_wait(self) -> None:
        locator = _FakeLocator()
        session = BrowserSession(headless=True)
        session._active_target = lambda: _FakeTarget({"#submit": locator})  # type: ignore[method-assign]

        _, selector = session.click(["#submit"], timeout_ms=3000, auto_wait=False)

        self.assertEqual(selector, "#submit")
        self.assertNotIn(("wait_for", "attached", 3000), locator.calls)
        self.assertNotIn(("wait_for", "visible", 3000), locator.calls)
        self.assertNotIn(("is_enabled", 3000), locator.calls)
        self.assertIn(("click", 3000, "left", 1), locator.calls)

    def test_click_fallbacks_to_next_selector(self) -> None:
        first = _FakeLocator(fail_on_wait=True)
        second = _FakeLocator()
        session = BrowserSession(headless=True)
        session._active_target = lambda: _FakeTarget({"#a": first, "#b": second})  # type: ignore[method-assign]

        _, selector = session.click(["#a", "#b"], timeout_ms=2500)

        self.assertEqual(selector, "#b")
        self.assertIn(("click", 2500, "left", 1), second.calls)

    def test_wait_for_selector_reports_candidate_errors(self) -> None:
        first = _FakeLocator(fail_on_wait=True)
        second = _FakeLocator(fail_on_wait=True)
        session = BrowserSession(headless=True)
        session._active_target = lambda: _FakeTarget({"#a": first, "#b": second})  # type: ignore[method-assign]

        with self.assertRaises(BrowserActionError) as ctx:
            session.wait_for_selector(["#a", "#b"], state="visible", timeout_ms=1200)

        details = ctx.exception.details
        self.assertIn("candidateErrors", details)
        self.assertEqual(len(details["candidateErrors"]), 2)
        self.assertEqual(details["selectors"], ["#a", "#b"])
        self.assertEqual(details["timeoutMs"], 1200)


if __name__ == "__main__":
    unittest.main()
