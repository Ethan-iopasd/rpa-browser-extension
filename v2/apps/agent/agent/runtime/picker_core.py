from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any
from urllib.parse import urlparse

from agent.models.contracts import (
    PickerFrameLocatorSegment,
    PickerFrameSegment,
    PickerResult,
    PickerSelectorCandidate,
)

_DYNAMIC_FRAME_TOKEN_PATTERNS = [
    re.compile(r"\d{6,}", re.IGNORECASE),
    re.compile(r"[a-z][-_]?\d{5,}", re.IGNORECASE),
    re.compile(r"^\d+(?:\.\d+)?$", re.IGNORECASE),
    re.compile(r"^[a-f0-9]{16,}$", re.IGNORECASE),
    re.compile(r"(?:^|[-_])iframe[-_]?[a-z0-9_-]*\d+(?:\.\d+)?$", re.IGNORECASE),
    re.compile(r"^x-[a-z0-9_-]*iframe[a-z0-9_-]*\d+(?:\.\d+)?$", re.IGNORECASE),
    re.compile(r"^frame[a-z]{1,8}\d+$", re.IGNORECASE),
    re.compile(
        r"^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$",
        re.IGNORECASE,
    ),
]


@dataclass
class PickerPayloadError(Exception):
    message: str
    details: dict[str, Any]

    def __str__(self) -> str:
        return self.message


def _origin(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def infer_selector_type(value: str) -> str:
    lowered = value.strip().lower()
    if lowered.startswith("xpath=") or lowered.startswith("//") or lowered.startswith(".//"):
        return "xpath"
    if lowered.startswith("text="):
        return "text"
    if lowered.startswith("role="):
        return "playwright"
    return "css"


def _is_likely_dynamic_token(value: str | None) -> bool:
    if not isinstance(value, str):
        return False
    token = value.strip()
    if not token:
        return False
    return any(pattern.search(token) for pattern in _DYNAMIC_FRAME_TOKEN_PATTERNS)


def _to_candidate(raw: dict[str, Any], *, default_score: float = 0.5) -> PickerSelectorCandidate | None:
    value = raw.get("value")
    if not isinstance(value, str) or not value.strip():
        return None
    candidate_type = raw.get("type")
    if not isinstance(candidate_type, str) or not candidate_type.strip():
        candidate_type = infer_selector_type(value)
    normalized_type = candidate_type.strip().lower()
    if normalized_type not in {"css", "xpath", "text", "role", "playwright"}:
        normalized_type = infer_selector_type(value)
    score = raw.get("score")
    if not isinstance(score, (float, int)):
        score = default_score
    bounded = max(0.0, min(1.0, float(score)))
    return PickerSelectorCandidate(
        type=normalized_type,  # type: ignore[arg-type]
        value=value.strip(),
        score=bounded,
        primary=bool(raw.get("primary", False)),
    )


def normalize_candidates(raw_candidates: Any, fallback_selector: str) -> list[PickerSelectorCandidate]:
    candidates: list[PickerSelectorCandidate] = []
    if isinstance(raw_candidates, list):
        for item in raw_candidates:
            if isinstance(item, str):
                candidate = PickerSelectorCandidate(
                    type=infer_selector_type(item),  # type: ignore[arg-type]
                    value=item.strip(),
                    score=0.5,
                    primary=False,
                )
                if candidate.value:
                    candidates.append(candidate)
                continue
            if isinstance(item, dict):
                candidate = _to_candidate(item)
                if candidate is not None:
                    candidates.append(candidate)

    if not candidates and fallback_selector.strip():
        candidates.append(
            PickerSelectorCandidate(
                type=infer_selector_type(fallback_selector),  # type: ignore[arg-type]
                value=fallback_selector.strip(),
                score=0.5,
                primary=True,
            )
        )

    unique: list[PickerSelectorCandidate] = []
    seen: set[str] = set()
    for item in candidates:
        key = f"{item.type}:{item.value}"
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)

    if not unique:
        return []

    primary_index = next((idx for idx, item in enumerate(unique) if item.primary), 0)
    normalized: list[PickerSelectorCandidate] = []
    for index, item in enumerate(unique):
        normalized.append(item.model_copy(update={"primary": index == primary_index}))
    return normalized


def _frame_index(frame: Any) -> int:
    parent = getattr(frame, "parent_frame", None)
    if parent is None:
        return -1
    siblings = list(getattr(parent, "child_frames", []) or [])
    for index, sibling in enumerate(siblings):
        if sibling == frame:
            return index
    return -1


def _frame_element_metadata(frame: Any) -> dict[str, Any]:
    try:
        element = frame.frame_element()
    except Exception:
        return {}
    metadata: dict[str, Any] = {}
    for key in ("id", "name", "src"):
        try:
            value = element.get_attribute(key)
        except Exception:
            value = None
        if isinstance(value, str) and value.strip():
            metadata[key] = value.strip()
    try:
        tag_name = element.evaluate("el => (el.tagName || '').toLowerCase()")
    except Exception:
        tag_name = ""
    if isinstance(tag_name, str) and tag_name.strip():
        metadata["tag"] = tag_name.strip()
    return metadata


def _frame_selector_candidates(meta: dict[str, Any]) -> list[PickerSelectorCandidate]:
    candidates: list[PickerSelectorCandidate] = []
    frame_id = meta.get("id")
    frame_name = meta.get("name")
    frame_src = meta.get("src")
    if isinstance(frame_id, str) and frame_id:
        candidates.append(
            PickerSelectorCandidate(
                type="css",
                value=f"iframe#{frame_id}",
                score=0.22 if _is_likely_dynamic_token(frame_id) else 0.92,
                primary=False,
            )
        )
    if isinstance(frame_name, str) and frame_name:
        candidates.append(
            PickerSelectorCandidate(
                type="css",
                value=f'iframe[name="{frame_name}"]',
                score=0.28 if _is_likely_dynamic_token(frame_name) else 0.88,
                primary=False,
            )
        )
    if isinstance(frame_src, str) and frame_src:
        try:
            parsed = urlparse(frame_src)
            src_host_path = f"{parsed.netloc}{parsed.path}" if parsed.netloc or parsed.path else frame_src
        except Exception:
            src_host_path = frame_src
        candidates.append(
            PickerSelectorCandidate(
                type="css",
                value=f'iframe[src*="{src_host_path[:80]}"]',
                score=0.82,
                primary=False,
            )
        )
    if candidates:
        candidates = sorted(candidates, key=lambda item: item.score, reverse=True)
        candidates[0] = candidates[0].model_copy(update={"primary": True})
    return candidates


def build_frame_path_from_source_frame(
    frame: Any,
) -> tuple[list[PickerFrameSegment], list[PickerFrameLocatorSegment], str]:
    if frame is None:
        return [], [], "top"

    chain: list[Any] = []
    current = frame
    while current is not None:
        parent = getattr(current, "parent_frame", None)
        if parent is None:
            break
        chain.append(current)
        current = parent
    chain.reverse()

    frame_path: list[PickerFrameSegment] = []
    locator_chain: list[PickerFrameLocatorSegment] = []
    labels: list[str] = ["top"]

    for depth, segment_frame in enumerate(chain):
        index = _frame_index(segment_frame)
        meta = _frame_element_metadata(segment_frame)
        hint_parts: list[str] = []
        if isinstance(meta.get("name"), str) and meta.get("name") and not _is_likely_dynamic_token(meta.get("name")):
            hint_parts.append(str(meta["name"]))
        if isinstance(meta.get("id"), str) and meta.get("id") and not _is_likely_dynamic_token(meta.get("id")):
            hint_parts.append(f"#{meta['id']}")
        if not hint_parts and isinstance(meta.get("src"), str) and meta.get("src"):
            try:
                parsed = urlparse(str(meta["src"]))
                host = parsed.netloc or ""
                path = parsed.path or ""
                compact = f"{host}{path}".strip()
                if compact:
                    hint_parts.append(compact)
            except Exception:
                pass
        if not hint_parts:
            hint_parts.append(f"frame[{index}]")
        hint = " ".join(hint_parts).strip()

        parent = getattr(segment_frame, "parent_frame", None)
        parent_origin = _origin(getattr(parent, "url", "") or "")
        frame_origin = _origin(getattr(segment_frame, "url", "") or "")
        cross_origin = bool(parent_origin and frame_origin and parent_origin != frame_origin)

        frame_segment = PickerFrameSegment(
            index=index,
            hint=hint,
            name=meta.get("name"),
            id=meta.get("id"),
            src=meta.get("src"),
            selector=None,
            crossOrigin=cross_origin,
        )
        frame_path.append(frame_segment)

        selector_candidates = _frame_selector_candidates(meta)
        primary = selector_candidates[0].value if selector_candidates else None
        locator_chain.append(
            PickerFrameLocatorSegment(
                depth=depth,
                hint=hint,
                crossOrigin=cross_origin,
                index=index,
                primary=primary,
                selectorCandidates=selector_candidates,
            )
        )
        labels.append(hint if hint else f"frame#{depth + 1}")

    return frame_path, locator_chain, " > ".join(labels)


def _normalize_frame_path(raw: Any) -> list[PickerFrameSegment]:
    if not isinstance(raw, list):
        return []
    normalized: list[PickerFrameSegment] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        index = item.get("index")
        if not isinstance(index, int):
            index = -1
        hint = item.get("hint")
        if not isinstance(hint, str):
            hint = ""
        name = item.get("name")
        name = name.strip() if isinstance(name, str) and name.strip() else None
        frame_id = item.get("id")
        frame_id = frame_id.strip() if isinstance(frame_id, str) and frame_id.strip() else None
        id_stable = item.get("idStable")
        id_stable = id_stable if isinstance(id_stable, bool) else None
        if id_stable is None and frame_id:
            id_stable = not _is_likely_dynamic_token(frame_id)
        src = item.get("src")
        src = src.strip() if isinstance(src, str) and src.strip() else None
        src_host_path = item.get("srcHostPath")
        src_host_path = src_host_path.strip() if isinstance(src_host_path, str) and src_host_path.strip() else None
        src_stable_fragment = item.get("srcStableFragment")
        src_stable_fragment = (
            src_stable_fragment.strip()
            if isinstance(src_stable_fragment, str) and src_stable_fragment.strip()
            else None
        )
        frame_border = item.get("frameBorder")
        frame_border = frame_border.strip() if isinstance(frame_border, str) and frame_border.strip() else None
        tag = item.get("tag")
        tag = tag.strip() if isinstance(tag, str) and tag.strip() else None
        selector = item.get("selector")
        selector = selector.strip() if isinstance(selector, str) and selector.strip() else None
        attr_hints: dict[str, str] = {}
        raw_attr_hints = item.get("attrHints")
        if isinstance(raw_attr_hints, dict):
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
        normalized.append(
            PickerFrameSegment(
                index=index,
                hint=hint.strip(),
                tag=tag,
                name=name,
                id=frame_id,
                idStable=id_stable,
                src=src,
                srcHostPath=src_host_path,
                srcStableFragment=src_stable_fragment,
                frameBorder=frame_border,
                selector=selector,
                crossOrigin=bool(item.get("crossOrigin", False)),
                attrHints=attr_hints,
            )
        )
    return normalized


def _normalize_locator_chain(raw: Any) -> list[PickerFrameLocatorSegment]:
    if not isinstance(raw, list):
        return []
    normalized: list[PickerFrameLocatorSegment] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        depth = item.get("depth")
        if not isinstance(depth, int):
            depth = len(normalized)
        hint = item.get("hint")
        if not isinstance(hint, str):
            hint = ""
        index = item.get("index")
        if not isinstance(index, int):
            index = -1
        primary = item.get("primary")
        if not isinstance(primary, str) or not primary.strip():
            primary = None
        selector_candidates = normalize_candidates(item.get("selectorCandidates"), "")
        normalized.append(
            PickerFrameLocatorSegment(
                depth=depth,
                hint=hint.strip(),
                crossOrigin=bool(item.get("crossOrigin", False)),
                index=index,
                primary=primary,
                selectorCandidates=selector_candidates,
            )
        )
    return normalized


def _build_locator_chain_from_frame_path(frame_path: list[PickerFrameSegment]) -> list[PickerFrameLocatorSegment]:
    result: list[PickerFrameLocatorSegment] = []
    for depth, segment in enumerate(frame_path):
        selector_candidates: list[PickerSelectorCandidate] = []
        if segment.id and segment.idStable is not False:
            selector_candidates.append(
                PickerSelectorCandidate(type="css", value=f"iframe#{segment.id}", score=0.92, primary=True)
            )
        if segment.name:
            selector_candidates.append(
                PickerSelectorCandidate(
                    type="css",
                    value=f'iframe[name="{segment.name}"]',
                    score=0.28 if _is_likely_dynamic_token(segment.name) else 0.88,
                    primary=False,
                )
            )
        src_selector = segment.srcStableFragment or segment.srcHostPath or segment.src
        if src_selector:
            selector_candidates.append(
                PickerSelectorCandidate(
                    type="css",
                    value=f'iframe[src*="{src_selector[:80]}"]',
                    score=0.82,
                    primary=False,
                )
            )
        if segment.index >= 0:
            selector_candidates.append(
                PickerSelectorCandidate(
                    type="css",
                    value=f"iframe:nth-of-type({segment.index + 1})",
                    score=0.64,
                    primary=False,
                )
            )
        if selector_candidates:
            selector_candidates[0] = selector_candidates[0].model_copy(update={"primary": True})
        primary = selector_candidates[0].value if selector_candidates else None
        result.append(
            PickerFrameLocatorSegment(
                depth=depth,
                hint=segment.hint,
                crossOrigin=segment.crossOrigin,
                index=segment.index,
                primary=primary,
                selectorCandidates=selector_candidates,
            )
        )
    return result


def _frame_path_string(frame_path: list[PickerFrameSegment]) -> str:
    if not frame_path:
        return "top"
    labels: list[str] = ["top"]
    for idx, segment in enumerate(frame_path):
        labels.append(segment.hint or f"frame#{idx + 1}")
    return " > ".join(labels)


def build_picker_result(payload: dict[str, Any], source_frame: Any, page_url: str) -> PickerResult:
    raw_selector = payload.get("selector")
    fallback_selector = raw_selector.strip() if isinstance(raw_selector, str) else ""

    selector_candidates = normalize_candidates(payload.get("selectorCandidates"), fallback_selector)
    if not selector_candidates:
        raise PickerPayloadError(
            message="Picker payload did not include any selector candidates.",
            details={"payload": payload},
        )
    primary_selector = next((item for item in selector_candidates if item.primary), selector_candidates[0])

    playwright_candidates = normalize_candidates(payload.get("playwrightCandidates"), "")
    if not playwright_candidates:
        playwright_candidates = [item for item in selector_candidates if item.type in {"playwright", "role"}]
    playwright_primary: PickerSelectorCandidate | None = None
    if playwright_candidates:
        playwright_primary = next((item for item in playwright_candidates if item.primary), playwright_candidates[0])

    selector_type = primary_selector.type

    frame_path = _normalize_frame_path(payload.get("framePath"))
    frame_locator_chain = _normalize_locator_chain(payload.get("frameLocatorChain"))
    if not frame_path and source_frame is not None:
        frame_path, frame_locator_chain, frame_path_string = build_frame_path_from_source_frame(source_frame)
    else:
        if frame_path and not frame_locator_chain:
            frame_locator_chain = _build_locator_chain_from_frame_path(frame_path)
        frame_path_string = payload.get("framePathString") if isinstance(payload.get("framePathString"), str) else ""
        frame_path_string = frame_path_string.strip() or _frame_path_string(frame_path)

    element_meta = payload.get("elementMeta") if isinstance(payload.get("elementMeta"), dict) else {}
    effective_page_url = payload.get("pageUrl") if isinstance(payload.get("pageUrl"), str) else page_url

    return PickerResult(
        selector=primary_selector.value,
        selectorType=selector_type,  # type: ignore[arg-type]
        selectorCandidates=selector_candidates,
        playwrightPrimary=playwright_primary,
        playwrightCandidates=playwright_candidates,
        frameLocatorChain=frame_locator_chain,
        pageUrl=effective_page_url,
        framePath=frame_path,
        framePathString=frame_path_string,
        elementMeta=element_meta,
    )
