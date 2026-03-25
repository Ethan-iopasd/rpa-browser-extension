from __future__ import annotations

import time
from dataclasses import dataclass
from threading import Lock
from typing import Any, Callable
import re
from urllib.parse import parse_qsl, urlencode, urlparse

from agent.models.contracts import PickerResult
from agent.models.error_codes import PICKER_CANCELED, PICKER_EXECUTION_FAILED, PICKER_TIMEOUT
from agent.runtime.browser_session import browser_runtime_available
from agent.runtime.picker_core import PickerPayloadError, build_picker_result
from agent.runtime.picker_policy import get_picker_selector_policy

PICKER_CDP_SCRIPT_VERSION = "cdp-2026-02-24.8"

PICKER_CDP_EXTRACT_FUNCTION = r"""
function () {
  const SCRIPT_VERSION = "cdp-2026-02-24.8";

  function safeText(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.replace(/\s+/g, " ").trim();
  }

  function compactUrl(value) {
    return String(value || "").replace(/\s+/g, "");
  }

  function q(value) {
    return JSON.stringify(String(value)).slice(1, -1);
  }

  function cssEscape(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function addCandidate(list, type, value, score) {
    if (!value || typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (list.some(item => item.type === type && item.value === trimmed)) {
      return;
    }
    list.push({
      type,
      value: trimmed,
      score: Math.max(0, Math.min(1, Number(score) || 0.5)),
      primary: false
    });
  }

  function isDynamicIdentifier(value) {
    if (typeof value !== "string") {
      return false;
    }
    const token = value.trim();
    if (!token) {
      return false;
    }
    if (/(auto-id|x-urs-iframe|mgid|timestamp|nonce|session|token|random|rand|traceid|guid|uuid)/i.test(token)) {
      return true;
    }
    if (/\d{6,}/.test(token)) {
      return true;
    }
    if (/[a-f0-9]{12,}/i.test(token)) {
      return true;
    }
    return false;
  }

  function buildCssPath(el) {
    if (!(el instanceof Element)) {
      return "";
    }
    const parts = [];
    let currentEl = el;
    while (currentEl && currentEl.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
      const tag = (currentEl.tagName || "").toLowerCase();
      if (!tag) {
        break;
      }
      if (currentEl.id) {
        parts.unshift(`${tag}#${cssEscape(currentEl.id)}`);
        break;
      }
      let segment = tag;
      if (currentEl.classList && currentEl.classList.length > 0) {
        const className = [...currentEl.classList].find(name => typeof name === "string" && name.trim().length > 0);
        if (className) {
          segment += `.${cssEscape(className)}`;
        }
      }
      const parent = currentEl.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(item => item.tagName === currentEl.tagName);
        if (siblings.length > 1) {
          segment += `:nth-of-type(${siblings.indexOf(currentEl) + 1})`;
        }
      }
      parts.unshift(segment);
      currentEl = parent;
    }
    return parts.join(" > ");
  }

  function buildXPath(el) {
    if (!(el instanceof Element)) {
      return "";
    }
    if (el.id) {
      return `//*[@id="${q(el.id)}"]`;
    }
    const segments = [];
    let currentEl = el;
    while (currentEl && currentEl.nodeType === Node.ELEMENT_NODE) {
      const tag = (currentEl.tagName || "").toLowerCase();
      if (!tag) {
        break;
      }
      const parent = currentEl.parentElement;
      if (!parent) {
        segments.unshift(tag);
        break;
      }
      const siblings = Array.from(parent.children).filter(item => item.tagName === currentEl.tagName);
      const index = siblings.indexOf(currentEl) + 1;
      segments.unshift(`${tag}[${index}]`);
      currentEl = parent;
    }
    return segments.length > 0 ? `/${segments.join("/")}` : "";
  }

  function inferRole(el) {
    const explicit = safeText(el.getAttribute("role"));
    if (explicit) {
      return explicit;
    }
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "button") {
      return "button";
    }
    if (tag === "a" && safeText(el.getAttribute("href"))) {
      return "link";
    }
    if (tag === "input") {
      const type = safeText(el.getAttribute("type")).toLowerCase();
      if (type === "button" || type === "submit" || type === "reset") {
        return "button";
      }
      if (type === "checkbox") {
        return "checkbox";
      }
      if (type === "radio") {
        return "radio";
      }
      return "textbox";
    }
    if (tag === "textarea") {
      return "textbox";
    }
    if (tag === "select") {
      return "combobox";
    }
    return "";
  }

  function inferName(el) {
    const attrs = [
      ["aria-label", el.getAttribute("aria-label")],
      ["title", el.getAttribute("title")],
      ["name", el.getAttribute("name")],
      ["placeholder", el.getAttribute("placeholder")],
      ["text", el.textContent]
    ];
    for (const [source, item] of attrs) {
      const text = safeText(item || "");
      if (text) {
        return { value: text.slice(0, 120), source };
      }
    }
    return { value: "", source: "" };
  }

  function buildCandidates(el) {
    const candidates = [];
    const id = safeText(el.getAttribute("id"));
    const dataTestId = safeText(el.getAttribute("data-testid"));
    const ariaLabel = safeText(el.getAttribute("aria-label"));
    const nameAttr = safeText(el.getAttribute("name"));
    const role = inferRole(el);
    const inferredName = inferName(el);
    const name = inferredName.value;
    const nameSource = inferredName.source;
    const text = safeText(el.textContent || "");
    if (role && name) {
      let roleScore = 0.90;
      if (nameSource === "placeholder" || nameSource === "text") {
        roleScore = 0.72;
      } else if (nameSource === "name") {
        roleScore = 0.86;
      }
      addCandidate(candidates, "playwright", `role=${role}[name="${q(name)}"]`, roleScore);
    }
    if (id) {
      addCandidate(candidates, "css", `#${cssEscape(id)}`, isDynamicIdentifier(id) ? 0.30 : 0.92);
    }
    if (dataTestId) {
      addCandidate(candidates, "css", `[data-testid="${q(dataTestId)}"]`, 0.99);
    }
    if (ariaLabel) {
      addCandidate(candidates, "css", `[aria-label="${q(ariaLabel)}"]`, 0.94);
    }
    if (nameAttr) {
      addCandidate(candidates, "css", `[name="${q(nameAttr)}"]`, isDynamicIdentifier(nameAttr) ? 0.35 : 0.95);
    }
    if (text) {
      addCandidate(candidates, "text", `text=${text.slice(0, 80)}`, 0.55);
    }
    const cssPath = buildCssPath(el);
    if (cssPath) {
      addCandidate(candidates, "css", cssPath, 0.62);
    }
    const xpath = buildXPath(el);
    if (xpath) {
      addCandidate(candidates, "xpath", xpath, 0.45);
    }
    if (candidates.length > 0) {
      let bestIndex = 0;
      for (let i = 1; i < candidates.length; i += 1) {
        if ((Number(candidates[i].score) || 0) > (Number(candidates[bestIndex].score) || 0)) {
          bestIndex = i;
        }
      }
      candidates[bestIndex].primary = true;
    }
    return candidates;
  }

  function elementMeta(el) {
    const rect = el.getBoundingClientRect();
    return {
      tagName: (el.tagName || "").toLowerCase(),
      id: safeText(el.getAttribute("id") || ""),
      className: safeText(el.className || ""),
      name: safeText(el.getAttribute("name") || ""),
      text: safeText(el.textContent || "").slice(0, 120),
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function buildFramePath() {
    const segments = [];
    let currentWindow = window;
    let guard = 0;
    while (currentWindow && currentWindow !== currentWindow.top && guard < 8) {
      guard += 1;
      let frameElement = null;
      try {
        frameElement = currentWindow.frameElement;
      } catch (error) {
        frameElement = null;
      }
      if (!(frameElement instanceof Element)) {
        break;
      }

      const id = safeText(frameElement.getAttribute("id"));
      const name = safeText(frameElement.getAttribute("name"));
      const src = compactUrl(frameElement.getAttribute("src"));
      const parent = frameElement.parentElement;
      let index = -1;
      if (parent) {
        const siblings = Array.from(parent.children).filter(node => {
          const tag = (node.tagName || "").toLowerCase();
          return tag === "iframe" || tag === "frame";
        });
        index = siblings.indexOf(frameElement);
      }

      let crossOrigin = false;
      try {
        crossOrigin = Boolean(
          currentWindow.parent &&
          currentWindow.parent !== currentWindow &&
          currentWindow.location.origin !== currentWindow.parent.location.origin
        );
      } catch (error) {
        crossOrigin = true;
      }

      const selectorCandidates = [];
      if (id) {
        addCandidate(selectorCandidates, "css", `iframe#${cssEscape(id)}`, 0.92);
      }
      if (name) {
        addCandidate(selectorCandidates, "css", `iframe[name="${q(name)}"]`, 0.88);
      }
      if (src) {
        addCandidate(selectorCandidates, "css", `iframe[src*="${q(src.slice(0, 80))}"]`, 0.5);
      }
      if (selectorCandidates.length > 0) {
        selectorCandidates[0].primary = true;
      }

      const hint = name || (id ? `#${id}` : `frame[${index}]`);
      segments.unshift({
        index,
        hint,
        name: name || null,
        id: id || null,
        src: src || null,
        selector: null,
        crossOrigin,
        selectorCandidates
      });

      try {
        currentWindow = currentWindow.parent;
      } catch (error) {
        break;
      }
    }
    return segments;
  }

  const target = this;
  if (!(target instanceof Element)) {
    return { error: "target-not-element", scriptVersion: SCRIPT_VERSION };
  }

  const selectorCandidates = buildCandidates(target);
  if (selectorCandidates.length === 0) {
    return { error: "no-selector-candidates", scriptVersion: SCRIPT_VERSION };
  }

  const playwrightCandidates = selectorCandidates.filter(item => item.type === "playwright" || item.type === "role");
  const primarySelectorCandidate =
    selectorCandidates.find(item => item && item.primary) ||
    selectorCandidates[0];
  const framePath = buildFramePath();
  const frameLocatorChain = framePath.map((segment, depth) => {
    const primaryCandidate =
      segment.selectorCandidates.find(item => item && item.primary) ||
      segment.selectorCandidates[0] ||
      null;
    return {
      depth,
      hint: segment.hint || `frame[${segment.index}]`,
      crossOrigin: Boolean(segment.crossOrigin),
      index: Number.isInteger(segment.index) ? segment.index : -1,
      primary: primaryCandidate ? primaryCandidate.value : null,
      selectorCandidates: Array.isArray(segment.selectorCandidates) ? segment.selectorCandidates : []
    };
  });

  const labels = ["top"];
  for (const segment of framePath) {
    labels.push(segment.hint || "frame");
  }

  return {
    pickerAdapter: "cdp",
    pickerScriptVersion: SCRIPT_VERSION,
    selector: primarySelectorCandidate.value,
    selectorType: primarySelectorCandidate.type,
    selectorCandidates,
    playwrightPrimary: playwrightCandidates[0] || null,
    playwrightCandidates,
    elementMeta: elementMeta(target),
    pageUrl: compactUrl(window.location.href || ""),
    framePath,
    frameLocatorChain,
    framePathString: labels.join(" > ")
  };
}
"""


@dataclass
class PickerRuntimeError(Exception):
    code: str
    message: str
    details: dict[str, Any]

    def __str__(self) -> str:
        return self.message


def _append_cdp_error(diagnostics: dict[str, Any], method: str, reason: str) -> None:
    errors = diagnostics.get("cdpErrors")
    if not isinstance(errors, list):
        errors = []
        diagnostics["cdpErrors"] = errors
    if len(errors) >= 8:
        return
    errors.append({"method": method, "reason": reason})


def _cdp_send(cdp: Any, method: str, params: dict[str, Any] | None, diagnostics: dict[str, Any]) -> dict[str, Any]:
    try:
        return cdp.send(method, params or {})
    except Exception as exc:
        _append_cdp_error(diagnostics, method, str(exc))
        raise


def _url_origin(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def _compact_url(url: str) -> str:
    return "".join(url.split()).strip()


_SELECTOR_POLICY = get_picker_selector_policy()
_FRAME_SELECTOR_POLICY = (
    _SELECTOR_POLICY.get("frame", {}) if isinstance(_SELECTOR_POLICY.get("frame", {}), dict) else {}
)


def _frame_policy_list(key: str, default: list[str]) -> list[str]:
    raw = _FRAME_SELECTOR_POLICY.get(key)
    if not isinstance(raw, list):
        return default
    values: list[str] = []
    for item in raw:
        if isinstance(item, str) and item.strip():
            values.append(item.strip())
    return values or default


def _frame_policy_bool(key: str, default: bool) -> bool:
    raw = _FRAME_SELECTOR_POLICY.get(key)
    if isinstance(raw, bool):
        return raw
    return default


def _frame_policy_int(key: str, default: int) -> int:
    raw = _FRAME_SELECTOR_POLICY.get(key)
    if isinstance(raw, int):
        return raw
    return default


def _frame_policy_scores() -> dict[str, float]:
    raw = _FRAME_SELECTOR_POLICY.get("scores")
    if not isinstance(raw, dict):
        return {}
    result: dict[str, float] = {}
    for key, value in raw.items():
        if isinstance(key, str) and isinstance(value, (int, float)):
            result[key.strip()] = float(value)
    return result


@dataclass(frozen=True)
class _AttributeFilterRule:
    attribute: re.Pattern[str]
    value: re.Pattern[str]
    include: bool


def _compile_dynamic_identifier_patterns() -> list[re.Pattern[str]]:
    patterns = _frame_policy_list(
        "dynamicIdentifierRegexes",
        [r"(auto-id|x-urs-iframe|mgid|timestamp|nonce|session|token|random|rand|traceid|guid|uuid)", r"\d{6,}", r"[a-f0-9]{12,}"],
    )
    compiled: list[re.Pattern[str]] = []
    for item in patterns:
        try:
            compiled.append(re.compile(item, re.IGNORECASE))
        except re.error:
            continue
    return compiled


def _compile_attribute_filter_rules() -> list[_AttributeFilterRule]:
    raw = _FRAME_SELECTOR_POLICY.get("attributeFilters")
    if not isinstance(raw, list):
        return []
    rules: list[_AttributeFilterRule] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        attribute = item.get("attribute")
        value = item.get("value")
        include_raw = item.get("include")
        if not isinstance(attribute, str) or not attribute.strip():
            continue
        if not isinstance(value, str) or not value.strip():
            continue
        try:
            attribute_pattern = re.compile(attribute.strip(), re.IGNORECASE)
            value_pattern = re.compile(value.strip(), re.IGNORECASE)
        except re.error:
            continue
        rules.append(
            _AttributeFilterRule(
                attribute=attribute_pattern,
                value=value_pattern,
                include=True if include_raw is None else bool(include_raw),
            )
        )
    return rules


_DYNAMIC_IDENTIFIER_PATTERNS = _compile_dynamic_identifier_patterns()
_ATTRIBUTE_FILTER_RULES = _compile_attribute_filter_rules()
_DYNAMIC_QUERY_KEYS = {item.lower() for item in _frame_policy_list("dynamicQueryKeys", [])}
_STABLE_QUERY_ALLOWLIST = {item.lower() for item in _frame_policy_list("stableQueryAllowlist", ["product"])}
_FRAME_SELECTOR_PRIORITY = _frame_policy_list(
    "selectorPriority",
    ["src_allowlist_query", "src_base", "nth_of_type", "name_stable", "id_stable", "name_dynamic", "id_dynamic"],
)
_FRAME_SCORES = _frame_policy_scores()


def _attribute_filter_include(attribute_name: str, value: str) -> bool:
    token = attribute_name.strip()
    if not token:
        return True
    for rule in _ATTRIBUTE_FILTER_RULES:
        if rule.attribute.search(token) and rule.value.search(value):
            return rule.include
    return True


def _is_dynamic_identifier(value: str | None, *, attribute_name: str | None = None) -> bool:
    if not isinstance(value, str):
        return False
    token = value.strip()
    if not token:
        return False
    if isinstance(attribute_name, str) and attribute_name.strip():
        if not _attribute_filter_include(attribute_name, token):
            return True
    for pattern in _DYNAMIC_IDENTIFIER_PATTERNS:
        if pattern.search(token):
            return True
    return False


def _css_attr_quote(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _sanitize_url_like(value: str | None) -> str:
    return _compact_url(value or "")


def _stable_src_fragment(url: str | None) -> str:
    compact = _sanitize_url_like(url)
    if not compact:
        return ""
    parsed = urlparse(compact)
    host = parsed.netloc.lower()
    path = parsed.path or ""
    base = f"{host}{path}".strip()
    if not base:
        return compact[:120]
    kept_params: list[tuple[str, str]] = []
    max_param_value_length = max(8, _frame_policy_int("maxParamValueLength", 64))
    max_query_params = max(0, _frame_policy_int("maxQueryParams", 2))
    max_src_fragment_length = max(80, _frame_policy_int("maxSrcFragmentLength", 180))
    for key, value in parse_qsl(parsed.query, keep_blank_values=False):
        lowered = key.lower().strip()
        if lowered in _DYNAMIC_QUERY_KEYS:
            continue
        if lowered not in _STABLE_QUERY_ALLOWLIST:
            continue
        if not _attribute_filter_include(lowered, value):
            continue
        if _is_dynamic_identifier(value, attribute_name=lowered):
            continue
        if len(value) > max_param_value_length:
            continue
        kept_params.append((key.strip(), value.strip()))
    if kept_params:
        kept_params.sort(key=lambda item: item[0])
        query = urlencode(kept_params[:max_query_params], doseq=True)
        return f"{base}?{query}"[:max_src_fragment_length]
    return base[:max_src_fragment_length]


def _src_selector_fragments(url: str | None) -> list[tuple[str, str]]:
    compact = _sanitize_url_like(url)
    if not compact:
        return []
    parsed = urlparse(compact)
    host = parsed.netloc.lower()
    path = parsed.path or ""
    base = f"{host}{path}".strip()
    max_src_fragment_length = max(80, _frame_policy_int("maxSrcFragmentLength", 180))
    if not base:
        return [("src_base", compact[:max_src_fragment_length])]
    fragments: list[tuple[str, str]] = [("src_base", base[:max_src_fragment_length])]
    stable = _stable_src_fragment(compact)
    if stable and stable != base:
        fragments.append(("src_allowlist_query", stable))
    unique: list[tuple[str, str]] = []
    seen: set[str] = set()
    for kind, value in fragments:
        if value and value not in seen:
            seen.add(value)
            unique.append((kind, value))
    return unique


def _attributes_to_map(raw: Any) -> dict[str, str]:
    if not isinstance(raw, list):
        return {}
    attrs: dict[str, str] = {}
    for index in range(0, len(raw) - 1, 2):
        key = raw[index]
        value = raw[index + 1]
        if isinstance(key, str) and isinstance(value, str):
            attrs[key] = value
    return attrs


def _find_selected_frame_id(cdp: Any, node_id: int, diagnostics: dict[str, Any]) -> str | None:
    current_id = node_id
    for _ in range(256):
        try:
            described = _cdp_send(cdp, "DOM.describeNode", {"nodeId": current_id, "depth": 0}, diagnostics)
        except Exception:
            return None
        node = described.get("node") if isinstance(described, dict) else None
        if not isinstance(node, dict):
            return None
        frame_id = node.get("frameId")
        if isinstance(frame_id, str) and frame_id.strip():
            return frame_id.strip()
        parent_id = node.get("parentId")
        if not isinstance(parent_id, int) or parent_id <= 0:
            return None
        current_id = parent_id
    return None


def _frame_depth(frame_id: str, index: dict[str, dict[str, Any]]) -> int:
    depth = 0
    current_id: str | None = frame_id
    guard = 0
    while current_id and current_id in index and guard < 256:
        guard += 1
        parent_id = index[current_id].get("parentId")
        if not isinstance(parent_id, str) or not parent_id:
            break
        depth += 1
        current_id = parent_id
    return depth


def _find_frame_id_by_page_url(cdp: Any, page_url: str, diagnostics: dict[str, Any]) -> str | None:
    normalized_target = _compact_url(page_url)
    if not normalized_target:
        return None
    try:
        frame_tree_resp = _cdp_send(cdp, "Page.getFrameTree", None, diagnostics)
    except Exception:
        return None
    frame_tree = frame_tree_resp.get("frameTree") if isinstance(frame_tree_resp, dict) else None
    if not isinstance(frame_tree, dict):
        return None
    frame_index: dict[str, dict[str, Any]] = {}
    _flatten_frame_tree(frame_tree, parent_id=None, child_index=0, index=frame_index)
    candidates: list[str] = []
    for frame_id, meta in frame_index.items():
        frame_url = str(meta.get("url") or "")
        normalized_frame_url = _compact_url(frame_url)
        if not normalized_frame_url:
            continue
        if normalized_frame_url == normalized_target:
            candidates.append(frame_id)
            continue
        # Fuzzy fallback for sites appending transient params.
        if normalized_target in normalized_frame_url or normalized_frame_url in normalized_target:
            candidates.append(frame_id)
    if not candidates:
        return None
    candidates.sort(key=lambda item: _frame_depth(item, frame_index), reverse=True)
    return candidates[0]


def _flatten_frame_tree(
    frame_tree: dict[str, Any],
    *,
    parent_id: str | None,
    child_index: int,
    index: dict[str, dict[str, Any]],
) -> None:
    frame = frame_tree.get("frame") if isinstance(frame_tree, dict) else None
    if isinstance(frame, dict):
        frame_id = frame.get("id")
        if isinstance(frame_id, str) and frame_id.strip():
            index[frame_id] = {
                "id": frame_id,
                "url": str(frame.get("url") or ""),
                "name": str(frame.get("name") or ""),
                "parentId": parent_id,
                "childIndex": child_index,
            }
            child_frames = frame_tree.get("childFrames")
            if isinstance(child_frames, list):
                for idx, child in enumerate(child_frames):
                    if isinstance(child, dict):
                        _flatten_frame_tree(child, parent_id=frame_id, child_index=idx, index=index)


def _selector_candidates_for_frame_owner(
    *,
    frame_id_attr: str | None,
    frame_name_attr: str | None,
    frame_src_attr: str | None,
    frame_index: int,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _score(kind: str, fallback: float) -> float:
        value = _FRAME_SCORES.get(kind)
        if isinstance(value, (float, int)):
            return float(value)
        return fallback

    def _priority(kind: str) -> int:
        try:
            return _FRAME_SELECTOR_PRIORITY.index(kind)
        except ValueError:
            return len(_FRAME_SELECTOR_PRIORITY) + 10

    def _push(kind: str, value: str, score: float) -> None:
        normalized = value.strip()
        if not normalized or normalized in seen:
            return
        seen.add(normalized)
        candidates.append(
            {
                "kind": kind,
                "type": "css",
                "value": normalized,
                "score": score,
                "primary": False,
            }
        )

    src_fragments = _src_selector_fragments(frame_src_attr)
    has_stable_src = len(src_fragments) > 0
    dynamic_name = _is_dynamic_identifier(frame_name_attr, attribute_name="name")
    dynamic_id = _is_dynamic_identifier(frame_id_attr, attribute_name="id")
    for kind, fragment in src_fragments:
        _push(kind, f'iframe[src*="{_css_attr_quote(fragment)}"]', _score(kind, 0.9))
    if frame_index >= 0 and _frame_policy_bool("includeNthOfType", True):
        _push("nth_of_type", f"iframe:nth-of-type({frame_index + 1})", _score("nth_of_type", 0.72))

    if frame_name_attr:
        quoted_name = _css_attr_quote(frame_name_attr)
        if dynamic_name:
            if not has_stable_src and _frame_policy_bool("allowDynamicNameWithoutSrc", True):
                _push("name_dynamic", f'iframe[name="{quoted_name}"]', _score("name_dynamic", 0.2))
        else:
            _push("name_stable", f'iframe[name="{quoted_name}"]', _score("name_stable", 0.9))
    if frame_id_attr:
        escaped_id = _css_attr_quote(frame_id_attr)
        if dynamic_id:
            if not has_stable_src and _frame_policy_bool("allowDynamicIdWithoutSrc", True):
                _push("id_dynamic", f'iframe[id="{escaped_id}"]', _score("id_dynamic", 0.18))
        else:
            _push("id_stable", f'iframe[id="{escaped_id}"]', _score("id_stable", 0.88))

    if not candidates and frame_index >= 0:
        _push("nth_fallback", f"iframe:nth-of-type({frame_index + 1})", _score("nth_fallback", 0.6))

    if candidates:
        candidates.sort(key=lambda item: (_priority(str(item.get("kind") or "")), -float(item.get("score", 0.0))))
        best_index = 0
        for idx, candidate in enumerate(candidates):
            candidate["primary"] = idx == best_index
            candidate.pop("kind", None)
    return candidates


def _build_frame_path_from_cdp(
    cdp: Any,
    selected_frame_id: str,
    diagnostics: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str]:
    frame_tree_resp = _cdp_send(cdp, "Page.getFrameTree", None, diagnostics)
    frame_tree = frame_tree_resp.get("frameTree") if isinstance(frame_tree_resp, dict) else None
    if not isinstance(frame_tree, dict):
        return [], [], "top"

    frame_index: dict[str, dict[str, Any]] = {}
    _flatten_frame_tree(frame_tree, parent_id=None, child_index=0, index=frame_index)
    if selected_frame_id not in frame_index:
        return [], [], "top"

    chain_from_leaf: list[dict[str, Any]] = []
    current_id: str | None = selected_frame_id
    guard = 0
    while current_id and current_id in frame_index and guard < 128:
        guard += 1
        current = frame_index[current_id]
        parent_id = current.get("parentId")
        if not isinstance(parent_id, str) or not parent_id:
            break
        parent = frame_index.get(parent_id) or {}

        owner_node_id = None
        try:
            owner = _cdp_send(cdp, "DOM.getFrameOwner", {"frameId": current_id}, diagnostics)
            owner_node_id = owner.get("nodeId")
            if not isinstance(owner_node_id, int):
                owner_backend = owner.get("backendNodeId")
                if isinstance(owner_backend, int):
                    pushed = _cdp_send(
                        cdp,
                        "DOM.pushNodesByBackendIdsToFrontend",
                        {"backendNodeIds": [owner_backend]},
                        diagnostics,
                    )
                    node_ids = pushed.get("nodeIds")
                    if isinstance(node_ids, list) and node_ids and isinstance(node_ids[0], int):
                        owner_node_id = node_ids[0]
        except Exception as exc:
            lookup_errors = diagnostics.get("frameOwnerLookupErrors")
            if not isinstance(lookup_errors, list):
                lookup_errors = []
                diagnostics["frameOwnerLookupErrors"] = lookup_errors
            if len(lookup_errors) < 6:
                lookup_errors.append({"frameId": current_id, "reason": str(exc)})
        attrs: dict[str, str] = {}
        if isinstance(owner_node_id, int):
            try:
                owner_desc = _cdp_send(cdp, "DOM.describeNode", {"nodeId": owner_node_id, "depth": 0}, diagnostics)
                owner_node = owner_desc.get("node") if isinstance(owner_desc, dict) else None
                if isinstance(owner_node, dict):
                    attrs = _attributes_to_map(owner_node.get("attributes"))
            except Exception as exc:
                lookup_errors = diagnostics.get("frameOwnerLookupErrors")
                if not isinstance(lookup_errors, list):
                    lookup_errors = []
                    diagnostics["frameOwnerLookupErrors"] = lookup_errors
                if len(lookup_errors) < 6:
                    lookup_errors.append({"frameId": current_id, "reason": str(exc)})

        frame_id_attr = attrs.get("id", "").strip() or None
        frame_name_attr = attrs.get("name", "").strip() or str(current.get("name") or "").strip() or None
        frame_src_attr = _sanitize_url_like(attrs.get("src"))
        if not frame_src_attr:
            frame_src_attr = _sanitize_url_like(str(current.get("url") or ""))
        frame_child_index = int(current.get("childIndex", -1)) if isinstance(current.get("childIndex"), int) else -1
        child_origin = _url_origin(str(current.get("url") or ""))
        parent_origin = _url_origin(str(parent.get("url") or ""))
        cross_origin = bool(child_origin and parent_origin and child_origin != parent_origin)

        selector_candidates = _selector_candidates_for_frame_owner(
            frame_id_attr=frame_id_attr,
            frame_name_attr=frame_name_attr,
            frame_src_attr=frame_src_attr,
            frame_index=frame_child_index,
        )
        stable_id = None if _is_dynamic_identifier(frame_id_attr, attribute_name="id") else frame_id_attr
        stable_name = None if _is_dynamic_identifier(frame_name_attr, attribute_name="name") else frame_name_attr
        stable_src = _stable_src_fragment(frame_src_attr)
        chain_from_leaf.append(
            {
                "frameId": current_id,
                "index": frame_child_index,
                "hint": "",
                "name": stable_name,
                "id": stable_id,
                "src": stable_src or frame_src_attr,
                "selector": None,
                "crossOrigin": cross_origin,
                "selectorCandidates": selector_candidates,
            }
        )
        current_id = parent_id

    chain = list(reversed(chain_from_leaf))
    frame_path: list[dict[str, Any]] = []
    locator_chain: list[dict[str, Any]] = []
    labels: list[str] = ["top"]
    primary_selectors: list[str] = []
    for depth, segment in enumerate(chain):
        segment_src = _sanitize_url_like(str(segment.get("src") or ""))
        parsed_src = urlparse(segment_src) if segment_src else None
        host = parsed_src.netloc.lower() if parsed_src and parsed_src.netloc else ""
        path = parsed_src.path if parsed_src and parsed_src.path else ""
        hint_prefix = "cross-origin" if bool(segment.get("crossOrigin", False)) else "same-origin"
        hint = f"{hint_prefix}#{depth + 1}"
        if host:
            hint += f" {host}"
        if path and path != "/":
            hint += f"{path}"
        selector_candidates = segment.get("selectorCandidates")
        if not isinstance(selector_candidates, list):
            selector_candidates = []
        primary = None
        for candidate in selector_candidates:
            if isinstance(candidate, dict) and candidate.get("primary"):
                value = candidate.get("value")
                if isinstance(value, str) and value.strip():
                    primary = value.strip()
                    break
        if primary is None:
            for candidate in selector_candidates:
                if isinstance(candidate, dict):
                    value = candidate.get("value")
                    if isinstance(value, str) and value.strip():
                        primary = value.strip()
                        break
        frame_path.append(
            {
                "index": int(segment.get("index", -1)),
                "hint": hint,
                "name": segment.get("name"),
                "id": segment.get("id"),
                "src": _sanitize_url_like(str(segment.get("src") or "")) or None,
                "selector": None,
                "crossOrigin": bool(segment.get("crossOrigin", False)),
            }
        )
        locator_chain.append(
            {
                "depth": depth,
                "hint": hint,
                "crossOrigin": bool(segment.get("crossOrigin", False)),
                "index": int(segment.get("index", -1)),
                "primary": primary,
                "selectorCandidates": selector_candidates,
            }
        )
        if isinstance(primary, str) and primary.strip():
            primary_selectors.append(primary.strip())
        labels.append(hint)
    diagnostics["framePrimarySelectors"] = primary_selectors
    return frame_path, locator_chain, " > ".join(labels)


def _extract_payload_from_backend_node(
    cdp: Any,
    backend_node_id: int,
    diagnostics: dict[str, Any],
) -> dict[str, Any]:
    try:
        pushed = _cdp_send(
            cdp,
            "DOM.pushNodesByBackendIdsToFrontend",
            {"backendNodeIds": [backend_node_id]},
            diagnostics,
        )
    except Exception as exc:
        # Some Chromium targets require DOM.getDocument before pushNodesByBackendIdsToFrontend.
        if "Document needs to be requested first" not in str(exc):
            raise PickerRuntimeError(
                code=PICKER_EXECUTION_FAILED,
                message=f"CDP failed to push backend node: {exc}",
                details={"backendNodeId": backend_node_id, "diagnostics": diagnostics},
            ) from exc
        _cdp_send(cdp, "DOM.getDocument", {"depth": 0, "pierce": True}, diagnostics)
        try:
            pushed = _cdp_send(
                cdp,
                "DOM.pushNodesByBackendIdsToFrontend",
                {"backendNodeIds": [backend_node_id]},
                diagnostics,
            )
        except Exception as retry_exc:
            raise PickerRuntimeError(
                code=PICKER_EXECUTION_FAILED,
                message=f"CDP failed to push backend node after DOM.getDocument: {retry_exc}",
                details={"backendNodeId": backend_node_id, "diagnostics": diagnostics},
            ) from retry_exc
    node_ids = pushed.get("nodeIds")
    if not isinstance(node_ids, list) or not node_ids:
        raise PickerRuntimeError(
            code=PICKER_EXECUTION_FAILED,
            message="CDP could not resolve backend node id to a frontend node.",
            details={"backendNodeId": backend_node_id, "diagnostics": diagnostics},
        )
    node_id = node_ids[0]
    if not isinstance(node_id, int):
        raise PickerRuntimeError(
            code=PICKER_EXECUTION_FAILED,
            message="CDP returned invalid node id.",
            details={"backendNodeId": backend_node_id, "nodeId": node_id, "diagnostics": diagnostics},
        )
    diagnostics["resolvedNodeId"] = node_id
    selected_frame_id = None
    diagnostics["selectedFrameId"] = ""
    diagnostics["frameResolveMethod"] = "unresolved"

    try:
        resolved = _cdp_send(cdp, "DOM.resolveNode", {"nodeId": node_id}, diagnostics)
    except Exception as exc:
        raise PickerRuntimeError(
            code=PICKER_EXECUTION_FAILED,
            message=f"CDP failed to resolve node: {exc}",
            details={"nodeId": node_id, "diagnostics": diagnostics},
        ) from exc
    remote_object = resolved.get("object")
    object_id = remote_object.get("objectId") if isinstance(remote_object, dict) else None
    if not isinstance(object_id, str) or not object_id.strip():
        raise PickerRuntimeError(
            code=PICKER_EXECUTION_FAILED,
            message="CDP failed to resolve node object id.",
            details={"nodeId": node_id, "diagnostics": diagnostics},
        )
    requested_node_id = node_id
    try:
        requested = _cdp_send(cdp, "DOM.requestNode", {"objectId": object_id}, diagnostics)
        candidate_node_id = requested.get("nodeId")
        if isinstance(candidate_node_id, int):
            requested_node_id = candidate_node_id
    except Exception:
        pass
    diagnostics["requestedNodeId"] = requested_node_id
    selected_frame_id = _find_selected_frame_id(cdp, requested_node_id, diagnostics)
    if isinstance(selected_frame_id, str) and selected_frame_id:
        diagnostics["selectedFrameId"] = selected_frame_id
        diagnostics["frameResolveMethod"] = "ancestor-chain"

    try:
        try:
            evaluated = _cdp_send(
                cdp,
                "Runtime.callFunctionOn",
                {
                    "objectId": object_id,
                    "functionDeclaration": PICKER_CDP_EXTRACT_FUNCTION,
                    "returnByValue": True,
                    "awaitPromise": False,
                },
                diagnostics,
            )
        except Exception as exc:
            raise PickerRuntimeError(
                code=PICKER_EXECUTION_FAILED,
                message=f"CDP extractor invocation failed: {exc}",
                details={"nodeId": node_id, "diagnostics": diagnostics},
            ) from exc
    finally:
        try:
            cdp.send("Runtime.releaseObject", {"objectId": object_id})
        except Exception:
            pass

    exception_details = evaluated.get("exceptionDetails")
    if isinstance(exception_details, dict):
        raise PickerRuntimeError(
            code=PICKER_EXECUTION_FAILED,
            message="CDP extractor function threw an exception.",
            details={"nodeId": node_id, "exceptionDetails": exception_details, "diagnostics": diagnostics},
        )

    result = evaluated.get("result")
    value = result.get("value") if isinstance(result, dict) else None
    if not isinstance(value, dict):
        raise PickerRuntimeError(
            code=PICKER_EXECUTION_FAILED,
            message="CDP extractor returned invalid payload.",
            details={"nodeId": node_id, "result": result, "diagnostics": diagnostics},
        )

    error = value.get("error")
    if isinstance(error, str) and error.strip():
        raise PickerRuntimeError(
            code=PICKER_EXECUTION_FAILED,
            message=f"CDP extractor reported error: {error.strip()}",
            details={"nodeId": node_id, "payload": value, "diagnostics": diagnostics},
        )

    value.setdefault("pickerAdapter", "cdp")
    value.setdefault("pickerScriptVersion", PICKER_CDP_SCRIPT_VERSION)
    raw_page_url = value.get("pageUrl")
    if isinstance(raw_page_url, str):
        value["pageUrl"] = _sanitize_url_like(raw_page_url)
    if (not isinstance(selected_frame_id, str) or not selected_frame_id) and isinstance(value.get("pageUrl"), str):
        resolved_from_url = _find_frame_id_by_page_url(cdp, value.get("pageUrl", ""), diagnostics)
        if isinstance(resolved_from_url, str) and resolved_from_url:
            selected_frame_id = resolved_from_url
            diagnostics["selectedFrameId"] = selected_frame_id
            diagnostics["frameResolveMethod"] = "page-url-fallback"
    if isinstance(selected_frame_id, str) and selected_frame_id:
        cdp_frame_path, cdp_locator_chain, cdp_frame_path_string = _build_frame_path_from_cdp(
            cdp,
            selected_frame_id,
            diagnostics,
        )
        if (
            len(cdp_frame_path) == 0
            and isinstance(value.get("pageUrl"), str)
            and value.get("pageUrl", "").strip()
        ):
            resolved_from_url = _find_frame_id_by_page_url(cdp, value.get("pageUrl", ""), diagnostics)
            if (
                isinstance(resolved_from_url, str)
                and resolved_from_url
                and resolved_from_url != selected_frame_id
            ):
                selected_frame_id = resolved_from_url
                diagnostics["selectedFrameId"] = selected_frame_id
                diagnostics["frameResolveMethod"] = "page-url-fallback"
                cdp_frame_path, cdp_locator_chain, cdp_frame_path_string = _build_frame_path_from_cdp(
                    cdp,
                    selected_frame_id,
                    diagnostics,
                )
        value["framePath"] = cdp_frame_path
        value["frameLocatorChain"] = cdp_locator_chain
        value["framePathString"] = cdp_frame_path_string
        diagnostics["framePathDepth"] = len(cdp_frame_path)
    else:
        diagnostics["framePathDepth"] = 0
    if isinstance(value.get("framePath"), list):
        for segment in value["framePath"]:
            if isinstance(segment, dict):
                src = segment.get("src")
                if isinstance(src, str):
                    segment["src"] = _sanitize_url_like(src)
    return value


def _pick_with_cdp(
    *,
    page: Any,
    timeout_ms: int,
    should_cancel: Callable[[], bool] | None,
    diagnostics: dict[str, Any],
) -> dict[str, Any]:
    cdp = page.context.new_cdp_session(page)
    state: dict[str, Any] = {"backendNodeId": None, "cancelled": False}
    state_lock = Lock()

    def _on_inspect_node(payload: Any) -> None:
        backend_node_id = payload.get("backendNodeId") if isinstance(payload, dict) else None
        if not isinstance(backend_node_id, int):
            return
        with state_lock:
            events = diagnostics.get("events")
            if isinstance(events, dict):
                events["inspectNodeRequested"] = int(events.get("inspectNodeRequested", 0)) + 1
            if state["backendNodeId"] is None and not state["cancelled"]:
                state["backendNodeId"] = backend_node_id
                diagnostics["pickedBackendNodeId"] = backend_node_id

    def _on_inspect_cancelled(_: Any = None) -> None:
        with state_lock:
            events = diagnostics.get("events")
            if isinstance(events, dict):
                events["inspectModeCanceled"] = int(events.get("inspectModeCanceled", 0)) + 1
            if state["backendNodeId"] is None:
                state["cancelled"] = True

    cdp.on("Overlay.inspectNodeRequested", _on_inspect_node)
    cdp.on("Overlay.inspectModeCanceled", _on_inspect_cancelled)

    _cdp_send(cdp, "DOM.enable", None, diagnostics)
    _cdp_send(cdp, "DOM.getDocument", {"depth": 0, "pierce": True}, diagnostics)
    _cdp_send(cdp, "Runtime.enable", None, diagnostics)
    _cdp_send(cdp, "Overlay.enable", None, diagnostics)
    _cdp_send(
        cdp,
        "Overlay.setInspectMode",
        {
            "mode": "searchForNode",
            "highlightConfig": {
                "showInfo": True,
                "showStyles": True,
                "showRulers": False,
                "contentColor": {"r": 66, "g": 133, "b": 244, "a": 0.18},
                "paddingColor": {"r": 76, "g": 175, "b": 80, "a": 0.2},
                "borderColor": {"r": 255, "g": 167, "b": 38, "a": 0.8},
                "marginColor": {"r": 255, "g": 193, "b": 7, "a": 0.24},
            },
        },
        diagnostics,
    )

    start = time.monotonic()
    try:
        while True:
            diagnostics["loopIterations"] = int(diagnostics.get("loopIterations", 0)) + 1
            if should_cancel and should_cancel():
                raise PickerRuntimeError(
                    code=PICKER_CANCELED,
                    message="Picker session cancelled.",
                    details={
                        "elapsedMs": int((time.monotonic() - start) * 1000),
                        "diagnostics": diagnostics,
                    },
                )
            if page.is_closed():
                raise PickerRuntimeError(
                    code=PICKER_CANCELED,
                    message="Picker page was closed before selection.",
                    details={"diagnostics": diagnostics},
                )

            with state_lock:
                backend_node_id = state.get("backendNodeId")
                cancelled = bool(state.get("cancelled", False))

            if isinstance(backend_node_id, int):
                return _extract_payload_from_backend_node(cdp, backend_node_id, diagnostics)
            if cancelled:
                raise PickerRuntimeError(
                    code=PICKER_CANCELED,
                    message="Picker cancelled by user.",
                    details={"diagnostics": diagnostics},
                )

            elapsed_ms = int((time.monotonic() - start) * 1000)
            if elapsed_ms >= timeout_ms:
                raise PickerRuntimeError(
                    code=PICKER_TIMEOUT,
                    message="Picker timed out waiting for element selection.",
                    details={"timeoutMs": timeout_ms, "diagnostics": diagnostics},
                )

            try:
                page.wait_for_timeout(120)
            except Exception as exc:
                if page.is_closed():
                    raise PickerRuntimeError(
                        code=PICKER_CANCELED,
                        message="Picker page was closed before selection.",
                        details={"reason": str(exc), "diagnostics": diagnostics},
                    ) from exc
                raise PickerRuntimeError(
                    code=PICKER_EXECUTION_FAILED,
                    message="Picker event loop interrupted unexpectedly.",
                    details={"reason": str(exc), "diagnostics": diagnostics},
                ) from exc
    finally:
        try:
            cdp.send("Overlay.setInspectMode", {"mode": "none"})
        except Exception:
            pass
        try:
            cdp.detach()
        except Exception:
            pass


def pick_element(
    *,
    url: str,
    timeout_ms: int = 180_000,
    headless: bool = False,
    should_cancel: Callable[[], bool] | None = None,
) -> PickerResult:
    if not browser_runtime_available():
        raise PickerRuntimeError(
            code=PICKER_EXECUTION_FAILED,
            message="Playwright runtime is not installed.",
            details={"hint": "Install playwright and run `playwright install chromium`."},
        )

    from playwright.sync_api import sync_playwright

    timeout_ms = max(int(timeout_ms), 5_000)
    diagnostics: dict[str, Any] = {
        "adapter": "cdp",
        "scriptVersion": PICKER_CDP_SCRIPT_VERSION,
        "loopIterations": 0,
        "events": {"inspectNodeRequested": 0, "inspectModeCanceled": 0},
        "pickedBackendNodeId": None,
        "resolvedNodeId": None,
        "requestedNodeId": None,
        "selectedFrameId": "",
        "frameResolveMethod": "unresolved",
        "framePathDepth": 0,
        "frameOwnerLookupErrors": [],
        "cdpErrors": [],
    }

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=headless)
        try:
            context = browser.new_context(ignore_https_errors=True)
            page = context.new_page()
            try:
                page.bring_to_front()
            except Exception:
                pass

            try:
                page.goto(url, wait_until="domcontentloaded", timeout=min(timeout_ms, 60_000))
            except Exception as exc:  # pragma: no cover - runtime dependent
                raise PickerRuntimeError(
                    code=PICKER_EXECUTION_FAILED,
                    message="Failed to open picker page.",
                    details={"url": url, "reason": str(exc), "diagnostics": diagnostics},
                ) from exc

            payload = _pick_with_cdp(
                page=page,
                timeout_ms=timeout_ms,
                should_cancel=should_cancel,
                diagnostics=diagnostics,
            )

            try:
                return build_picker_result(payload=payload, source_frame=None, page_url=page.url)
            except PickerPayloadError as exc:
                raise PickerRuntimeError(
                    code=PICKER_EXECUTION_FAILED,
                    message=str(exc),
                    details={**exc.details, "url": url, "diagnostics": diagnostics},
                ) from exc
        finally:
            browser.close()
