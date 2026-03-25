from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from tempfile import gettempdir
from typing import Any

from agent.models.error_codes import (
    BROWSER_STARTUP_FAILED,
    ELEMENT_NOT_FOUND,
    NODE_EXECUTION_FAILED,
    PAGE_TIMEOUT,
)

_VOLATILE_FRAME_SELECTOR_PATTERNS = [
    re.compile(r"(?:^|[-_])iframe[-_]?[a-z0-9_-]*\d+(?:\.\d+)?$", re.IGNORECASE),
    re.compile(r"^x-[a-z0-9_-]*iframe[a-z0-9_-]*\d+(?:\.\d+)?$", re.IGNORECASE),
    re.compile(r"^frame[a-z]{1,8}\d+$", re.IGNORECASE),
    re.compile(r"\d{6,}", re.IGNORECASE),
]


@dataclass(slots=True)
class BrowserActionError(Exception):
    message: str
    details: dict[str, Any]
    code: str = NODE_EXECUTION_FAILED

    def __str__(self) -> str:
        return self.message


def _is_timeout_reason(reason: str) -> bool:
    lowered = reason.lower()
    return "timeout" in lowered or "timed out" in lowered


def _page_error_code(reason: str) -> str:
    if _is_timeout_reason(reason):
        return PAGE_TIMEOUT
    return NODE_EXECUTION_FAILED


def _selector_looks_volatile(selector: str) -> bool:
    normalized = selector.strip()
    if not normalized:
        return False
    for pattern in _VOLATILE_FRAME_SELECTOR_PATTERNS:
        if pattern.search(normalized):
            return True
    return False


def _frame_selector_priority(selector: str) -> tuple[int, int]:
    normalized = selector.strip().lower()
    score = 0
    if "[data-" in normalized:
        score += 7
    if "[src^=" in normalized:
        score += 6
    elif "[src*=" in normalized:
        score += 4
    if "[name=" in normalized:
        score += 3
    if ":nth-of-type(" in normalized:
        score += 2
    if "#" in normalized and _selector_looks_volatile(normalized):
        score -= 8
    return (score, -len(normalized))


def browser_runtime_available() -> bool:
    try:
        import playwright.sync_api  # noqa: F401
    except ModuleNotFoundError:
        return False
    return True


def resolve_headless(default_value: bool = True) -> bool:
    raw = os.getenv("RPA_AGENT_BROWSER_HEADLESS")
    if raw is None:
        return default_value
    return raw not in {"0", "false", "False", "no", "NO"}


class BrowserSession:
    def __init__(self, *, headless: bool = True) -> None:
        self._headless = headless
        self._playwright: Any | None = None
        self._browser: Any | None = None
        self._context: Any | None = None
        self._page: Any | None = None
        self._active_frame: Any | None = None

    def _ensure_page(self) -> Any:
        if self._page is not None:
            return self._page
        if not browser_runtime_available():
            raise BrowserActionError(
                message="Playwright runtime is not installed.",
                details={"hint": "Install playwright and run `playwright install chromium`."},
            )
        from playwright.sync_api import sync_playwright

        try:
            self._playwright = sync_playwright().start()
            self._browser = self._playwright.chromium.launch(headless=self._headless)
            self._context = self._browser.new_context(ignore_https_errors=True)
            self._page = self._context.new_page()
            self._active_frame = None
        except Exception as exc:  # pragma: no cover - runtime dependent
            self.close()
            raise BrowserActionError(
                code=BROWSER_STARTUP_FAILED,
                message="Browser startup failed.",
                details={
                    "reason": str(exc),
                    "headless": self._headless,
                    "hint": "Check browser install/sandbox permissions and retry.",
                },
            ) from exc
        return self._page

    def _active_target(self) -> Any:
        self._ensure_page()
        return self._active_frame or self._page

    def _normalize_frame_path(self, frame_path: Any) -> list[dict[str, Any]]:
        if not isinstance(frame_path, list):
            return []
        normalized: list[dict[str, Any]] = []
        for item in frame_path:
            if not isinstance(item, dict):
                continue
            segment: dict[str, Any] = {}
            raw_index = item.get("index")
            if isinstance(raw_index, int):
                segment["index"] = raw_index
            for key in ("name", "id", "src", "srcHostPath", "srcStableFragment", "selector", "hint", "tag", "frameBorder"):
                value = item.get(key)
                if isinstance(value, str) and value.strip():
                    segment[key] = value.strip()
            id_stable = item.get("idStable")
            if isinstance(id_stable, bool):
                segment["idStable"] = id_stable
            raw_attr_hints = item.get("attrHints")
            if isinstance(raw_attr_hints, dict):
                attr_hints: dict[str, str] = {}
                for raw_name, raw_value in raw_attr_hints.items():
                    if not isinstance(raw_name, str):
                        continue
                    if not isinstance(raw_value, str):
                        continue
                    name = raw_name.strip().lower()
                    value = raw_value.strip()
                    if not name or not value:
                        continue
                    attr_hints[name] = value
                if attr_hints:
                    segment["attrHints"] = attr_hints
            if item.get("crossOrigin") is True:
                segment["crossOrigin"] = True
            if segment:
                normalized.append(segment)
        return normalized

    def _frame_matches_segment(self, frame: Any, segment: dict[str, Any]) -> bool:
        frame_element = None
        try:
            frame_element = frame.frame_element()
        except Exception:  # pragma: no cover - runtime dependent
            frame_element = None
        frame_id = segment.get("id")
        id_stable = segment.get("idStable")
        if isinstance(frame_id, str) and frame_id and id_stable is not False and frame_element is not None:
            try:
                actual_id = frame_element.get_attribute("id")
            except Exception:  # pragma: no cover - runtime dependent
                actual_id = None
            if isinstance(actual_id, str) and actual_id == frame_id:
                return True
        name = segment.get("name")
        if isinstance(name, str):
            frame_name = getattr(frame, "name", None)
            if isinstance(frame_name, str) and frame_name == name:
                return True
        src_host_path = segment.get("srcHostPath")
        if isinstance(src_host_path, str) and src_host_path:
            frame_url = getattr(frame, "url", "") or ""
            if isinstance(frame_url, str) and (src_host_path in frame_url or frame_url in src_host_path):
                return True
        src = segment.get("src")
        if isinstance(src, str) and src:
            frame_url = getattr(frame, "url", "") or ""
            if isinstance(frame_url, str) and (src in frame_url or frame_url in src):
                return True
        src_stable_fragment = segment.get("srcStableFragment")
        if isinstance(src_stable_fragment, str) and src_stable_fragment:
            frame_url = getattr(frame, "url", "") or ""
            if isinstance(frame_url, str) and (src_stable_fragment in frame_url or frame_url in src_stable_fragment):
                return True
        raw_attr_hints = segment.get("attrHints")
        if isinstance(raw_attr_hints, dict) and frame_element is not None:
            matched = 0
            for raw_name, raw_value in raw_attr_hints.items():
                if not isinstance(raw_name, str):
                    continue
                if not isinstance(raw_value, str):
                    continue
                attr_name = raw_name.strip()
                attr_value = raw_value.strip()
                if not attr_name or not attr_value:
                    continue
                try:
                    actual_value = frame_element.get_attribute(attr_name)
                except Exception:  # pragma: no cover - runtime dependent
                    actual_value = None
                if isinstance(actual_value, str) and actual_value.strip() == attr_value:
                    matched += 1
            if matched > 0:
                return True
        return False

    def _resolve_child_frame_by_selector(self, parent_frame: Any, selector: str, timeout_ms: int = 500) -> Any | None:
        if not isinstance(selector, str) or not selector.strip():
            return None
        try:
            locator = parent_frame.locator(selector).first
            handle = locator.element_handle(timeout=max(int(timeout_ms), 1))
            if handle is None:
                return None
            return handle.content_frame()
        except Exception:  # pragma: no cover - runtime dependent
            return None

    def _normalize_frame_locator_chain(self, frame_locator_chain: Any) -> list[dict[str, Any]]:
        if not isinstance(frame_locator_chain, list):
            return []
        normalized: list[dict[str, Any]] = []
        for item in frame_locator_chain:
            if not isinstance(item, dict):
                continue
            segment: dict[str, Any] = {}
            for key in ("hint", "primary"):
                value = item.get(key)
                if isinstance(value, str) and value.strip():
                    segment[key] = value.strip()
            for key in ("depth", "index"):
                value = item.get(key)
                if isinstance(value, int):
                    segment[key] = value
            if item.get("crossOrigin") is True:
                segment["crossOrigin"] = True
            selector_candidates: list[str] = []
            raw_candidates = item.get("selectorCandidates")
            if isinstance(raw_candidates, list):
                for candidate in raw_candidates:
                    if isinstance(candidate, str) and candidate.strip():
                        selector_candidates.append(candidate.strip())
                        continue
                    if isinstance(candidate, dict):
                        value = candidate.get("value")
                        if isinstance(value, str) and value.strip():
                            selector_candidates.append(value.strip())
            if selector_candidates:
                segment["selectorCandidates"] = list(dict.fromkeys(selector_candidates))
            if segment:
                normalized.append(segment)
        return normalized

    def _resolve_frame_locator_chain_target(self, frame_locator_chain: list[dict[str, Any]], timeout_ms: int) -> Any:
        page = self._ensure_page()
        current = page.main_frame
        for depth, segment in enumerate(frame_locator_chain):
            child_frames = list(getattr(current, "child_frames", []) or [])
            if not child_frames:
                raise BrowserActionError(
                    code=ELEMENT_NOT_FOUND,
                    message="Frame locator chain resolution failed.",
                    details={
                        "frameLocatorChain": frame_locator_chain,
                        "failedDepth": depth,
                        "segment": segment,
                        "reason": "No child frames found for current segment.",
                        "timeoutMs": timeout_ms,
                    },
                )
            selectors: list[str] = []
            primary = segment.get("primary")
            if isinstance(primary, str) and primary.strip():
                selectors.append(primary.strip())
            raw_selectors = segment.get("selectorCandidates")
            if isinstance(raw_selectors, list):
                for selector in raw_selectors:
                    if isinstance(selector, str) and selector.strip():
                        selectors.append(selector.strip())
            selectors = sorted(
                list(dict.fromkeys(selectors)),
                key=_frame_selector_priority,
                reverse=True,
            )

            selected = None
            selector_errors: list[dict[str, Any]] = []
            for selector in selectors:
                try:
                    selected = self._resolve_child_frame_by_selector(current, selector, min(timeout_ms, 2000))
                    if selected is not None:
                        break
                except Exception as exc:  # pragma: no cover - runtime dependent
                    selector_errors.append({"selector": selector, "reason": str(exc)})
            if selected is None:
                frame_index = segment.get("index")
                if isinstance(frame_index, int) and 0 <= frame_index < len(child_frames):
                    selected = child_frames[frame_index]
            if selected is None:
                raise BrowserActionError(
                    code=ELEMENT_NOT_FOUND,
                    message="Frame locator chain resolution failed.",
                    details={
                        "frameLocatorChain": frame_locator_chain,
                        "failedDepth": depth,
                        "segment": segment,
                        "selectors": selectors,
                        "selectorErrors": selector_errors,
                        "reason": "No matching frame found by selector candidates or index.",
                        "timeoutMs": timeout_ms,
                    },
                )
            current = selected
        return current

    def _resolve_frame_target(self, frame_path: list[dict[str, Any]], timeout_ms: int) -> Any:
        page = self._ensure_page()
        current = page.main_frame
        for depth, segment in enumerate(frame_path):
            child_frames = list(getattr(current, "child_frames", []) or [])
            if not child_frames:
                raise BrowserActionError(
                    code=ELEMENT_NOT_FOUND,
                    message="Frame path resolution failed.",
                    details={
                        "framePath": frame_path,
                        "failedDepth": depth,
                        "reason": "No child frames found for current segment.",
                        "timeoutMs": timeout_ms,
                    },
                )
            selected = None
            frame_selector = segment.get("selector")
            if isinstance(frame_selector, str) and frame_selector.strip():
                selected = self._resolve_child_frame_by_selector(current, frame_selector, min(timeout_ms, 2000))
            if selected is None:
                for child in child_frames:
                    if self._frame_matches_segment(child, segment):
                        selected = child
                        break
            if selected is None:
                frame_index = segment.get("index")
                if isinstance(frame_index, int) and 0 <= frame_index < len(child_frames):
                    selected = child_frames[frame_index]
            if selected is None:
                raise BrowserActionError(
                    code=ELEMENT_NOT_FOUND,
                    message="Frame path resolution failed.",
                    details={
                        "framePath": frame_path,
                        "failedDepth": depth,
                        "segment": segment,
                        "reason": "No matching frame segment.",
                        "timeoutMs": timeout_ms,
                    },
                )
            current = selected
        return current

    def _resolve_target(
        self,
        frame_path: list[dict[str, Any]] | None,
        timeout_ms: int,
        frame_locator_chain: list[dict[str, Any]] | None = None,
    ) -> Any:
        normalized_chain = self._normalize_frame_locator_chain(frame_locator_chain)
        if normalized_chain:
            try:
                return self._resolve_frame_locator_chain_target(normalized_chain, timeout_ms)
            except BrowserActionError as chain_error:
                normalized = self._normalize_frame_path(frame_path)
                if normalized:
                    try:
                        return self._resolve_frame_target(normalized, timeout_ms)
                    except BrowserActionError as path_error:
                        raise BrowserActionError(
                            code=ELEMENT_NOT_FOUND,
                            message="Frame resolution failed with both frame locator chain and frame path.",
                            details={
                                "frameLocatorChain": normalized_chain,
                                "framePath": normalized,
                                "frameLocatorError": chain_error.details,
                                "framePathError": path_error.details,
                                "timeoutMs": timeout_ms,
                            },
                        ) from path_error
                raise
        normalized = self._normalize_frame_path(frame_path)
        if normalized:
            return self._resolve_frame_target(normalized, timeout_ms)
        return self._active_target()

    def _resolve_locator(self, selectors: list[str]) -> tuple[Any, str]:
        target = self._active_target()
        last_error = "unknown"
        for selector in selectors:
            try:
                locator = target.locator(selector).first
                return locator, selector
            except Exception as exc:  # pragma: no cover - runtime dependent
                last_error = str(exc)
        raise BrowserActionError(
            code=ELEMENT_NOT_FOUND,
            message="All selector candidates are invalid.",
            details={"selectors": selectors, "reason": last_error},
        )

    def _normalize_wait_state(self, wait_state: str | None, default_state: str) -> str:
        allowed = {"attached", "visible", "hidden", "detached", "enabled", "editable"}
        if isinstance(wait_state, str):
            candidate = wait_state.strip().lower()
            if candidate in allowed:
                return candidate
        return default_state

    def _wait_locator_ready(self, locator: Any, wait_state: str, timeout_ms: int) -> None:
        if wait_state in {"attached", "visible", "hidden", "detached"}:
            locator.wait_for(state=wait_state, timeout=timeout_ms)
            return
        locator.wait_for(state="attached", timeout=timeout_ms)
        locator.wait_for(state="visible", timeout=timeout_ms)
        if wait_state == "enabled":
            if not locator.is_enabled(timeout=timeout_ms):
                raise RuntimeError("Element is not enabled.")
            return
        if wait_state == "editable":
            if not locator.is_editable(timeout=timeout_ms):
                raise RuntimeError("Element is not editable.")

    def _resolve_action_locator(
        self,
        target: Any,
        selector: str,
        *,
        scope_selector: str | None,
        timeout_ms: int,
    ) -> Any:
        if isinstance(scope_selector, str) and scope_selector.strip():
            scope_locator = target.locator(scope_selector.strip()).first
            scope_locator.wait_for(state="attached", timeout=timeout_ms)
            if selector.strip():
                return scope_locator.locator(selector).first
            return scope_locator
        return target.locator(selector).first

    def _run_with_selector_candidates(
        self,
        selectors: list[str],
        *,
        action_name: str,
        timeout_ms: int,
        action: Any,
        auto_wait: bool,
        wait_state: str,
        wait_timeout_ms: int | None = None,
        screenshot_prefix: str | None = None,
        extra_details: dict[str, Any] | None = None,
        frame_path: list[dict[str, Any]] | None = None,
        frame_locator_chain: list[dict[str, Any]] | None = None,
        scope_selector: str | None = None,
    ) -> tuple[int, str, int, Any]:
        started = time.perf_counter()
        wait_timeout = wait_timeout_ms if isinstance(wait_timeout_ms, int) and wait_timeout_ms > 0 else timeout_ms
        normalized_wait_state = self._normalize_wait_state(wait_state, "visible")
        normalized_frame_path = self._normalize_frame_path(frame_path)
        normalized_frame_locator_chain = self._normalize_frame_locator_chain(frame_locator_chain)
        normalized_scope_selector = scope_selector.strip() if isinstance(scope_selector, str) and scope_selector.strip() else None
        candidate_errors: list[dict[str, Any]] = []
        for selector in selectors:
            try:
                target = self._resolve_target(
                    normalized_frame_path,
                    wait_timeout,
                    normalized_frame_locator_chain,
                )
                locator = self._resolve_action_locator(
                    target,
                    selector,
                    scope_selector=normalized_scope_selector,
                    timeout_ms=wait_timeout,
                )
                waited_ms = 0
                if auto_wait:
                    wait_started = time.perf_counter()
                    self._wait_locator_ready(locator, normalized_wait_state, wait_timeout)
                    waited_ms = int((time.perf_counter() - wait_started) * 1000)
                action_result = action(locator)
                return int((time.perf_counter() - started) * 1000), selector, waited_ms, action_result
            except BrowserActionError:
                raise
            except Exception as exc:  # pragma: no cover - runtime dependent
                candidate_errors.append({"selector": selector, "scopeSelector": normalized_scope_selector, "reason": str(exc)})
        last_error = candidate_errors[-1]["reason"] if candidate_errors else "unknown"
        details: dict[str, Any] = {
            "selectors": selectors,
            "timeoutMs": timeout_ms,
            "autoWait": auto_wait,
            "waitState": normalized_wait_state if auto_wait else None,
            "waitTimeoutMs": wait_timeout if auto_wait else None,
            "framePath": normalized_frame_path,
            "frameLocatorChain": normalized_frame_locator_chain,
            "scopeSelector": normalized_scope_selector,
            "reason": last_error,
            "candidateErrors": candidate_errors,
        }
        if extra_details:
            details.update(extra_details)
        if screenshot_prefix:
            details["screenshot"] = self.screenshot(screenshot_prefix)
        raise BrowserActionError(
            code=ELEMENT_NOT_FOUND,
            message=f"{action_name} failed with all selector candidates.",
            details=details,
        )

    def navigate(self, url: str, timeout_ms: int) -> int:
        page = self._ensure_page()
        started = time.perf_counter()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            self._active_frame = None
        except Exception as exc:  # pragma: no cover - runtime dependent
            reason = str(exc)
            raise BrowserActionError(
                code=_page_error_code(reason),
                message=f"Navigate failed: {url}",
                details={"url": url, "timeoutMs": timeout_ms, "reason": reason, "screenshot": self.screenshot("navigate")},
            ) from exc
        return int((time.perf_counter() - started) * 1000)

    def click(
        self,
        selectors: list[str],
        timeout_ms: int,
        *,
        button: str = "left",
        click_count: int = 1,
        auto_wait: bool = True,
        wait_state: str = "enabled",
        wait_timeout_ms: int | None = None,
        frame_path: list[dict[str, Any]] | None = None,
        frame_locator_chain: list[dict[str, Any]] | None = None,
        scope_selector: str | None = None,
    ) -> tuple[int, str]:
        duration, selector, _, _ = self._run_with_selector_candidates(
            selectors,
            action_name="Click",
            timeout_ms=timeout_ms,
            auto_wait=auto_wait,
            wait_state=wait_state,
            wait_timeout_ms=wait_timeout_ms,
            screenshot_prefix="click",
            extra_details={"button": button, "clickCount": click_count},
            frame_path=frame_path,
            frame_locator_chain=frame_locator_chain,
            scope_selector=scope_selector,
            action=lambda locator: locator.click(timeout=timeout_ms, button=button, click_count=click_count),
        )
        return duration, selector

    def hover(
        self,
        selectors: list[str],
        timeout_ms: int,
        *,
        auto_wait: bool = True,
        wait_state: str = "visible",
        wait_timeout_ms: int | None = None,
        frame_path: list[dict[str, Any]] | None = None,
        frame_locator_chain: list[dict[str, Any]] | None = None,
        scope_selector: str | None = None,
    ) -> tuple[int, str]:
        duration, selector, _, _ = self._run_with_selector_candidates(
            selectors,
            action_name="Hover",
            timeout_ms=timeout_ms,
            auto_wait=auto_wait,
            wait_state=wait_state,
            wait_timeout_ms=wait_timeout_ms,
            screenshot_prefix="hover",
            frame_path=frame_path,
            frame_locator_chain=frame_locator_chain,
            scope_selector=scope_selector,
            action=lambda locator: locator.hover(timeout=timeout_ms),
        )
        return duration, selector

    def input_text(
        self,
        selectors: list[str],
        value: str,
        timeout_ms: int,
        *,
        auto_wait: bool = True,
        wait_state: str = "editable",
        wait_timeout_ms: int | None = None,
        frame_path: list[dict[str, Any]] | None = None,
        frame_locator_chain: list[dict[str, Any]] | None = None,
        scope_selector: str | None = None,
    ) -> tuple[int, str]:
        duration, selector, _, _ = self._run_with_selector_candidates(
            selectors,
            action_name="Input",
            timeout_ms=timeout_ms,
            auto_wait=auto_wait,
            wait_state=wait_state,
            wait_timeout_ms=wait_timeout_ms,
            screenshot_prefix="input",
            extra_details={"valueLength": len(value)},
            frame_path=frame_path,
            frame_locator_chain=frame_locator_chain,
            scope_selector=scope_selector,
            action=lambda locator: locator.fill(value, timeout=timeout_ms),
        )
        return duration, selector

    def press_key(self, key: str, timeout_ms: int) -> int:
        page = self._ensure_page()
        started = time.perf_counter()
        try:
            page.keyboard.press(key, timeout=timeout_ms)
        except Exception as exc:  # pragma: no cover - runtime dependent
            reason = str(exc)
            raise BrowserActionError(
                code=_page_error_code(reason),
                message=f"Press key failed: {key}",
                details={"key": key, "timeoutMs": timeout_ms, "reason": reason, "screenshot": self.screenshot("pressKey")},
            ) from exc
        return int((time.perf_counter() - started) * 1000)

    def scroll(
        self,
        selectors: list[str],
        *,
        x: int = 0,
        y: int = 0,
        timeout_ms: int,
        auto_wait: bool = True,
        wait_state: str = "visible",
        wait_timeout_ms: int | None = None,
        frame_path: list[dict[str, Any]] | None = None,
        frame_locator_chain: list[dict[str, Any]] | None = None,
        scope_selector: str | None = None,
    ) -> tuple[int, str]:
        page = self._ensure_page()
        started = time.perf_counter()
        if selectors:
            duration, selector, _, _ = self._run_with_selector_candidates(
                selectors,
                action_name="Scroll",
                timeout_ms=timeout_ms,
                auto_wait=auto_wait,
                wait_state=wait_state,
                wait_timeout_ms=wait_timeout_ms,
                screenshot_prefix="scroll",
                extra_details={"x": x, "y": y},
                frame_path=frame_path,
                frame_locator_chain=frame_locator_chain,
                scope_selector=scope_selector,
                action=lambda locator: (
                    locator.scroll_into_view_if_needed(timeout=timeout_ms),
                    page.mouse.wheel(x, y),
                ),
            )
            return duration, selector
        normalized_scope_selector = scope_selector.strip() if isinstance(scope_selector, str) and scope_selector.strip() else None
        if normalized_scope_selector:
            normalized_frame_path = self._normalize_frame_path(frame_path)
            normalized_frame_locator_chain = self._normalize_frame_locator_chain(frame_locator_chain)
            try:
                scope = self._resolve_target(
                    normalized_frame_path,
                    timeout_ms,
                    normalized_frame_locator_chain,
                ).locator(normalized_scope_selector).first
                scope.wait_for(state="attached", timeout=timeout_ms)
                scope.evaluate("(el, offsets) => { el.scrollBy(offsets.x, offsets.y); }", {"x": x, "y": y})
                return int((time.perf_counter() - started) * 1000), normalized_scope_selector
            except BrowserActionError:
                raise
            except Exception as exc:  # pragma: no cover - runtime dependent
                reason = str(exc)
                raise BrowserActionError(
                    code=ELEMENT_NOT_FOUND if "selector" in reason.lower() or "locator" in reason.lower() else _page_error_code(reason),
                    message="Scroll failed on scope selector.",
                    details={
                        "scopeSelector": normalized_scope_selector,
                        "x": x,
                        "y": y,
                        "timeoutMs": timeout_ms,
                        "framePath": normalized_frame_path,
                        "frameLocatorChain": normalized_frame_locator_chain,
                        "reason": reason,
                    },
                ) from exc
        page.mouse.wheel(x, y)
        return int((time.perf_counter() - started) * 1000), "window"

    def select_option(
        self,
        selectors: list[str],
        value: str,
        timeout_ms: int,
        *,
        auto_wait: bool = True,
        wait_state: str = "visible",
        wait_timeout_ms: int | None = None,
        frame_path: list[dict[str, Any]] | None = None,
        frame_locator_chain: list[dict[str, Any]] | None = None,
        scope_selector: str | None = None,
    ) -> tuple[int, str]:
        duration, selector, _, _ = self._run_with_selector_candidates(
            selectors,
            action_name="Select option",
            timeout_ms=timeout_ms,
            auto_wait=auto_wait,
            wait_state=wait_state,
            wait_timeout_ms=wait_timeout_ms,
            screenshot_prefix="select",
            extra_details={"value": value},
            frame_path=frame_path,
            frame_locator_chain=frame_locator_chain,
            scope_selector=scope_selector,
            action=lambda locator: locator.select_option(value=value, timeout=timeout_ms),
        )
        return duration, selector

    def upload_files(
        self,
        selectors: list[str],
        file_path: str,
        timeout_ms: int,
        *,
        auto_wait: bool = True,
        wait_state: str = "visible",
        wait_timeout_ms: int | None = None,
        frame_path: list[dict[str, Any]] | None = None,
        frame_locator_chain: list[dict[str, Any]] | None = None,
        scope_selector: str | None = None,
    ) -> tuple[int, str]:
        duration, selector, _, _ = self._run_with_selector_candidates(
            selectors,
            action_name="Upload",
            timeout_ms=timeout_ms,
            auto_wait=auto_wait,
            wait_state=wait_state,
            wait_timeout_ms=wait_timeout_ms,
            screenshot_prefix="upload",
            extra_details={"filePath": file_path},
            frame_path=frame_path,
            frame_locator_chain=frame_locator_chain,
            scope_selector=scope_selector,
            action=lambda locator: locator.set_input_files(file_path, timeout=timeout_ms),
        )
        return duration, selector

    def switch_frame(
        self,
        *,
        selector: str | None = None,
        frame_url: str | None = None,
        index: int | None = None,
        timeout_ms: int,
    ) -> tuple[int, str]:
        page = self._ensure_page()
        started = time.perf_counter()
        try:
            if selector:
                locator = page.locator(selector).first
                locator.wait_for(timeout=timeout_ms)
                frame = locator.element_handle().content_frame()  # type: ignore[union-attr]
                if frame is None:
                    raise RuntimeError("Target selector is not an iframe.")
                self._active_frame = frame
                return int((time.perf_counter() - started) * 1000), f"selector:{selector}"
            if frame_url:
                for frame in page.frames:
                    url = frame.url or ""
                    if frame_url in url:
                        self._active_frame = frame
                        return int((time.perf_counter() - started) * 1000), f"url:{frame_url}"
                raise RuntimeError(f"Frame not found by url: {frame_url}")
            if index is not None:
                frames = page.frames
                if index < 0 or index >= len(frames):
                    raise RuntimeError(f"Frame index out of range: {index}")
                self._active_frame = frames[index]
                return int((time.perf_counter() - started) * 1000), f"index:{index}"
            self._active_frame = None
            return int((time.perf_counter() - started) * 1000), "top"
        except Exception as exc:  # pragma: no cover - runtime dependent
            reason = str(exc)
            raise BrowserActionError(
                code=ELEMENT_NOT_FOUND if "not found" in reason.lower() or "iframe" in reason.lower() else _page_error_code(reason),
                message="Switch frame failed.",
                details={
                    "selector": selector,
                    "frameUrl": frame_url,
                    "index": index,
                    "timeoutMs": timeout_ms,
                    "reason": reason,
                    "screenshot": self.screenshot("switchFrame"),
                },
            ) from exc

    def switch_tab(self, *, index: int | None = None, url: str | None = None, timeout_ms: int) -> tuple[int, str]:
        page = self._ensure_page()
        started = time.perf_counter()
        context = page.context
        try:
            if url:
                tab = context.new_page()
                tab.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
                self._page = tab
                self._active_frame = None
                return int((time.perf_counter() - started) * 1000), f"new:{url}"
            pages = context.pages
            target_index = index if index is not None else 0
            if target_index < 0 or target_index >= len(pages):
                raise RuntimeError(f"Tab index out of range: {target_index}")
            self._page = pages[target_index]
            self._active_frame = None
            self._page.bring_to_front()
            return int((time.perf_counter() - started) * 1000), f"index:{target_index}"
        except Exception as exc:  # pragma: no cover - runtime dependent
            reason = str(exc)
            raise BrowserActionError(
                code=_page_error_code(reason),
                message="Switch tab failed.",
                details={"index": index, "url": url, "timeoutMs": timeout_ms, "reason": reason},
            ) from exc

    def wait_for_selector(
        self,
        selectors: list[str],
        *,
        state: str = "visible",
        text: str | None = None,
        timeout_ms: int,
        frame_path: list[dict[str, Any]] | None = None,
        frame_locator_chain: list[dict[str, Any]] | None = None,
        scope_selector: str | None = None,
    ) -> tuple[int, str]:
        started = time.perf_counter()
        normalized_frame_path = self._normalize_frame_path(frame_path)
        normalized_frame_locator_chain = self._normalize_frame_locator_chain(frame_locator_chain)
        normalized_scope_selector = scope_selector.strip() if isinstance(scope_selector, str) and scope_selector.strip() else None
        candidate_errors: list[dict[str, Any]] = []
        for selector in selectors:
            try:
                target = self._resolve_target(
                    normalized_frame_path,
                    timeout_ms,
                    normalized_frame_locator_chain,
                )
                locator = self._resolve_action_locator(
                    target,
                    selector,
                    scope_selector=normalized_scope_selector,
                    timeout_ms=timeout_ms,
                )
                locator.wait_for(state=state, timeout=timeout_ms)
                if text is not None:
                    content = locator.text_content(timeout=timeout_ms) or ""
                    if text not in content:
                        raise RuntimeError(f"Text not found in selector: {selector}")
                return int((time.perf_counter() - started) * 1000), selector
            except BrowserActionError:
                raise
            except Exception as exc:  # pragma: no cover - runtime dependent
                candidate_errors.append({"selector": selector, "scopeSelector": normalized_scope_selector, "reason": str(exc)})
        last_error = candidate_errors[-1]["reason"] if candidate_errors else "unknown"
        raise BrowserActionError(
            code=ELEMENT_NOT_FOUND,
            message="Wait for selector failed with all selector candidates.",
            details={
                "selectors": selectors,
                "state": state,
                "text": text,
                "framePath": normalized_frame_path,
                "frameLocatorChain": normalized_frame_locator_chain,
                "scopeSelector": normalized_scope_selector,
                "timeoutMs": timeout_ms,
                "reason": last_error,
                "candidateErrors": candidate_errors,
                "screenshot": self.screenshot("wait"),
            },
        )

    def wait_for_network_idle(self, timeout_ms: int) -> int:
        page = self._ensure_page()
        started = time.perf_counter()
        try:
            page.wait_for_load_state("networkidle", timeout=timeout_ms)
        except Exception as exc:  # pragma: no cover - runtime dependent
            reason = str(exc)
            raise BrowserActionError(
                code=_page_error_code(reason),
                message="Wait for network idle failed.",
                details={"timeoutMs": timeout_ms, "reason": reason},
            ) from exc
        return int((time.perf_counter() - started) * 1000)

    def extract_text(
        self,
        selectors: list[str],
        timeout_ms: int,
        *,
        auto_wait: bool = True,
        wait_state: str = "visible",
        wait_timeout_ms: int | None = None,
        frame_path: list[dict[str, Any]] | None = None,
        frame_locator_chain: list[dict[str, Any]] | None = None,
        scope_selector: str | None = None,
    ) -> tuple[int, str, str]:
        duration, selector, _, raw_text = self._run_with_selector_candidates(
            selectors,
            action_name="Extract",
            timeout_ms=timeout_ms,
            auto_wait=auto_wait,
            wait_state=wait_state,
            wait_timeout_ms=wait_timeout_ms,
            screenshot_prefix="extract",
            frame_path=frame_path,
            frame_locator_chain=frame_locator_chain,
            scope_selector=scope_selector,
            action=lambda locator: locator.text_content(timeout=timeout_ms) or "",
        )
        text = raw_text if isinstance(raw_text, str) else str(raw_text)
        return duration, selector, text

    def element_count(
        self,
        selectors: list[str],
        timeout_ms: int,
        *,
        auto_wait: bool = True,
        wait_state: str = "attached",
        wait_timeout_ms: int | None = None,
        frame_path: list[dict[str, Any]] | None = None,
        frame_locator_chain: list[dict[str, Any]] | None = None,
        scope_selector: str | None = None,
    ) -> tuple[int, str, int]:
        duration, selector, _, raw_count = self._run_with_selector_candidates(
            selectors,
            action_name="Count",
            timeout_ms=timeout_ms,
            auto_wait=auto_wait,
            wait_state=wait_state,
            wait_timeout_ms=wait_timeout_ms,
            screenshot_prefix="count",
            frame_path=frame_path,
            frame_locator_chain=frame_locator_chain,
            scope_selector=scope_selector,
            action=lambda locator: locator.count(),
        )
        count = int(raw_count) if isinstance(raw_count, (int, float)) else 0
        return duration, selector, count

    def table_extract(
        self,
        selector: str,
        timeout_ms: int,
        *,
        row_selector: str = "tr",
        cell_selector: str = "th,td",
        frame_path: list[dict[str, Any]] | None = None,
        frame_locator_chain: list[dict[str, Any]] | None = None,
        scope_selector: str | None = None,
    ) -> tuple[int, list[list[str]]]:
        started = time.perf_counter()
        normalized_frame_path = self._normalize_frame_path(frame_path)
        normalized_frame_locator_chain = self._normalize_frame_locator_chain(frame_locator_chain)
        normalized_scope_selector = scope_selector.strip() if isinstance(scope_selector, str) and scope_selector.strip() else None
        normalized_row_selector = row_selector.strip() if isinstance(row_selector, str) and row_selector.strip() else "tr"
        normalized_cell_selector = cell_selector.strip() if isinstance(cell_selector, str) and cell_selector.strip() else "th,td"
        try:
            target = self._resolve_target(
                normalized_frame_path,
                timeout_ms,
                normalized_frame_locator_chain,
            )
            if normalized_scope_selector:
                scope = target.locator(normalized_scope_selector).first
                scope.wait_for(state="attached", timeout=timeout_ms)
                target = scope
            rows = target.locator(f"{selector} {normalized_row_selector}")
            rows.first.wait_for(timeout=timeout_ms, state="attached")
            result: list[list[str]] = []
            row_count = rows.count()
            for idx in range(row_count):
                cells = rows.nth(idx).locator(normalized_cell_selector)
                cell_values = [((cells.nth(cell_idx).inner_text() or "").strip()) for cell_idx in range(cells.count())]
                result.append(cell_values)
            return int((time.perf_counter() - started) * 1000), result
        except BrowserActionError:
            raise
        except Exception as exc:  # pragma: no cover - runtime dependent
            reason = str(exc)
            raise BrowserActionError(
                code=ELEMENT_NOT_FOUND if "selector" in reason.lower() or "locator" in reason.lower() else _page_error_code(reason),
                message="Table extract failed.",
                details={
                    "selector": selector,
                    "rowSelector": normalized_row_selector,
                    "cellSelector": normalized_cell_selector,
                    "scopeSelector": normalized_scope_selector,
                    "timeoutMs": timeout_ms,
                    "framePath": normalized_frame_path,
                    "frameLocatorChain": normalized_frame_locator_chain,
                    "reason": reason,
                },
            ) from exc

    def locate_row(
        self,
        selectors: list[str],
        timeout_ms: int,
        *,
        row_selector: str = "tr",
        cell_selector: str = "th,td",
        match_mode: str = "index",
        row_index: int = 0,
        text: str | None = None,
        column_index: int = -1,
        case_sensitive: bool = False,
        match_rules: list[dict[str, Any]] | None = None,
        rules_logic: str = "all",
        frame_path: list[dict[str, Any]] | None = None,
        frame_locator_chain: list[dict[str, Any]] | None = None,
        scope_selector: str | None = None,
    ) -> tuple[int, str, dict[str, Any]]:
        started = time.perf_counter()
        normalized_frame_path = self._normalize_frame_path(frame_path)
        normalized_frame_locator_chain = self._normalize_frame_locator_chain(frame_locator_chain)
        normalized_scope_selector = scope_selector.strip() if isinstance(scope_selector, str) and scope_selector.strip() else None
        normalized_row_selector = row_selector.strip() if isinstance(row_selector, str) and row_selector.strip() else "tr"
        normalized_cell_selector = cell_selector.strip() if isinstance(cell_selector, str) and cell_selector.strip() else "th,td"
        normalized_mode = (match_mode or "index").strip().lower()
        if normalized_mode not in {"index", "contains", "equals", "regex"}:
            normalized_mode = "index"
        normalized_text = text if isinstance(text, str) else ""
        effective_mode = normalized_mode
        normalized_rules_logic = (rules_logic or "all").strip().lower()
        if normalized_rules_logic not in {"all", "any"}:
            normalized_rules_logic = "all"
        normalized_match_rules: list[dict[str, Any]] = []
        if isinstance(match_rules, list):
            for raw_rule in match_rules:
                if not isinstance(raw_rule, dict):
                    continue
                raw_rule_mode = raw_rule.get("mode")
                rule_mode = str(raw_rule_mode).strip().lower() if raw_rule_mode is not None else "contains"
                if rule_mode not in {"contains", "equals", "regex"}:
                    rule_mode = "contains"
                raw_rule_text = raw_rule.get("text")
                if not isinstance(raw_rule_text, str) or not raw_rule_text:
                    continue
                raw_rule_column = raw_rule.get("columnIndex")
                if isinstance(raw_rule_column, bool):
                    rule_column = -1
                elif isinstance(raw_rule_column, int):
                    rule_column = int(raw_rule_column)
                elif isinstance(raw_rule_column, float):
                    rule_column = int(raw_rule_column)
                elif isinstance(raw_rule_column, str) and raw_rule_column.strip().lstrip("-").isdigit():
                    rule_column = int(raw_rule_column.strip())
                else:
                    rule_column = -1
                if rule_column < -1:
                    rule_column = -1
                rule_case_sensitive = bool(raw_rule.get("caseSensitive")) if isinstance(raw_rule.get("caseSensitive"), bool) else case_sensitive
                normalized_match_rules.append(
                    {
                        "mode": rule_mode,
                        "text": raw_rule_text,
                        "columnIndex": rule_column,
                        "caseSensitive": rule_case_sensitive,
                    }
                )
        use_index_match = normalized_mode == "index" and not normalized_match_rules
        if not use_index_match and normalized_mode == "index":
            effective_mode = "contains"
        candidate_errors: list[dict[str, Any]] = []

        def extract_row_values(row_locator: Any) -> list[str]:
            cells = row_locator.locator(normalized_cell_selector)
            cell_count = cells.count()
            if cell_count <= 0:
                fallback = (row_locator.inner_text() or "").strip()
                return [fallback] if fallback else []
            return [((cells.nth(cell_idx).inner_text() or "").strip()) for cell_idx in range(cell_count)]

        def resolve_candidate_text(values: list[str], candidate_column: int) -> str:
            if candidate_column >= 0:
                if candidate_column < len(values):
                    return values[candidate_column]
                return ""
            return " ".join(item for item in values if item).strip()

        def evaluate_text_rule(
            candidate_text: str,
            *,
            candidate_mode: str,
            candidate_text_rule: str,
            candidate_case_sensitive: bool,
        ) -> bool:
            haystack = candidate_text if candidate_case_sensitive else candidate_text.lower()
            needle = candidate_text_rule if candidate_case_sensitive else candidate_text_rule.lower()
            if candidate_mode == "contains":
                return needle in haystack
            if candidate_mode == "equals":
                return needle == haystack
            flags = 0 if candidate_case_sensitive else re.IGNORECASE
            return bool(re.search(candidate_text_rule, candidate_text, flags=flags))

        for selector in selectors:
            try:
                target = self._resolve_target(
                    normalized_frame_path,
                    timeout_ms,
                    normalized_frame_locator_chain,
                )
                if normalized_scope_selector:
                    scope = target.locator(normalized_scope_selector).first
                    scope.wait_for(state="attached", timeout=timeout_ms)
                    target = scope
                rows = target.locator(f"{selector} {normalized_row_selector}")
                rows.first.wait_for(timeout=timeout_ms, state="attached")
                row_count = rows.count()
                if row_count <= 0:
                    raise RuntimeError("No rows found.")
                matched_index = -1
                matched_row_values: list[str] = []
                if use_index_match:
                    candidate_index = max(int(row_index), 0)
                    if candidate_index >= row_count:
                        raise RuntimeError(f"Row index out of range: {candidate_index}/{row_count}")
                    matched_index = candidate_index
                    matched_row_values = extract_row_values(rows.nth(matched_index))
                else:
                    if not normalized_match_rules and not normalized_text:
                        raise RuntimeError("Text is required for non-index match mode.")
                    for idx in range(row_count):
                        values = extract_row_values(rows.nth(idx))
                        matched = False
                        if normalized_match_rules:
                            rule_results: list[bool] = []
                            for rule in normalized_match_rules:
                                candidate_text = resolve_candidate_text(values, int(rule.get("columnIndex", -1)))
                                try:
                                    rule_results.append(
                                        evaluate_text_rule(
                                            candidate_text,
                                            candidate_mode=str(rule.get("mode", "contains")),
                                            candidate_text_rule=str(rule.get("text", "")),
                                            candidate_case_sensitive=bool(rule.get("caseSensitive", False)),
                                        )
                                    )
                                except re.error as regex_error:
                                    raise RuntimeError(f"Invalid regex: {regex_error}") from regex_error
                            matched = all(rule_results) if normalized_rules_logic == "all" else any(rule_results)
                        else:
                            try:
                                candidate_text = resolve_candidate_text(values, column_index if isinstance(column_index, int) else -1)
                                matched = evaluate_text_rule(
                                    candidate_text,
                                    candidate_mode=effective_mode,
                                    candidate_text_rule=normalized_text,
                                    candidate_case_sensitive=case_sensitive,
                                )
                            except re.error as regex_error:
                                raise RuntimeError(f"Invalid regex: {regex_error}") from regex_error
                        if matched:
                            matched_index = idx
                            matched_row_values = values
                            break
                    if matched_index < 0:
                        raise RuntimeError("No matching row found.")
                row_text = " ".join(item for item in matched_row_values if item).strip()
                row_selector_out = f"{selector} {normalized_row_selector}:nth-of-type({matched_index + 1})"
                payload = {
                    "rowIndex": matched_index,
                    "rowCount": row_count,
                    "rowSelector": row_selector_out,
                    "row": matched_row_values,
                    "rowText": row_text,
                    "matchMode": effective_mode,
                    "rulesLogic": normalized_rules_logic if normalized_match_rules else None,
                }
                return int((time.perf_counter() - started) * 1000), selector, payload
            except BrowserActionError:
                raise
            except Exception as exc:  # pragma: no cover - runtime dependent
                candidate_errors.append({"selector": selector, "scopeSelector": normalized_scope_selector, "reason": str(exc)})
        last_error = candidate_errors[-1]["reason"] if candidate_errors else "unknown"
        duration_ms = int((time.perf_counter() - started) * 1000)
        raise BrowserActionError(
            code=ELEMENT_NOT_FOUND,
            message="Row locate failed with all selector candidates.",
            details={
                "selectors": selectors,
                "rowSelector": normalized_row_selector,
                "cellSelector": normalized_cell_selector,
                "matchMode": normalized_mode,
                "rowIndex": row_index,
                "text": normalized_text,
                "columnIndex": column_index,
                "caseSensitive": case_sensitive,
                "matchRules": normalized_match_rules,
                "rulesLogic": normalized_rules_logic,
                "scopeSelector": normalized_scope_selector,
                "timeoutMs": timeout_ms,
                "framePath": normalized_frame_path,
                "frameLocatorChain": normalized_frame_locator_chain,
                "durationMs": duration_ms,
                "reason": last_error,
                "candidateErrors": candidate_errors,
                "screenshot": self.screenshot("rowLocate"),
            },
        )

    def current_url(self) -> str:
        page = self._ensure_page()
        return page.url

    def wait(self, ms: int) -> int:
        page = self._page
        started = time.perf_counter()
        if page is not None:
            page.wait_for_timeout(ms)
        else:
            time.sleep(ms / 1000)
        return int((time.perf_counter() - started) * 1000)

    def screenshot(self, prefix: str, *, full_page: bool = True) -> str | None:
        page = self._page
        if page is None:
            return None
        output = Path(gettempdir()) / f"rpa_agent_{prefix}_{int(time.time() * 1000)}.png"
        try:
            page.screenshot(path=str(output), full_page=full_page)
        except Exception:  # pragma: no cover - runtime dependent
            return None
        return str(output)

    def close(self) -> None:
        if self._context is not None:
            self._context.close()
            self._context = None
        if self._browser is not None:
            self._browser.close()
            self._browser = None
        if self._playwright is not None:
            self._playwright.stop()
            self._playwright = None
        self._page = None
        self._active_frame = None
