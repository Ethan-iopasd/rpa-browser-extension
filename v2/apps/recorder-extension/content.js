const RECORDER_SOURCE = "rpa-flow-recorder";
const DESIGNER_SOURCE = "rpa-flow-designer";
const INPUT_THROTTLE_MS = 280;
const DEDUPE_WINDOW_MS = 220;
const PICKER_VERSION = "2.0.0";
const PICKER_UI_ATTR = "data-rpa-picker-ui";
const PICKER_ROOT_ID = "__rpa_picker_root__";
const PICKER_RULE_FILE_PATHS = Object.freeze({
  selector: "picker-rules/selector-rules.json",
  frame: "picker-rules/frame-rules.json"
});

const DEFAULT_DYNAMIC_TOKEN_PATTERNS = Object.freeze([
  /\d{6,}/,
  /[a-z][-_]?\d{5,}/i,
  /^\d+(\.\d+)?$/,
  /^[a-f0-9]{16,}$/i,
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
]);
const DEFAULT_DYNAMIC_CLASS_PATTERNS = Object.freeze([
  /\d{3,}/i,
  /__[a-z0-9]{5,}/i,
  /^(css|ng|ember|react|vue)-[a-z0-9]{5,}$/i
]);
const DEFAULT_FRAME_VOLATILE_ID_PATTERNS = Object.freeze([
  /(?:^|[-_])iframe[-_]?[a-z0-9_-]*\d+(?:\.\d+)?$/i,
  /^x-[a-z0-9_-]*iframe[a-z0-9_-]*\d+(?:\.\d+)?$/i,
  /^frame[a-z]{1,8}\d+$/i
]);
const DEFAULT_NOISY_SELECTOR_PATTERNS = Object.freeze([
  /nth-of-type\(/i,
  /\b(css|ng|ember|react|vue)-[a-z0-9]{5,}\b/i
]);
const DEFAULT_DYNAMIC_TEXT_PATTERNS = Object.freeze([
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/,
  /\b20\d{2}[./-]\d{1,2}[./-]\d{1,2}\b/,
  /\b\d{4}年\d{1,2}月\d{1,2}日\b/,
  /\b(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
]);
const DEFAULT_SELECTOR_PICKER_RULES = Object.freeze({
  preferredAttributes: [
    "data-testid",
    "data-test-id",
    "data-test",
    "data-qa",
    "data-cy",
    "sign",
    "name",
    "aria-label",
    "title",
    "placeholder"
  ],
  textFriendlyTags: ["button", "a", "label", "span", "div", "p", "td", "th"],
  dynamicTokenPatterns: DEFAULT_DYNAMIC_TOKEN_PATTERNS,
  dynamicTextPatterns: DEFAULT_DYNAMIC_TEXT_PATTERNS,
  dynamicClassPatterns: DEFAULT_DYNAMIC_CLASS_PATTERNS,
  noisySelectorPatterns: DEFAULT_NOISY_SELECTOR_PATTERNS,
  maxTextCandidateLength: 45,
  maxStableTextLength: 80,
  maxTextTokenCount: 10,
  maxAccessibleNameLength: 42,
  maxCandidates: 8
});
const DEFAULT_FRAME_PICKER_RULES = Object.freeze({
  preferredAttributes: [
    "id",
    "name",
    "data-testid",
    "data-test",
    "data-qa",
    "data-cy",
    "title",
    "aria-label",
    "src",
    "frameborder"
  ],
  dynamicIdPatterns: [...DEFAULT_DYNAMIC_TOKEN_PATTERNS, ...DEFAULT_FRAME_VOLATILE_ID_PATTERNS],
  dynamicQueryKeys: [
    "mgid",
    "wdaid",
    "_",
    "t",
    "ts",
    "timestamp",
    "nonce",
    "token",
    "rand",
    "random",
    "traceid",
    "session",
    "sid",
    "pkid",
    "cd",
    "cf"
  ],
  stableQueryAllowlist: ["product"],
  maxQueryParams: 2,
  maxParamValueLength: 96,
  maxSrcFragmentLength: 220,
  attributeScoreOverrides: {
    "data-testid": 0.97,
    "data-test": 0.95,
    "data-qa": 0.94,
    "data-cy": 0.94,
    "title": 0.88,
    "aria-label": 0.88
  },
  maxCandidates: 8
});

const PICKER_STATES = {
  IDLE: "idle",
  INSPECTING: "inspecting",
  LOCKED: "locked",
  PICKED: "picked",
  CANCELLED: "cancelled"
};

let isRecording = false;
let clickListener = null;
let inputListener = null;
let selectListener = null;
let lastInputAtBySelector = new Map();
let lastEventSignature = "";
let lastEventAt = 0;

let activePickFrame = null;
let activePickFrameLocked = false;

function syncPickStateToTop(stage, meta) {
  if (window !== window.top) {
    try {
      window.top.postMessage({
        source: RECORDER_SOURCE,
        type: "RPA_PICK_SYNC",
        stage,
        meta
      }, "*");
    } catch {
      // Ignore cross-origin errors if any
    }
  }
}

function lockActiveFrame(frameRef) {
  activePickFrame = frameRef || window;
  activePickFrameLocked = true;
}

function releaseActiveFrameLock() {
  activePickFrameLocked = false;
}

function shouldIgnoreFrameSwitch(frameRef) {
  return activePickFrameLocked && activePickFrame && frameRef && frameRef !== activePickFrame;
}

function postMessageSafe(targetWindow, payload) {
  if (!targetWindow || typeof targetWindow.postMessage !== "function") {
    return;
  }
  try {
    targetWindow.postMessage(payload, "*");
  } catch {
    // Ignore postMessage failures for detached/cross-origin frames.
  }
}

function isFrameDomElement(node) {
  if (!(node instanceof Element)) {
    return false;
  }
  const tag = String(node.tagName || "").toLowerCase();
  return tag === "iframe" || tag === "frame";
}

function collectFrameElementsDeep(rootNode) {
  const result = [];
  if (!rootNode) {
    return result;
  }
  const stack = [rootNode];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (current instanceof Element) {
      if (isFrameDomElement(current)) {
        result.push(current);
      }
      if (current.shadowRoot) {
        stack.push(current.shadowRoot);
      }
      const children = Array.from(current.children || []);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push(children[index]);
      }
      continue;
    }
    if (current instanceof Document || current instanceof ShadowRoot || current instanceof DocumentFragment) {
      const children = Array.from(current.children || []);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push(children[index]);
      }
    }
  }
  return result;
}

function listChildFrameEntries(currentWindow) {
  if (!currentWindow) {
    return [];
  }
  let frameNodes = [];
  try {
    frameNodes = collectFrameElementsDeep(currentWindow.document);
  } catch {
    frameNodes = [];
  }
  const entries = [];
  for (let index = 0; index < frameNodes.length; index += 1) {
    const frameElement = frameNodes[index];
    let childWindow = null;
    try {
      childWindow = frameElement.contentWindow;
    } catch {
      childWindow = null;
    }
    if (!childWindow || childWindow === currentWindow) {
      continue;
    }
    entries.push({ frameElement, childWindow, index });
  }
  return entries;
}

function resolveFrameElementIndex(parentWindow, frameElement) {
  if (!parentWindow || !(frameElement instanceof Element)) {
    return -1;
  }
  try {
    const allFrameNodes = collectFrameElementsDeep(parentWindow.document);
    const directIndex = allFrameNodes.indexOf(frameElement);
    if (directIndex >= 0) {
      return directIndex;
    }
  } catch {
    // ignore
  }
  try {
    const targetWindow = frameElement.contentWindow;
    const total = Number(parentWindow.frames?.length || 0);
    for (let index = 0; index < total; index += 1) {
      if (parentWindow.frames[index] === targetWindow) {
        return index;
      }
    }
  } catch {
    // ignore
  }
  const parentElement = frameElement.parentElement;
  if (parentElement) {
    const sameTagSiblings = Array.from(parentElement.children).filter(
      sibling =>
        sibling instanceof Element &&
        String(sibling.tagName || "").toLowerCase() === String(frameElement.tagName || "").toLowerCase()
    );
    const siblingIndex = sameTagSiblings.indexOf(frameElement);
    if (siblingIndex >= 0) {
      return siblingIndex;
    }
  }
  return -1;
}

function dispatchPickModeToChildFrames(enabled, prefixPath = [], nativeSessionId = null) {
  const childEntries = listChildFrameEntries(window);
  if (childEntries.length <= 0) {
    return;
  }
  for (const entry of childEntries) {
    const segment = buildFrameSegmentFromElement(entry.frameElement, entry.index);
    const nextPrefix = cloneFramePath(prefixPath);
    if (segment) {
      nextPrefix.push(segment);
    }
    postMessageSafe(entry.childWindow, {
      source: RECORDER_SOURCE,
      type: "RPA_PICK_CMD_TOGGLE",
      enabled: Boolean(enabled),
      framePathPrefix: nextPrefix,
      nativeSessionId
    });
  }
}

const picker = {
  enabled: false,
  state: PICKER_STATES.IDLE,
  nativeSessionId: null,
  framePathPrefix: [],
  hoverTarget: null,
  lockedTarget: null,
  hoverMeta: null,
  listeners: {
    mousemove: null,
    click: null,
    keydown: null,
    scroll: null,
    resize: null,
    toolbarPointerMove: null,
    toolbarPointerUp: null
  },
  toolbar: {
    collapsed: false,
    position: null,
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    originLeft: 0,
    originTop: 0
  },
  ui: {
    root: null,
    shadow: null,
    overlay: null,
    bubble: null,
    bubbleText: null,
    toolbar: null,
    status: null,
    frame: null,
    confidence: null,
    fallback: null,
    hint: null,
    toolbarHead: null,
    toolbarBody: null,
    minimize: null,
    confirm: null,
    skip: null,
    cancel: null
  }
};

const pickerRuleState = {
  loaded: false,
  loadPromise: null,
  rules: {
    selector: DEFAULT_SELECTOR_PICKER_RULES,
    frame: DEFAULT_FRAME_PICKER_RULES
  }
};

function clampInteger(value, fallback, min, max) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  return Math.min(Math.max(normalized, min), max);
}

function pickFirstDefined(record, keys, fallback) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return fallback;
}

function normalizeStringList(value, options = {}) {
  if (!Array.isArray(value)) {
    return [];
  }
  const lowerCase = options.lowerCase !== false;
  const max = clampInteger(options.max, 48, 1, 256);
  const unique = new Set();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = lowerCase ? item.trim().toLowerCase() : item.trim();
    if (!normalized) {
      continue;
    }
    unique.add(normalized);
    if (unique.size >= max) {
      break;
    }
  }
  return Array.from(unique);
}

function normalizeRegexList(value, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  const compiled = [];
  for (const entry of source) {
    if (entry instanceof RegExp) {
      compiled.push(new RegExp(entry.source, entry.flags));
      continue;
    }
    if (typeof entry === "string" && entry.trim()) {
      try {
        compiled.push(new RegExp(entry.trim()));
      } catch {
        // Ignore invalid regex entries from rule files.
      }
      continue;
    }
    if (entry && typeof entry === "object") {
      const pattern = typeof entry.pattern === "string" ? entry.pattern.trim() : "";
      const flags = typeof entry.flags === "string" ? entry.flags : "";
      if (!pattern) {
        continue;
      }
      try {
        compiled.push(new RegExp(pattern, flags));
      } catch {
        // Ignore invalid regex entries from rule files.
      }
    }
  }
  if (compiled.length > 0) {
    return compiled;
  }
  return fallback.map(item => new RegExp(item.source, item.flags));
}

function normalizeScoreOverrides(value, fallback) {
  const map = {};
  const source = value && typeof value === "object" ? value : fallback;
  for (const [key, score] of Object.entries(source || {})) {
    const normalizedKey = String(key || "").trim().toLowerCase();
    if (!normalizedKey) {
      continue;
    }
    if (typeof score !== "number" || !Number.isFinite(score)) {
      continue;
    }
    map[normalizedKey] = clamp01(score);
  }
  return map;
}

function normalizeSelectorRuleConfig(rawRule) {
  const record = rawRule && typeof rawRule === "object" ? rawRule : {};
  const fallback = DEFAULT_SELECTOR_PICKER_RULES;
  const preferredAttributes =
    normalizeStringList(
      pickFirstDefined(record, ["preferredAttributes", "attributePriority", "preferredAttrs"], fallback.preferredAttributes),
      { lowerCase: true, max: 48 }
    ) || [];
  const textFriendlyTags =
    normalizeStringList(
      pickFirstDefined(record, ["textFriendlyTags", "textTags", "textTargetTags"], fallback.textFriendlyTags),
      { lowerCase: true, max: 32 }
    ) || [];
  return {
    preferredAttributes:
      preferredAttributes.length > 0 ? preferredAttributes : [...fallback.preferredAttributes],
    textFriendlyTags:
      textFriendlyTags.length > 0 ? textFriendlyTags : [...fallback.textFriendlyTags],
    dynamicTokenPatterns: normalizeRegexList(
      pickFirstDefined(record, ["dynamicTokenPatterns", "volatileTokenPatterns"], fallback.dynamicTokenPatterns),
      fallback.dynamicTokenPatterns
    ),
    dynamicTextPatterns: normalizeRegexList(
      pickFirstDefined(record, ["dynamicTextPatterns", "volatileTextPatterns"], fallback.dynamicTextPatterns),
      fallback.dynamicTextPatterns
    ),
    dynamicClassPatterns: normalizeRegexList(
      pickFirstDefined(record, ["dynamicClassPatterns", "volatileClassPatterns"], fallback.dynamicClassPatterns),
      fallback.dynamicClassPatterns
    ),
    noisySelectorPatterns: normalizeRegexList(
      pickFirstDefined(record, ["noisySelectorPatterns", "selectorPenaltyPatterns"], fallback.noisySelectorPatterns),
      fallback.noisySelectorPatterns
    ),
    maxTextCandidateLength: clampInteger(
      pickFirstDefined(record, ["maxTextCandidateLength", "maxTextLength"], fallback.maxTextCandidateLength),
      fallback.maxTextCandidateLength,
      16,
      240
    ),
    maxStableTextLength: clampInteger(
      pickFirstDefined(record, ["maxStableTextLength"], fallback.maxStableTextLength),
      fallback.maxStableTextLength,
      24,
      280
    ),
    maxTextTokenCount: clampInteger(
      pickFirstDefined(record, ["maxTextTokenCount"], fallback.maxTextTokenCount),
      fallback.maxTextTokenCount,
      3,
      24
    ),
    maxAccessibleNameLength: clampInteger(
      pickFirstDefined(record, ["maxAccessibleNameLength"], fallback.maxAccessibleNameLength),
      fallback.maxAccessibleNameLength,
      16,
      120
    ),
    maxCandidates: clampInteger(
      pickFirstDefined(record, ["maxCandidates"], fallback.maxCandidates),
      fallback.maxCandidates,
      3,
      16
    )
  };
}

function normalizeFrameRuleConfig(rawRule) {
  const record = rawRule && typeof rawRule === "object" ? rawRule : {};
  const fallback = DEFAULT_FRAME_PICKER_RULES;
  const preferredAttributes =
    normalizeStringList(
      pickFirstDefined(record, ["preferredAttributes", "attributePriority", "preferredAttrs"], fallback.preferredAttributes),
      { lowerCase: true, max: 32 }
    ) || [];
  return {
    preferredAttributes:
      preferredAttributes.length > 0 ? preferredAttributes : [...fallback.preferredAttributes],
    dynamicIdPatterns: normalizeRegexList(
      pickFirstDefined(record, ["dynamicIdPatterns", "volatileIdPatterns"], fallback.dynamicIdPatterns),
      fallback.dynamicIdPatterns
    ),
    dynamicQueryKeys: normalizeStringList(
      pickFirstDefined(record, ["dynamicQueryKeys"], fallback.dynamicQueryKeys),
      { lowerCase: true, max: 48 }
    ),
    stableQueryAllowlist: normalizeStringList(
      pickFirstDefined(record, ["stableQueryAllowlist", "queryAllowlist"], fallback.stableQueryAllowlist),
      { lowerCase: true, max: 32 }
    ),
    maxQueryParams: clampInteger(
      pickFirstDefined(record, ["maxQueryParams"], fallback.maxQueryParams),
      fallback.maxQueryParams,
      0,
      6
    ),
    maxParamValueLength: clampInteger(
      pickFirstDefined(record, ["maxParamValueLength"], fallback.maxParamValueLength),
      fallback.maxParamValueLength,
      8,
      256
    ),
    maxSrcFragmentLength: clampInteger(
      pickFirstDefined(record, ["maxSrcFragmentLength"], fallback.maxSrcFragmentLength),
      fallback.maxSrcFragmentLength,
      40,
      400
    ),
    attributeScoreOverrides: normalizeScoreOverrides(
      pickFirstDefined(record, ["attributeScoreOverrides", "attrScore"], fallback.attributeScoreOverrides),
      fallback.attributeScoreOverrides
    ),
    maxCandidates: clampInteger(
      pickFirstDefined(record, ["maxCandidates"], fallback.maxCandidates),
      fallback.maxCandidates,
      3,
      16
    )
  };
}

async function loadPickerRuleFile(relativePath) {
  if (!chrome?.runtime || typeof chrome.runtime.getURL !== "function") {
    return null;
  }
  const url = chrome.runtime.getURL(relativePath);
  const response = await fetch(url, { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load rule file: ${relativePath}`);
  }
  return response.json();
}

async function ensurePickerRulesLoaded() {
  if (pickerRuleState.loaded) {
    return pickerRuleState.rules;
  }
  if (pickerRuleState.loadPromise) {
    return pickerRuleState.loadPromise;
  }
  pickerRuleState.loadPromise = (async () => {
    try {
      const [selectorRaw, frameRaw] = await Promise.all([
        loadPickerRuleFile(PICKER_RULE_FILE_PATHS.selector),
        loadPickerRuleFile(PICKER_RULE_FILE_PATHS.frame)
      ]);
      pickerRuleState.rules = {
        selector: normalizeSelectorRuleConfig(selectorRaw),
        frame: normalizeFrameRuleConfig(frameRaw)
      };
      console.debug("[rpa-picker] rule files loaded", {
        selectorAttrs: pickerRuleState.rules.selector.preferredAttributes.length,
        frameAttrs: pickerRuleState.rules.frame.preferredAttributes.length
      });
    } catch (error) {
      pickerRuleState.rules = {
        selector: normalizeSelectorRuleConfig({}),
        frame: normalizeFrameRuleConfig({})
      };
      console.debug("[rpa-picker] use built-in picker rules", error?.message || error);
    } finally {
      pickerRuleState.loaded = true;
      pickerRuleState.loadPromise = null;
    }
    return pickerRuleState.rules;
  })();
  return pickerRuleState.loadPromise;
}

function getPickerRules() {
  return pickerRuleState.rules;
}

function regexTest(pattern, value) {
  if (!(pattern instanceof RegExp)) {
    return false;
  }
  try {
    pattern.lastIndex = 0;
  } catch {
    // Ignore lastIndex reset failures.
  }
  return pattern.test(value);
}

function isValidAttributeName(name) {
  return /^[a-z][a-z0-9:_-]*$/i.test(name);
}

void ensurePickerRulesLoaded();

function cloneFrameSegment(segment) {
  if (!segment || typeof segment !== "object") {
    return null;
  }
  const record = segment;
  const normalizeOptional = value => (typeof value === "string" ? value.trim() : "");
  const index =
    typeof record.index === "number" && Number.isFinite(record.index)
      ? Math.floor(record.index)
      : -1;
  const idStable = typeof record.idStable === "boolean" ? record.idStable : undefined;
  const attrHints = {};
  if (record.attrHints && typeof record.attrHints === "object") {
    for (const [name, value] of Object.entries(record.attrHints)) {
      const normalizedName = String(name || "").trim().toLowerCase();
      if (!isValidAttributeName(normalizedName)) {
        continue;
      }
      if (typeof value !== "string") {
        continue;
      }
      const normalizedValue = value.trim();
      if (!normalizedValue) {
        continue;
      }
      attrHints[normalizedName] = normalizedValue;
    }
  }
  return {
    index,
    hint: normalizeOptional(record.hint),
    tag: normalizeOptional(record.tag),
    name: normalizeOptional(record.name),
    id: normalizeOptional(record.id),
    idStable,
    src: normalizeOptional(record.src),
    srcHostPath: normalizeOptional(record.srcHostPath),
    srcStableFragment: normalizeOptional(record.srcStableFragment),
    frameBorder: normalizeOptional(record.frameBorder),
    selector: normalizeOptional(record.selector),
    crossOrigin: Boolean(record.crossOrigin),
    attrHints
  };
}

function cloneFramePath(path) {
  if (!Array.isArray(path)) {
    return [];
  }
  return path.map(cloneFrameSegment).filter(item => item !== null);
}

function frameSegmentSignature(segment) {
  if (!segment || typeof segment !== "object") {
    return "";
  }
  const idStableMark =
    segment.idStable === true ? "1" : segment.idStable === false ? "0" : "u";
  const attrHintSignature = Object.entries(segment.attrHints || {})
    .map(([name, value]) => `${name}:${value}`)
    .sort()
    .join(",");
  return [
    segment.tag || "",
    segment.id || "",
    idStableMark,
    segment.name || "",
    segment.srcHostPath || "",
    segment.srcStableFragment || "",
    segment.frameBorder || "",
    segment.selector || "",
    segment.index,
    segment.crossOrigin ? "1" : "0",
    attrHintSignature
  ].join("|");
}

function pathStartsWith(path, prefix) {
  if (!Array.isArray(path) || !Array.isArray(prefix)) {
    return false;
  }
  if (prefix.length === 0) {
    return true;
  }
  if (path.length < prefix.length) {
    return false;
  }
  for (let index = 0; index < prefix.length; index += 1) {
    if (frameSegmentSignature(path[index]) !== frameSegmentSignature(prefix[index])) {
      return false;
    }
  }
  return true;
}

function resolveFramePathByWindowRef(targetWindow) {
  if (window !== window.top || !targetWindow || targetWindow === window) {
    return [];
  }
  const visited = new Set();

  function walk(currentWindow, prefixSegments) {
    if (!currentWindow || visited.has(currentWindow)) {
      return null;
    }
    visited.add(currentWindow);

    const childEntries = listChildFrameEntries(currentWindow);
    for (const entry of childEntries) {
      const segment = buildFrameSegmentFromElement(entry.frameElement, entry.index);
      const nextPrefix = segment
        ? [...prefixSegments, segment]
        : [...prefixSegments];

      if (entry.childWindow === targetWindow) {
        return nextPrefix;
      }

      const nested = walk(entry.childWindow, nextPrefix);
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  return walk(window, []) || [];
}

function normalizeSyncMeta(meta, sourceWindow) {
  const baseMeta = meta && typeof meta === "object" ? { ...meta } : {};
  if (window !== window.top || !sourceWindow || sourceWindow === window) {
    return baseMeta;
  }

  const derivedPath = resolveFramePathByWindowRef(sourceWindow);
  if (derivedPath.length === 0) {
    return baseMeta;
  }

  const incomingPath = cloneFramePath(baseMeta.framePath);
  let effectivePath = derivedPath;
  if (incomingPath.length > 0) {
    if (pathStartsWith(incomingPath, derivedPath)) {
      effectivePath = incomingPath;
    } else if (pathStartsWith(derivedPath, incomingPath)) {
      effectivePath = derivedPath;
    } else {
      effectivePath = [...derivedPath, ...incomingPath];
    }
  }

  return {
    ...baseMeta,
    framePath: effectivePath,
    frameLocatorChain: buildFrameLocatorChain(effectivePath),
    framePathString: buildFramePathString({ segments: effectivePath })
  };
}

function mergeFramePathWithPrefix(path, prefix) {
  const normalizedPath = cloneFramePath(path);
  const normalizedPrefix = cloneFramePath(prefix);
  if (normalizedPrefix.length === 0) {
    return normalizedPath;
  }
  if (normalizedPath.length === 0) {
    return normalizedPrefix;
  }

  if (pathStartsWith(normalizedPath, normalizedPrefix)) {
    return normalizedPath;
  }
  if (pathStartsWith(normalizedPrefix, normalizedPath)) {
    return normalizedPrefix;
  }

  const firstPath = normalizedPath[0];
  const firstIsCrossOriginOnly =
    firstPath &&
    firstPath.crossOrigin === true &&
    !firstPath.id &&
    !firstPath.name &&
    !firstPath.selector &&
    !firstPath.src &&
    !firstPath.srcHostPath &&
    !firstPath.srcStableFragment;
  if (firstIsCrossOriginOnly) {
    return normalizedPrefix;
  }

  return [...normalizedPrefix, ...normalizedPath];
}

function buildFrameSegmentFromElement(frameElement, frameIndex = -1) {
  if (!(frameElement instanceof Element)) {
    return null;
  }
  const frameRules = getPickerRules().frame;
  const frameName = safeAttribute(frameElement, "name") || "";
  const frameNameStable = frameName ? !isLikelyDynamicToken(frameName) : false;
  const frameId = safeAttribute(frameElement, "id") || "";
  const frameIdStable = frameId ? !isLikelyDynamicToken(frameId) : false;
  const frameSrc = safeAttribute(frameElement, "src") || "";
  const frameSrcHostPath = buildFrameSrcHostPath(frameSrc);
  const frameSrcStableFragment = buildFrameSrcStableFragment(frameSrc);
  const frameBorder = safeAttribute(frameElement, "frameborder") || "";
  const frameTag = frameElement.tagName.toLowerCase() === "frame" ? "frame" : "iframe";
  let selector = "";
  if (frameId && frameIdStable) {
    selector = `${frameTag}#${cssEscape(frameId)}`;
  } else if (frameName && frameNameStable) {
    selector = `${frameTag}[name="${escapeForDoubleQuoted(frameName)}"]`;
  } else if (frameSrcHostPath) {
    selector = `${frameTag}[src^="${escapeForDoubleQuoted(frameSrcHostPath)}"]`;
  } else if (frameSrcStableFragment) {
    selector = `${frameTag}[src*="${escapeForDoubleQuoted(frameSrcStableFragment)}"]`;
  } else if (frameSrc) {
    const shortSrc = frameSrc.slice(0, 80);
    selector = `${frameTag}[src*="${escapeForDoubleQuoted(shortSrc)}"]`;
  } else if (frameBorder && frameId && frameIdStable) {
    selector = `${frameTag}[frameborder="${escapeForDoubleQuoted(frameBorder)}"]#${cssEscape(frameId)}`;
  } else if (frameBorder) {
    selector = `${frameTag}[frameborder="${escapeForDoubleQuoted(frameBorder)}"]`;
  } else {
    selector = buildCssPath(frameElement, 4, { allowId: true, allowDynamicId: false });
  }
  const attrHints = {};
  for (const attrName of frameRules.preferredAttributes) {
    if (attrName === "id" || attrName === "name" || attrName === "src" || attrName === "frameborder") {
      continue;
    }
    if (!isValidAttributeName(attrName)) {
      continue;
    }
    const attrValue = (safeAttribute(frameElement, attrName) || "").trim();
    if (!attrValue || isLikelyDynamicToken(attrValue)) {
      continue;
    }
    attrHints[attrName] = attrValue.slice(0, 160);
    if (Object.keys(attrHints).length >= 5) {
      break;
    }
  }
  return {
    index: Number.isFinite(frameIndex) ? frameIndex : -1,
    hint: buildFrameSegmentHint({
      index: Number.isFinite(frameIndex) ? frameIndex : -1,
      name: frameName,
      id: frameId,
      idStable: frameIdStable,
      srcHostPath: frameSrcHostPath,
      srcStableFragment: frameSrcStableFragment
    }),
    tag: frameTag,
    name: frameName,
    id: frameId,
    idStable: frameIdStable,
    src: frameSrc.slice(0, 280),
    srcHostPath: frameSrcHostPath,
    srcStableFragment: frameSrcStableFragment,
    frameBorder,
    selector,
    crossOrigin: false,
    attrHints
  };
}

function postToPage(type, data = {}) {
  if (window !== window.top) {
    return;
  }
  window.postMessage(
    {
      source: RECORDER_SOURCE,
      type,
      ...data
    },
    "*"
  );
}

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function escapeForDoubleQuoted(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeForSingleQuoted(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function safeAttribute(element, name) {
  try {
    return element.getAttribute(name);
  } catch {
    return null;
  }
}

function normalizeInlineText(value, max = 60) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 3)}...`;
}

function isLikelyDynamicToken(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return false;
  }
  const rules = getPickerRules();
  const patterns = [
    ...(Array.isArray(rules.selector?.dynamicTokenPatterns) ? rules.selector.dynamicTokenPatterns : []),
    ...(Array.isArray(rules.frame?.dynamicIdPatterns) ? rules.frame.dynamicIdPatterns : [])
  ];
  return patterns.some(pattern => regexTest(pattern, raw));
}

function countTextTokens(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function isLikelyDynamicText(value) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return false;
  }
  const selectorRules = getPickerRules().selector || DEFAULT_SELECTOR_PICKER_RULES;
  const maxStableTextLength = clampInteger(
    selectorRules.maxStableTextLength,
    DEFAULT_SELECTOR_PICKER_RULES.maxStableTextLength,
    24,
    280
  );
  const maxTextTokenCount = clampInteger(
    selectorRules.maxTextTokenCount,
    DEFAULT_SELECTOR_PICKER_RULES.maxTextTokenCount,
    3,
    24
  );
  if (text.length > maxStableTextLength) {
    return true;
  }
  if (countTextTokens(text) > maxTextTokenCount) {
    return true;
  }
  const dynamicTextPatterns = Array.isArray(selectorRules.dynamicTextPatterns)
    ? selectorRules.dynamicTextPatterns
    : [];
  if (dynamicTextPatterns.some(pattern => regexTest(pattern, text))) {
    return true;
  }
  const tokens = text.split(/\s+/).slice(0, maxTextTokenCount + 2);
  let dynamicTokenHits = 0;
  for (const token of tokens) {
    const cleaned = token.replace(/[^a-zA-Z0-9_\-:.]/g, "");
    if (!cleaned) {
      continue;
    }
    if (isLikelyDynamicToken(cleaned)) {
      dynamicTokenHits += 1;
      if (dynamicTokenHits >= 2) {
        return true;
      }
    }
  }
  return false;
}

function pickStableInlineText(value, maxLength) {
  const normalized = normalizeInlineText(value, maxLength);
  if (!normalized) {
    return "";
  }
  return isLikelyDynamicText(normalized) ? "" : normalized;
}

function buildFrameSrcParts(src) {
  const value = String(src || "").trim();
  if (!value) {
    return { hostPath: "", stableFragment: "" };
  }
  const frameRules = getPickerRules().frame;
  const maxQueryParams = clampInteger(frameRules.maxQueryParams, 2, 0, 6);
  const maxParamValueLength = clampInteger(frameRules.maxParamValueLength, 96, 8, 256);
  const maxSrcFragmentLength = clampInteger(frameRules.maxSrcFragmentLength, 220, 40, 400);
  const dynamicQueryKeys = new Set(
    normalizeStringList(frameRules.dynamicQueryKeys || DEFAULT_FRAME_PICKER_RULES.dynamicQueryKeys, {
      lowerCase: true,
      max: 64
    })
  );
  const stableQueryAllowlist = new Set(
    normalizeStringList(frameRules.stableQueryAllowlist || DEFAULT_FRAME_PICKER_RULES.stableQueryAllowlist, {
      lowerCase: true,
      max: 32
    })
  );
  try {
    const url = new URL(value, location.href);
    const hostPath = `${url.origin}${url.pathname}`.slice(0, maxSrcFragmentLength);
    const kept = [];
    for (const [rawKey, rawValue] of url.searchParams.entries()) {
      const key = String(rawKey || "").trim();
      const lowerKey = key.toLowerCase();
      if (!key || !rawValue) {
        continue;
      }
      if (dynamicQueryKeys.has(lowerKey)) {
        continue;
      }
      const normalizedValue = String(rawValue).trim();
      if (!normalizedValue || isLikelyDynamicToken(normalizedValue)) {
        continue;
      }
      const shortValue = normalizedValue.slice(0, maxParamValueLength);
      if (stableQueryAllowlist.size > 0 && !stableQueryAllowlist.has(lowerKey)) {
        continue;
      }
      kept.push([key, shortValue]);
      if (kept.length >= maxQueryParams) {
        break;
      }
    }
    if (kept.length > 0) {
      const query = new URLSearchParams();
      for (const [key, shortValue] of kept) {
        query.append(key, shortValue);
      }
      const stableToken = query.toString().split("&").filter(Boolean)[0] || query.toString();
      return {
        hostPath,
        stableFragment: stableToken.slice(0, maxSrcFragmentLength)
      };
    }
    return { hostPath, stableFragment: hostPath };
  } catch {
    const normalized = value.split("?")[0]?.trim() || "";
    const clipped = normalized.slice(0, 200);
    return { hostPath: clipped, stableFragment: clipped };
  }
}

function buildFrameSrcHostPath(src) {
  return buildFrameSrcParts(src).hostPath;
}

function buildFrameSrcStableFragment(src) {
  return buildFrameSrcParts(src).stableFragment;
}

function inferRoleFromTag(element) {
  const tag = element.tagName.toLowerCase();
  if (tag === "button") {
    return "button";
  }
  if (tag === "a" && safeAttribute(element, "href")) {
    return "link";
  }
  if (tag === "input") {
    const type = (safeAttribute(element, "type") || "").toLowerCase();
    if (["button", "submit", "reset"].includes(type)) {
      return "button";
    }
    if (["checkbox"].includes(type)) {
      return "checkbox";
    }
    if (["radio"].includes(type)) {
      return "radio";
    }
    return "textbox";
  }
  if (tag === "select") {
    return "combobox";
  }
  if (tag === "textarea") {
    return "textbox";
  }
  return "";
}

function buildElementHint(element) {
  if (!(element instanceof Element)) {
    return "<unknown>";
  }
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const cls = Array.from(element.classList)
    .slice(0, 2)
    .map(item => `.${item}`)
    .join("");
  return `<${tag}${id}${cls}>`;
}

function buildFrameSegmentHint(segment) {
  if (!segment || typeof segment !== "object") {
    return "frame";
  }
  const compactSource = source => {
    const raw = String(source || "").trim();
    if (!raw) {
      return "";
    }
    try {
      const url = new URL(raw, location.href);
      const fileName = url.pathname.split("/").filter(Boolean).pop() || url.pathname || "/";
      return `${url.host}${fileName.startsWith("/") ? fileName : `/${fileName}`}`;
    } catch {
      return raw.replace(/^https?:\/\//i, "").slice(0, 60);
    }
  };
  if (typeof segment.name === "string" && segment.name.trim() && !isLikelyDynamicToken(segment.name)) {
    return segment.name.trim();
  }
  if (typeof segment.id === "string" && segment.id.trim()) {
    const stable = typeof segment.idStable === "boolean" ? segment.idStable : !isLikelyDynamicToken(segment.id);
    if (stable) {
      return `#${segment.id.trim()}`;
    }
  }
  if (typeof segment.srcHostPath === "string" && segment.srcHostPath.trim()) {
    return compactSource(segment.srcHostPath);
  }
  if (typeof segment.srcStableFragment === "string" && segment.srcStableFragment.trim()) {
    return compactSource(segment.srcStableFragment);
  }
  if (typeof segment.index === "number" && Number.isFinite(segment.index) && segment.index >= 0) {
    return `frame[${segment.index}]`;
  }
  return "frame";
}

function buildCssPath(element, maxDepth = 8, options = {}) {
  if (!(element instanceof Element)) {
    return "unknown";
  }
  const allowId = options?.allowId !== false;
  const allowDynamicId = options?.allowDynamicId !== false;
  const selectorRules = getPickerRules().selector;
  const dynamicClassPatterns = Array.isArray(selectorRules.dynamicClassPatterns)
    ? selectorRules.dynamicClassPatterns
    : [];
  const segments = [];
  let current = element;
  let depth = 0;

  while (current && current.nodeType === Node.ELEMENT_NODE && depth < maxDepth) {
    let segment = current.tagName.toLowerCase();
    const currentId = String(current.id || "").trim();
    if (currentId && allowId) {
      const dynamicId = isLikelyDynamicToken(currentId);
      if (!dynamicId || allowDynamicId) {
        segment = `#${cssEscape(currentId)}`;
        segments.unshift(segment);
        break;
      }
    }
    const stableClass = Array.from(current.classList || []).find(item => {
      const token = String(item || "").trim();
      if (!token || isLikelyDynamicToken(token)) {
        return false;
      }
      return !dynamicClassPatterns.some(pattern => regexTest(pattern, token));
    });
    if (stableClass) {
      segment += `.${cssEscape(stableClass)}`;
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(sibling => sibling.tagName === current.tagName);
      if (siblings.length > 1) {
        segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
    }
    segments.unshift(segment);
    current = parent;
    depth += 1;
  }

  return segments.join(" > ") || element.tagName.toLowerCase();
}

function buildXPath(element) {
  if (!(element instanceof Element)) {
    return "xpath=//*";
  }
  if (element.id) {
    return `xpath=//*[@id='${escapeForSingleQuoted(element.id)}']`;
  }
  const segments = [];
  let current = element;
  let depth = 0;
  while (current && current.nodeType === Node.ELEMENT_NODE && depth < 10) {
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) {
      segments.unshift(`/${tag}[1]`);
      break;
    }
    const siblings = Array.from(parent.children).filter(item => item.tagName === current.tagName);
    const index = siblings.indexOf(current) + 1;
    segments.unshift(`/${tag}[${index}]`);
    current = parent;
    depth += 1;
  }
  return `xpath=${segments.join("") || "//*"}`;
}

function countCssMatches(selector) {
  if (!selector || typeof selector !== "string") {
    return -1;
  }
  try {
    return document.querySelectorAll(selector).length;
  } catch {
    return -1;
  }
}

function countXPathMatches(selector) {
  if (!selector || typeof selector !== "string") {
    return -1;
  }
  const normalized = selector.startsWith("xpath=") ? selector.slice(6) : selector;
  try {
    const result = document.evaluate(normalized, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    return result.snapshotLength;
  } catch {
    return -1;
  }
}

function selectorTypeFromValue(value, fallback = "css") {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("xpath=") || normalized.startsWith("//") || normalized.startsWith(".//")) {
    return "xpath";
  }
  if (normalized.startsWith("text=")) {
    return "text";
  }
  if (normalized.startsWith("role=")) {
    return "role";
  }
  return fallback;
}

function normalizedPrimaryCandidates(candidates) {
  if (!Array.isArray(candidates)) {
    return [];
  }
  const list = candidates
    .filter(item => item && typeof item === "object" && typeof item.value === "string" && item.value.trim())
    .map(item => ({
      ...item,
      value: item.value.trim(),
      score: clamp01(typeof item.score === "number" ? item.score : 0.5)
    }));
  if (list.length === 0) {
    return [];
  }
  const primaryIndex = list.findIndex(item => item.primary === true);
  const effectivePrimaryIndex = primaryIndex >= 0 ? primaryIndex : 0;
  return list.map((item, index) => ({ ...item, primary: index === effectivePrimaryIndex }));
}

function buildSelectorCandidates(element) {
  if (!(element instanceof Element)) {
    return [{ type: "css", value: "*", score: 0.01, primary: true, reason: "fallback" }];
  }

  const selectorRules = getPickerRules().selector;
  const preferredAttributes = Array.isArray(selectorRules.preferredAttributes)
    ? selectorRules.preferredAttributes
    : [];
  const maxAccessibleNameLength = clampInteger(
    selectorRules.maxAccessibleNameLength,
    DEFAULT_SELECTOR_PICKER_RULES.maxAccessibleNameLength,
    16,
    120
  );
  const tag = element.tagName.toLowerCase();
  const roleFromAttr = safeAttribute(element, "role");
  const role = roleFromAttr || inferRoleFromTag(element);
  const ariaLabel = pickStableInlineText(safeAttribute(element, "aria-label") || "", maxAccessibleNameLength);
  const title = pickStableInlineText(safeAttribute(element, "title") || "", maxAccessibleNameLength);
  const placeholder = pickStableInlineText(safeAttribute(element, "placeholder") || "", maxAccessibleNameLength);
  const visibleTextForName = pickStableInlineText(
    element.textContent || "",
    Math.min(selectorRules.maxTextCandidateLength, maxAccessibleNameLength)
  );
  const accessibleName = ariaLabel || title || placeholder || visibleTextForName;

  const raw = [];
  const id = element.id;
  if (id) {
    const idStable = !isLikelyDynamicToken(id);
    raw.push({
      type: "css",
      value: `#${cssEscape(id)}`,
      baseScore: idStable ? 0.98 : 0.24,
      reason: idStable ? "id" : "id-volatile"
    });
  }

  const preferredDataAttrs = preferredAttributes
    .filter(attr => attr.startsWith("data-"))
    .filter((attr, index, list) => list.indexOf(attr) === index);
  for (const attr of preferredDataAttrs) {
    const value = (safeAttribute(element, attr) || "").trim();
    if (value && !isLikelyDynamicToken(value)) {
      raw.push({
        type: "css",
        value: `[${attr}="${escapeForDoubleQuoted(value)}"]`,
        baseScore: 0.96,
        reason: attr
      });
    }
  }

  const genericPreferredAttrs = preferredAttributes
    .filter(attr => !preferredDataAttrs.includes(attr))
    .filter(attr => !["id", "name", "role", "aria-label", "title", "placeholder", "src", "href"].includes(attr))
    .filter(attr => isValidAttributeName(attr));
  for (const attr of genericPreferredAttrs) {
    const value = (safeAttribute(element, attr) || "").trim();
    if (!value || isLikelyDynamicToken(value)) {
      continue;
    }
    raw.push({
      type: "css",
      value: `${tag}[${attr}="${escapeForDoubleQuoted(value)}"]`,
      baseScore: 0.87,
      reason: attr
    });
  }

  const name = safeAttribute(element, "name");
  if (name && !isLikelyDynamicToken(name)) {
    raw.push({
      type: "css",
      value: `${tag}[name="${escapeForDoubleQuoted(name)}"]`,
      baseScore: 0.89,
      reason: "name"
    });
  }

  if (ariaLabel) {
    raw.push({
      type: "css",
      value: `${tag}[aria-label="${escapeForDoubleQuoted(ariaLabel)}"]`,
      baseScore: 0.88,
      reason: "aria-label"
    });
  }
  if (title) {
    raw.push({
      type: "css",
      value: `${tag}[title="${escapeForDoubleQuoted(title)}"]`,
      baseScore: 0.83,
      reason: "title"
    });
  }
  if (placeholder) {
    raw.push({
      type: "css",
      value: `${tag}[placeholder="${escapeForDoubleQuoted(placeholder)}"]`,
      baseScore: 0.82,
      reason: "placeholder"
    });
  }

  if (role && accessibleName) {
    raw.push({
      type: "role",
      value: `role=${role}[name="${escapeForDoubleQuoted(accessibleName)}"]`,
      baseScore: 0.82,
      reason: "role+name"
    });
  } else if (role) {
    raw.push({
      type: "role",
      value: `role=${role}`,
      baseScore: 0.68,
      reason: "role"
    });
  }

  const textHint = pickStableInlineText(element.textContent || "", selectorRules.maxTextCandidateLength);
  if (textHint && selectorRules.textFriendlyTags.includes(tag)) {
    raw.push({
      type: "text",
      value: `text=${textHint}`,
      baseScore: 0.73,
      reason: "visible-text"
    });
  }

  raw.push({
    type: "css",
    value: buildCssPath(element),
    baseScore: 0.62,
    reason: "css-path"
  });
  raw.push({
    type: "xpath",
    value: buildXPath(element),
    baseScore: 0.58,
    reason: "xpath-path"
  });

  const dedup = new Map();
  for (const candidate of raw) {
    const key = `${candidate.type}|${candidate.value}`;
    if (!dedup.has(key)) {
      dedup.set(key, candidate);
    }
  }

  const ranked = Array.from(dedup.values())
    .map(candidate => {
      let score = candidate.baseScore;
      let uniqueness = -1;
      if (candidate.type === "css") {
        uniqueness = countCssMatches(candidate.value);
      } else if (candidate.type === "xpath") {
        uniqueness = countXPathMatches(candidate.value);
      }
      if (uniqueness === 1) {
        score += 0.08;
      } else if (uniqueness > 1) {
        score -= Math.min(0.32, 0.06 * (uniqueness - 1));
      }
      if (selectorRules.noisySelectorPatterns.some(pattern => regexTest(pattern, candidate.value))) {
        score -= 0.08;
      }
      if (candidate.type === "text" && candidate.value.length > selectorRules.maxTextCandidateLength) {
        score -= 0.08;
      }
      if (candidate.type === "text") {
        const rawText = candidate.value.startsWith("text=") ? candidate.value.slice(5) : candidate.value;
        if (isLikelyDynamicText(rawText)) {
          score -= 0.2;
        }
      }
      if (candidate.type === "role") {
        if (!candidate.value.includes("[name=")) {
          score -= 0.1;
        } else {
          const nameMatch = candidate.value.match(/\[name="([^"]+)"/);
          const roleName = nameMatch?.[1] || "";
          if (isLikelyDynamicText(roleName)) {
            score -= 0.24;
          }
        }
      }
      if (typeof candidate.reason === "string" && candidate.reason.includes("volatile")) {
        score -= 0.18;
      }
      return {
        type: selectorTypeFromValue(candidate.value, candidate.type),
        value: candidate.value,
        score: clamp01(score),
        reason: candidate.reason,
        uniqueness
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((candidate, index) => ({
      ...candidate,
      primary: index === 0
    }));

  return ranked.slice(0, selectorRules.maxCandidates);
}

function findAssociatedLabelText(element) {
  if (!(element instanceof Element)) {
    return "";
  }
  const id = safeAttribute(element, "id");
  if (id) {
    try {
      const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
      const labelText = pickStableInlineText(label?.textContent || "", 42);
      if (labelText) {
        return labelText;
      }
    } catch {
      // Ignore invalid CSS escape fallbacks.
    }
  }
  const wrappedLabel = element.closest("label");
  return pickStableInlineText(wrappedLabel?.textContent || "", 42);
}

function readAriaLabelledByText(element) {
  const labelledBy = safeAttribute(element, "aria-labelledby");
  if (!labelledBy) {
    return "";
  }
  const tokens = labelledBy
    .split(/\s+/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (tokens.length === 0) {
    return "";
  }
  const values = tokens
    .map(id => {
      try {
        const node = document.getElementById(id);
        return pickStableInlineText(node?.textContent || "", 24);
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  return pickStableInlineText(values.join(" "), 42);
}

function buildPlaywrightCandidates(element, selectorCandidates) {
  if (!(element instanceof Element)) {
    return [{ type: "css", value: "*", score: 0.01, primary: true, reason: "fallback" }];
  }

  const selectorRules = getPickerRules().selector;
  const maxAccessibleNameLength = clampInteger(
    selectorRules.maxAccessibleNameLength,
    DEFAULT_SELECTOR_PICKER_RULES.maxAccessibleNameLength,
    16,
    120
  );
  const list = [];
  const testAttrs = Array.from(
    new Set([
      "data-testid",
      "data-test-id",
      "data-test",
      "data-qa",
      "data-cy",
      ...(Array.isArray(selectorRules.preferredAttributes)
        ? selectorRules.preferredAttributes.filter(attr => attr.startsWith("data-"))
        : [])
    ])
  );
  for (const attr of testAttrs) {
    const value = safeAttribute(element, attr);
    if (!value || isLikelyDynamicToken(value)) {
      continue;
    }
    list.push({
      type: "css",
      value: `[${attr}="${escapeForDoubleQuoted(value)}"]`,
      score: 0.99,
      reason: attr
    });
  }

  const role = safeAttribute(element, "role") || inferRoleFromTag(element);
  const ariaLabel = pickStableInlineText(safeAttribute(element, "aria-label") || "", maxAccessibleNameLength);
  const labelledByText = readAriaLabelledByText(element);
  const labelText = findAssociatedLabelText(element);
  const placeholder = pickStableInlineText(safeAttribute(element, "placeholder") || "", maxAccessibleNameLength);
  const title = pickStableInlineText(safeAttribute(element, "title") || "", maxAccessibleNameLength);
  const textHint = pickStableInlineText(element.textContent || "", selectorRules.maxTextCandidateLength);

  const accessibleName = ariaLabel || labelledByText || labelText || placeholder || title || textHint;
  if (role && accessibleName) {
    list.push({
      type: "role",
      value: `role=${role}[name="${escapeForDoubleQuoted(accessibleName)}"]`,
      score: 0.88,
      reason: "role+name"
    });
  }
  if (role) {
    list.push({
      type: "role",
      value: `role=${role}`,
      score: 0.64,
      reason: "role"
    });
  }

  if (labelText) {
    list.push({
      type: "text",
      value: `text=${labelText}`,
      score: 0.79,
      reason: "label"
    });
  }
  if (placeholder) {
    list.push({
      type: "text",
      value: `text=${placeholder}`,
      score: 0.77,
      reason: "placeholder"
    });
  }
  if (title) {
    list.push({
      type: "text",
      value: `text=${title}`,
      score: 0.75,
      reason: "title"
    });
  }
  if (textHint) {
    list.push({
      type: "text",
      value: `text=${textHint}`,
      score: 0.73,
      reason: "text"
    });
  }

  for (const candidate of selectorCandidates) {
    if (!(candidate && typeof candidate.value === "string" && candidate.value.trim())) {
      continue;
    }
    const normalizedType = selectorTypeFromValue(candidate.value, candidate.type || "css");
    const normalizedValue = candidate.value.trim();
    const reasonText = String(candidate.reason || candidate.type || "selector").toLowerCase();
    const volatileHint = reasonText.includes("volatile");
    let score = typeof candidate.score === "number" ? candidate.score : 0.5;
    if (normalizedType === "css" && !volatileHint) {
      score = score + 0.03;
    } else {
      score = score - 0.04;
    }
    if (normalizedType === "text") {
      const rawText = normalizedValue.startsWith("text=") ? normalizedValue.slice(5) : normalizedValue;
      if (isLikelyDynamicText(rawText)) {
        score -= 0.2;
      }
    }
    if (normalizedType === "role" && normalizedValue.includes("[name=")) {
      const roleName = normalizedValue.match(/\[name="([^"]+)"/)?.[1] || "";
      if (isLikelyDynamicText(roleName)) {
        score -= 0.24;
      }
    }
    if (volatileHint) {
      score -= 0.14;
    }
    list.push({
      type: normalizedType,
      value: normalizedValue,
      score: clamp01(score),
      reason: `legacy:${candidate.reason || candidate.type || "selector"}`
    });
  }

  const dedup = new Map();
  for (const item of list) {
    const key = `${item.type}|${item.value}`;
    if (!dedup.has(key)) {
      dedup.set(key, item);
    }
  }

  const ranked = Array.from(dedup.values())
    .map(item => {
      let score = typeof item.score === "number" ? item.score : 0.5;
      if (item.type === "role" && !String(item.value || "").includes("[name=")) {
        score -= 0.06;
      }
      if (item.type === "text") {
        const rawText = String(item.value || "").startsWith("text=")
          ? String(item.value).slice(5)
          : String(item.value || "");
        if (isLikelyDynamicText(rawText)) {
          score -= 0.16;
        }
      }
      return { ...item, score: clamp01(score) };
    })
    .sort((a, b) => b.score - a.score);
  return normalizedPrimaryCandidates(ranked.slice(0, selectorRules.maxCandidates));
}

function selectorContainsFrameId(selector, frameId) {
  if (!(typeof selector === "string" && selector.trim() && typeof frameId === "string" && frameId.trim())) {
    return false;
  }
  const rawSelector = selector.trim();
  const normalizedId = frameId.trim();
  const escapedId = cssEscape(normalizedId);
  return rawSelector.includes(`#${normalizedId}`) || rawSelector.includes(`#${escapedId}`);
}

function buildFrameSegmentSelectorCandidates(segment) {
  if (!segment || segment.crossOrigin) {
    return [];
  }
  const frameRules = getPickerRules().frame;
  const candidates = [];
  const frameTag =
    typeof segment.tag === "string" && /^(iframe|frame)$/i.test(segment.tag.trim())
      ? segment.tag.trim().toLowerCase()
      : "iframe";
  const frameIdStable =
    typeof segment.idStable === "boolean"
      ? segment.idStable
      : !isLikelyDynamicToken(segment.id || "");
  const srcHostPath =
    typeof segment.srcHostPath === "string" ? segment.srcHostPath.trim() : buildFrameSrcHostPath(segment.src || "");
  const srcStableFragment =
    typeof segment.srcStableFragment === "string"
      ? segment.srcStableFragment.trim()
      : buildFrameSrcStableFragment(segment.src || "");
  const frameBorder =
    typeof segment.frameBorder === "string" ? segment.frameBorder.trim() : "";
  const hasStableFrameIdentity = Boolean(
    srcHostPath ||
    srcStableFragment ||
    (typeof segment.name === "string" && segment.name.trim()) ||
    (segment.attrHints && typeof segment.attrHints === "object" && Object.keys(segment.attrHints).length > 0)
  );
  if (segment.id) {
    if (frameIdStable) {
      candidates.push({
        type: "css",
        value: `#${cssEscape(segment.id)}`,
        score: 0.99,
        reason: "frame-id"
      });
      candidates.push({
        type: "css",
        value: `${frameTag}#${cssEscape(segment.id)}`,
        score: 0.98,
        reason: "frame-id-tag"
      });
    } else if (!hasStableFrameIdentity) {
      candidates.push({
        type: "css",
        value: `${frameTag}#${cssEscape(segment.id)}`,
        score: 0.34,
        reason: "frame-id-volatile"
      });
    }
  }
  if (segment.name) {
    const frameNameStable = !isLikelyDynamicToken(segment.name);
    candidates.push({
      type: "css",
      value: `${frameTag}[name="${escapeForDoubleQuoted(segment.name)}"]`,
      score: frameNameStable ? 0.94 : 0.26,
      reason: frameNameStable ? "frame-name" : "frame-name-volatile"
    });
  }
  const attrHints =
    segment.attrHints && typeof segment.attrHints === "object" ? Object.entries(segment.attrHints) : [];
  const stableAttrPairs = [];
  for (const [rawName, rawValue] of attrHints) {
    const attrName = String(rawName || "").trim().toLowerCase();
    const attrValue = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!isValidAttributeName(attrName)) {
      continue;
    }
    if (!attrValue || isLikelyDynamicToken(attrValue)) {
      continue;
    }
    stableAttrPairs.push([attrName, attrValue]);
    const scoreOverride = frameRules.attributeScoreOverrides?.[attrName];
    const score =
      typeof scoreOverride === "number" && Number.isFinite(scoreOverride)
        ? clamp01(scoreOverride)
        : attrName.startsWith("data-")
          ? 0.93
          : 0.88;
    candidates.push({
      type: "css",
      value: `${frameTag}[${attrName}="${escapeForDoubleQuoted(attrValue)}"]`,
      score,
      reason: `frame-${attrName}`
    });
  }
  if (srcHostPath && stableAttrPairs.length > 0) {
    const [attrName, attrValue] = stableAttrPairs[0];
    candidates.push({
      type: "css",
      value: `${frameTag}[src^="${escapeForDoubleQuoted(srcHostPath)}"][${attrName}="${escapeForDoubleQuoted(attrValue)}"]`,
      score: attrName.startsWith("data-") ? 0.96 : 0.91,
      reason: `frame-src-${attrName}`
    });
  }
  if (srcStableFragment) {
    const hasKeyValuePattern = srcStableFragment.includes("=");
    candidates.push({
      type: "css",
      value: `${frameTag}[src*="${escapeForDoubleQuoted(srcStableFragment)}"]`,
      score: hasKeyValuePattern ? 0.96 : 0.9,
      reason: hasKeyValuePattern ? "frame-src-query-fragment" : "frame-src-fragment"
    });
  }
  if (srcHostPath) {
    candidates.push({
      type: "css",
      value: `${frameTag}[src^="${escapeForDoubleQuoted(srcHostPath)}"]`,
      score: 0.92,
      reason: "frame-src-hostpath"
    });
  } else if (segment.src) {
    const srcPrefix = segment.src.slice(0, 80);
    if (srcPrefix) {
      candidates.push({
        type: "css",
        value: `${frameTag}[src*="${escapeForDoubleQuoted(srcPrefix)}"]`,
        score: 0.88,
        reason: "frame-src"
      });
    }
  }
  if (frameBorder) {
    candidates.push({
      type: "css",
      value: `${frameTag}[frameborder="${escapeForDoubleQuoted(frameBorder)}"]`,
      score: 0.84,
      reason: "frame-border"
    });
    if (srcHostPath) {
      candidates.push({
        type: "css",
        value: `${frameTag}[frameborder="${escapeForDoubleQuoted(frameBorder)}"][src^="${escapeForDoubleQuoted(srcHostPath)}"]`,
        score: 0.93,
        reason: "frame-border-src"
      });
    }
  }
  if (segment.selector) {
    const selectorValue = String(segment.selector || "").trim();
    const selectorUsesVolatileFrameId =
      Boolean(segment.id) && !frameIdStable && selectorContainsFrameId(selectorValue, segment.id);
    candidates.push({
      type: "css",
      value: selectorValue,
      score: selectorUsesVolatileFrameId ? 0.24 : 0.82,
      reason: selectorUsesVolatileFrameId ? "frame-css-volatile" : "frame-css"
    });
  }
  if (typeof segment.index === "number" && segment.index >= 0) {
    candidates.push({
      type: "css",
      value: `${frameTag}:nth-of-type(${segment.index + 1})`,
      score: 0.64,
      reason: "frame-index"
    });
    if (frameBorder) {
      candidates.push({
        type: "css",
        value: `${frameTag}[frameborder="${escapeForDoubleQuoted(frameBorder)}"]:nth-of-type(${segment.index + 1})`,
        score: 0.78,
        reason: "frame-border-index"
      });
    }
  }
  const dedup = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.type}|${candidate.value}`;
    if (!dedup.has(key)) {
      dedup.set(key, candidate);
    }
  }
  const ranked = Array.from(dedup.values()).sort((a, b) => b.score - a.score);
  return normalizedPrimaryCandidates(ranked).slice(0, frameRules.maxCandidates);
}
function buildFrameLocatorChain(frameSegments) {
  if (!Array.isArray(frameSegments) || frameSegments.length === 0) {
    return [];
  }
  return frameSegments.map((segment, depth) => {
    const selectorCandidates = buildFrameSegmentSelectorCandidates(segment);
    return {
      depth,
      hint: segment.hint || `frame#${depth + 1}`,
      crossOrigin: Boolean(segment.crossOrigin),
      index: typeof segment.index === "number" ? segment.index : -1,
      primary:
        selectorCandidates.find(item => item.primary === true)?.value ||
        selectorCandidates[0]?.value ||
        "",
      selectorCandidates
    };
  });
}

function buildFramePathSegments() {
  const segments = [];
  let current = window;
  let guard = 0;
  while (current !== current.parent && guard < 16) {
    guard += 1;
    let frameElement = null;
    let parentWindow = null;
    try {
      frameElement = current.frameElement;
      parentWindow = current.parent;
    } catch {
      segments.unshift({
        index: -1,
        hint: "cross-origin-frame",
        tag: "",
        name: "",
        id: "",
        idStable: false,
        src: "",
        srcHostPath: "",
        frameBorder: "",
        selector: "",
        crossOrigin: true,
        attrHints: {}
      });
      break;
    }
    if (!(frameElement instanceof Element)) {
      break;
    }

    let frameIndex = -1;
    try {
      frameIndex = resolveFrameElementIndex(parentWindow, frameElement);
    } catch {
      frameIndex = -1;
    }
    const segment = buildFrameSegmentFromElement(frameElement, frameIndex);
    if (segment) {
      segments.unshift(segment);
    }
    current = parentWindow;
  }
  return segments;
}

function frameMeta() {
  const ownSegments = buildFramePathSegments();
  const prefixSegments = cloneFramePath(picker.framePathPrefix);
  let segments = ownSegments;
  if (prefixSegments.length > 0 && ownSegments.length === 0) {
    segments = prefixSegments;
  } else if (prefixSegments.length > 0 && ownSegments.length > 0) {
    if (pathStartsWith(ownSegments, prefixSegments)) {
      segments = ownSegments;
    } else if (pathStartsWith(prefixSegments, ownSegments)) {
      segments = prefixSegments;
    } else {
      segments = [...prefixSegments, ...ownSegments];
    }
  }
  return {
    isTop: window === window.top,
    url: location.href,
    path: segments.map(item => item.hint),
    segments
  };
}

function buildFramePathString(meta) {
  if (!meta || !Array.isArray(meta.segments) || meta.segments.length === 0) {
    return "top";
  }
  const compactSource = source => {
    const raw = String(source || "").trim();
    if (!raw) {
      return "";
    }
    try {
      const url = new URL(raw, location.href);
      const fileName = url.pathname.split("/").filter(Boolean).pop() || url.pathname || "/";
      return `${url.host}${fileName.startsWith("/") ? fileName : `/${fileName}`}`;
    } catch {
      return raw.replace(/^https?:\/\//i, "").slice(0, 60);
    }
  };
  const labels = meta.segments.map((segment, index) => {
    if (segment.crossOrigin) {
      return `cross-origin#${index + 1}`;
    }
    if (segment.name && !isLikelyDynamicToken(segment.name)) {
      return segment.name;
    }
    const idStable =
      typeof segment.idStable === "boolean"
        ? segment.idStable
        : !isLikelyDynamicToken(segment.id || "");
    if (segment.id && idStable) {
      return `#${segment.id}`;
    }
    if (segment.frameBorder) {
      return `${segment.tag || "iframe"}[frameborder=${segment.frameBorder}]`;
    }
    if (segment.srcHostPath) {
      return compactSource(segment.srcHostPath);
    }
    if (segment.srcStableFragment) {
      return compactSource(segment.srcStableFragment);
    }
    if (segment.index >= 0) {
      return `frame[${segment.index}]`;
    }
    return `frame#${index + 1}`;
  });
  return ["top", ...labels].join(" > ");
}

function buildEventBase(action, target) {
  const candidates = buildSelectorCandidates(target);
  const primary = candidates[0];
  return {
    action,
    selector: primary?.value || "unknown",
    selectorType: primary?.type || "css",
    selectorCandidates: candidates,
    page: {
      url: location.href,
      title: document.title || ""
    },
    frame: frameMeta()
  };
}

function shouldDropDuplicate(event) {
  const signature = `${event.action}|${event.selector}|${event.value || ""}|${event.text || ""}`;
  const now = Date.now();
  if (signature === lastEventSignature && now - lastEventAt < DEDUPE_WINDOW_MS) {
    return true;
  }
  lastEventSignature = signature;
  lastEventAt = now;
  return false;
}

function sendEvent(event) {
  if (!isRecording) {
    return;
  }
  if (shouldDropDuplicate(event)) {
    return;
  }
  chrome.runtime.sendMessage({ type: "RECORDER_EVENT", event }, () => {
    const error = chrome.runtime.lastError;
    if (error) {
      console.debug("send recorder event failed:", error.message);
    }
  });
}

function onClick(event) {
  if (picker.enabled) {
    return;
  }
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  sendEvent({
    ...buildEventBase("click", target),
    text: normalizeInlineText(target.innerText || "", 220)
  });
}

function onInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    return;
  }
  const base = buildEventBase("input", target);
  const lastAt = lastInputAtBySelector.get(base.selector) || 0;
  const now = Date.now();
  if (now - lastAt < INPUT_THROTTLE_MS) {
    return;
  }
  lastInputAtBySelector.set(base.selector, now);
  sendEvent({
    ...base,
    value: (target.value || "").slice(0, 400),
    inputType: target.type || "text"
  });
}

function onSelect(event) {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }
  const option = target.selectedOptions.item(0);
  sendEvent({
    ...buildEventBase("select", target),
    value: target.value,
    text: option ? normalizeInlineText(option.textContent || "", 180) : ""
  });
}

function sendNavigateSnapshot() {
  sendEvent({
    action: "navigate",
    selector: "window.location",
    selectorType: "playwright",
    selectorCandidates: [{ type: "playwright", value: "window.location", score: 1, primary: true }],
    page: {
      url: location.href,
      title: document.title || ""
    },
    frame: frameMeta()
  });
}

function clampToolbarPosition(left, top) {
  if (!(picker.ui.toolbar instanceof HTMLElement)) {
    return { left, top };
  }
  const rect = picker.ui.toolbar.getBoundingClientRect();
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
  return {
    left: Math.max(margin, Math.min(maxLeft, left)),
    top: Math.max(margin, Math.min(maxTop, top))
  };
}

function applyToolbarPosition() {
  if (!(picker.ui.toolbar instanceof HTMLElement)) {
    return;
  }
  const position = picker.toolbar.position;
  if (!position) {
    picker.ui.toolbar.style.left = "50%";
    picker.ui.toolbar.style.top = "10px";
    picker.ui.toolbar.style.transform = "translateX(-50%)";
    return;
  }
  const clamped = clampToolbarPosition(position.left, position.top);
  picker.toolbar.position = clamped;
  picker.ui.toolbar.style.left = `${clamped.left}px`;
  picker.ui.toolbar.style.top = `${clamped.top}px`;
  picker.ui.toolbar.style.transform = "none";
}

function setToolbarCollapsed(collapsed) {
  picker.toolbar.collapsed = Boolean(collapsed);
  if (picker.ui.toolbar instanceof HTMLElement) {
    picker.ui.toolbar.classList.toggle("collapsed", picker.toolbar.collapsed);
  }
  if (picker.ui.minimize instanceof HTMLElement) {
    picker.ui.minimize.textContent = picker.toolbar.collapsed ? "展开" : "收起";
  }
}
function stopToolbarDrag() {
  if (!picker.toolbar.dragging) {
    return;
  }
  picker.toolbar.dragging = false;
  picker.toolbar.pointerId = null;
  if (picker.ui.toolbar instanceof HTMLElement) {
    picker.ui.toolbar.classList.remove("dragging");
  }
  if (picker.listeners.toolbarPointerMove) {
    window.removeEventListener("pointermove", picker.listeners.toolbarPointerMove, true);
    picker.listeners.toolbarPointerMove = null;
  }
  if (picker.listeners.toolbarPointerUp) {
    window.removeEventListener("pointerup", picker.listeners.toolbarPointerUp, true);
    window.removeEventListener("pointercancel", picker.listeners.toolbarPointerUp, true);
    picker.listeners.toolbarPointerUp = null;
  }
}

function onToolbarPointerMove(event) {
  if (!picker.toolbar.dragging) {
    return;
  }
  if (picker.toolbar.pointerId !== null && event.pointerId !== picker.toolbar.pointerId) {
    return;
  }
  const nextLeft = picker.toolbar.originLeft + (event.clientX - picker.toolbar.startX);
  const nextTop = picker.toolbar.originTop + (event.clientY - picker.toolbar.startY);
  picker.toolbar.position = clampToolbarPosition(nextLeft, nextTop);
  applyToolbarPosition();
  event.preventDefault();
}

function onToolbarPointerUp(event) {
  if (picker.toolbar.pointerId !== null && event.pointerId !== picker.toolbar.pointerId) {
    return;
  }
  stopToolbarDrag();
}

function onToolbarPointerDown(event) {
  if (!(picker.ui.toolbar instanceof HTMLElement)) {
    return;
  }
  if (event.button !== 0) {
    return;
  }
  const target = event.target;
  if (target instanceof Element && target.closest("button")) {
    return;
  }
  const rect = picker.ui.toolbar.getBoundingClientRect();
  if (!picker.toolbar.position) {
    picker.toolbar.position = { left: rect.left, top: rect.top };
  }
  picker.toolbar.dragging = true;
  picker.toolbar.pointerId = event.pointerId;
  picker.toolbar.startX = event.clientX;
  picker.toolbar.startY = event.clientY;
  picker.toolbar.originLeft = picker.toolbar.position.left;
  picker.toolbar.originTop = picker.toolbar.position.top;
  picker.ui.toolbar.classList.add("dragging");

  picker.listeners.toolbarPointerMove = onToolbarPointerMove;
  picker.listeners.toolbarPointerUp = onToolbarPointerUp;
  window.addEventListener("pointermove", picker.listeners.toolbarPointerMove, true);
  window.addEventListener("pointerup", picker.listeners.toolbarPointerUp, true);
  window.addEventListener("pointercancel", picker.listeners.toolbarPointerUp, true);

  event.preventDefault();
  event.stopPropagation();
}

function ensurePickUi() {
  if (picker.ui.root && picker.ui.root.isConnected) {
    return;
  }
  const existing = document.getElementById(PICKER_ROOT_ID);
  if (existing) {
    existing.remove();
  }
  const root = document.createElement("div");
  root.id = PICKER_ROOT_ID;
  root.setAttribute(PICKER_UI_ATTR, "1");
  root.style.position = "fixed";
  root.style.left = "0";
  root.style.top = "0";
  root.style.width = "100vw";
  root.style.height = "100vh";
  root.style.pointerEvents = "none";
  root.style.zIndex = "2147483647";

  const shadow = root.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .rpa-overlay {
        position: fixed;
        left: 0;
        top: 0;
        width: 0;
        height: 0;
        border: 2px solid #0ea5e9;
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(14,165,233,0.18), rgba(14,165,233,0.08));
        box-shadow: 0 0 0 1px rgba(14,165,233,0.35), 0 10px 30px rgba(3,7,18,0.35);
        pointer-events: none;
        transition: width .06s ease, height .06s ease, transform .06s ease;
      }
      .rpa-bubble {
        position: fixed;
        min-width: 220px;
        max-width: min(340px, calc(100vw - 20px));
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(2, 6, 23, 0.93);
        color: #e2e8f0;
        font: 12px/1.4 ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
        box-shadow: 0 12px 26px rgba(2, 6, 23, 0.55);
        pointer-events: none;
        transform: translate(-9999px, -9999px);
      }
      .rpa-bubble strong {
        color: #38bdf8;
      }
      .rpa-toolbar {
        position: fixed;
        left: 50%;
        top: 10px;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: min(760px, calc(100vw - 20px));
        max-width: calc(100vw - 20px);
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid rgba(148, 163, 184, 0.45);
        background: rgba(15, 23, 42, 0.92);
        color: #e2e8f0;
        font: 12px/1.35 ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
        box-shadow: 0 20px 40px rgba(2, 6, 23, 0.45);
        pointer-events: auto;
      }
      .rpa-toolbar.dragging {
        opacity: 0.96;
      }
      .rpa-toolbar-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        cursor: move;
        user-select: none;
      }
      .rpa-toolbar-title {
        font-size: 12px;
        font-weight: 600;
        color: #bfdbfe;
      }
      .rpa-toolbar-head-actions {
        display: flex;
        gap: 6px;
      }
      .rpa-toolbar-body {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        align-items: center;
      }
      .rpa-toolbar .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        min-width: 0;
      }
      .rpa-pill {
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        padding: 2px 8px;
        white-space: nowrap;
        color: #cbd5e1;
        background: rgba(15, 23, 42, 0.28);
      }
      .rpa-pill.status-inspecting { color: #22d3ee; border-color: rgba(34,211,238,0.5); }
      .rpa-pill.status-locked { color: #f59e0b; border-color: rgba(245,158,11,0.5); }
      .rpa-pill.status-picked { color: #22c55e; border-color: rgba(34,197,94,0.5); }
      .rpa-actions {
        display: flex;
        gap: 6px;
      }
      .rpa-toolbar button {
        all: unset;
        cursor: pointer;
        border-radius: 8px;
        padding: 6px 10px;
        border: 1px solid rgba(148, 163, 184, 0.5);
        color: #e2e8f0;
        background: rgba(30, 41, 59, 0.7);
        font: 12px/1 ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      }
      .rpa-toolbar button:hover {
        background: rgba(30, 41, 59, 0.95);
      }
      .rpa-actions .primary {
        background: linear-gradient(135deg, #0ea5e9, #0284c7);
        border-color: rgba(14,165,233,0.55);
      }
      .rpa-actions .danger {
        background: rgba(127, 29, 29, 0.65);
        border-color: rgba(248, 113, 113, 0.55);
      }
      .rpa-toolbar .secondary {
        border-color: rgba(59, 130, 246, 0.5);
        color: #bfdbfe;
      }
      .rpa-hint {
        grid-column: 1 / -1;
        color: #93c5fd;
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .rpa-toolbar.collapsed {
        min-width: 280px;
        width: auto;
      }
      .rpa-toolbar.collapsed .rpa-toolbar-body {
        display: none;
      }
    </style>
    <div class="rpa-overlay" id="rpa-overlay"></div>
    <div class="rpa-bubble" id="rpa-bubble"><span id="rpa-bubble-text"></span></div>
    <div class="rpa-toolbar" id="rpa-toolbar">
      <div class="rpa-toolbar-head" id="rpa-toolbar-head">
        <div class="rpa-toolbar-title">页面拾取器（可拖拽）</div>
        <div class="rpa-toolbar-head-actions">
          <button class="secondary" id="rpa-minimize">收起</button>
          <button class="danger" id="rpa-cancel">取消 (Esc)</button>
        </div>
      </div>
      <div class="rpa-toolbar-body" id="rpa-toolbar-body">
        <div class="meta">
          <span class="rpa-pill status-inspecting" id="rpa-status">检查中</span>
          <span class="rpa-pill" id="rpa-frame">框架: top</span>
          <span class="rpa-pill" id="rpa-confidence">置信度: 0%</span>
          <span class="rpa-pill" id="rpa-fallback">回退: 待命</span>
        </div>
        <div class="rpa-actions">
          <button class="primary" id="rpa-confirm">确认</button>
          <button id="rpa-skip">解锁</button>
        </div>
        <div class="rpa-hint" id="rpa-hint">悬停检查，点击锁定后点“确认”。</div>
      </div>
    </div>
  `;

  const host = document.documentElement || document.body;
  if (!host) {
    return;
  }
  host.appendChild(root);

  picker.ui.root = root;
  picker.ui.shadow = shadow;
  picker.ui.overlay = shadow.getElementById("rpa-overlay");
  picker.ui.bubble = shadow.getElementById("rpa-bubble");
  picker.ui.bubbleText = shadow.getElementById("rpa-bubble-text");
  picker.ui.toolbar = shadow.getElementById("rpa-toolbar");
  picker.ui.status = shadow.getElementById("rpa-status");
  picker.ui.frame = shadow.getElementById("rpa-frame");
  picker.ui.confidence = shadow.getElementById("rpa-confidence");
  picker.ui.fallback = shadow.getElementById("rpa-fallback");
  picker.ui.hint = shadow.getElementById("rpa-hint");
  picker.ui.toolbarHead = shadow.getElementById("rpa-toolbar-head");
  picker.ui.toolbarBody = shadow.getElementById("rpa-toolbar-body");
  picker.ui.minimize = shadow.getElementById("rpa-minimize");
  picker.ui.confirm = shadow.getElementById("rpa-confirm");
  picker.ui.skip = shadow.getElementById("rpa-skip");
  picker.ui.cancel = shadow.getElementById("rpa-cancel");

  if (window !== window.top) {
    if (picker.ui.toolbar) {
      picker.ui.toolbar.style.display = "none";
    }
    if (picker.ui.bubble) {
      picker.ui.bubble.style.display = "none";
    }
  }

  applyToolbarPosition();
  setToolbarCollapsed(picker.toolbar.collapsed);

  if (picker.ui.toolbarHead) {
    picker.ui.toolbarHead.addEventListener("pointerdown", onToolbarPointerDown, true);
  }
  if (picker.ui.minimize) {
    picker.ui.minimize.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      setToolbarCollapsed(!picker.toolbar.collapsed);
      applyToolbarPosition();
    });
  }

  if (picker.ui.confirm) {
    picker.ui.confirm.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      requestPickConfirm("toolbar_button");
    });
  }
  if (picker.ui.skip) {
    picker.ui.skip.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if (window === window.top && activePickFrame && activePickFrame !== window) {
        const derivedPrefix = resolveFramePathByWindowRef(activePickFrame);
        const hoverPrefix = cloneFramePath(picker.hoverMeta?.framePath);
        const framePathPrefix = derivedPrefix.length > 0 ? derivedPrefix : hoverPrefix;
        postMessageSafe(activePickFrame, {
          source: RECORDER_SOURCE,
          type: "RPA_PICK_CMD_UNLOCK",
          framePathPrefix
        });
        releaseActiveFrameLock();
        setPickerState(PICKER_STATES.INSPECTING);
        updatePickerToolbar(picker.hoverMeta, "hover");
      } else {
        unlockPick();
      }
    });
  }
  if (picker.ui.cancel) {
    picker.ui.cancel.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      notifyPickError("元素拾取已取消。", "cancelled");
    });
  }
}
function hidePickUi() {
  stopToolbarDrag();
  if (picker.ui.root && picker.ui.root.parentNode) {
    picker.ui.root.parentNode.removeChild(picker.ui.root);
  }
  picker.ui = {
    root: null,
    shadow: null,
    overlay: null,
    bubble: null,
    bubbleText: null,
    toolbar: null,
    status: null,
    frame: null,
    confidence: null,
    fallback: null,
    hint: null,
    toolbarHead: null,
    toolbarBody: null,
    minimize: null,
    confirm: null,
    skip: null,
    cancel: null
  };
}

function paintPickOverlay(target) {
  if (!(target instanceof Element) || !(picker.ui.overlay instanceof HTMLElement)) {
    return;
  }
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    picker.ui.overlay.style.width = "0";
    picker.ui.overlay.style.height = "0";
    return;
  }
  picker.ui.overlay.style.transform = `translate(${Math.max(0, rect.left)}px, ${Math.max(0, rect.top)}px)`;
  picker.ui.overlay.style.width = `${Math.max(0, rect.width)}px`;
  picker.ui.overlay.style.height = `${Math.max(0, rect.height)}px`;
}

function updatePickBubble(target, meta) {
  if (!(target instanceof Element) || !(picker.ui.bubble instanceof HTMLElement) || !(picker.ui.bubbleText instanceof HTMLElement)) {
    return;
  }
  const rect = target.getBoundingClientRect();
  const y = rect.top - 12;
  const x = rect.left;
  const bubbleRectWidth = 280;
  const margin = 8;
  const left = Math.max(margin, Math.min(window.innerWidth - bubbleRectWidth - margin, x));
  const top = y > 54 ? y : rect.bottom + 10;
  const primary = meta?.primary?.value || "unknown";
  const selectorPreview = normalizeInlineText(primary, 80);
  picker.ui.bubbleText.innerHTML = `<strong>${meta?.hint || "<element>"}</strong><br/>${selectorPreview}`;
  picker.ui.bubble.style.transform = `translate(${left}px, ${Math.max(6, top)}px)`;
}

function clearPickState() {
  picker.hoverTarget = null;
  picker.lockedTarget = null;
  picker.hoverMeta = null;
  if (picker.ui.overlay instanceof HTMLElement) {
    picker.ui.overlay.style.width = "0";
    picker.ui.overlay.style.height = "0";
  }
  if (picker.ui.bubble instanceof HTMLElement) {
    picker.ui.bubble.style.transform = "translate(-9999px,-9999px)";
  }
  updatePickerToolbar(null);
}

function setPickerState(nextState) {
  picker.state = nextState;
  if (!(picker.ui.status instanceof HTMLElement)) {
    return;
  }
  picker.ui.status.className = "rpa-pill";
  if (nextState === PICKER_STATES.INSPECTING) {
    picker.ui.status.classList.add("status-inspecting");
    picker.ui.status.textContent = "检查中";
  } else if (nextState === PICKER_STATES.LOCKED) {
    picker.ui.status.classList.add("status-locked");
    picker.ui.status.textContent = "已锁定";
  } else if (nextState === PICKER_STATES.PICKED) {
    picker.ui.status.classList.add("status-picked");
    picker.ui.status.textContent = "已完成";
  } else {
    picker.ui.status.textContent = "空闲";
  }
}

function updatePickerToolbar(meta, stage = "hover") {
  if (!(picker.ui.frame instanceof HTMLElement)) {
    return;
  }
  const framePath = meta?.framePathString || "top";
  const confidence = Number.isFinite(meta?.confidence) ? meta.confidence : 0;
  const fallbackCount = Array.isArray(meta?.fallbackSelectors) ? meta.fallbackSelectors.length : 0;
  const fallbackMessage = meta?.fallbackUsed ? `回退: ${fallbackCount} 条候选` : "回退: 待命";
  let hint = "悬停检查，点击锁定后点“确认”。";
  if (stage === "locked") {
    hint = "元素已锁定，可“确认”或“解锁”继续选择。";
  } else if (stage === "picked") {
    hint = "元素拾取成功。";
  } else if (stage === "error") {
    hint = typeof meta?.error === "string" && meta.error.trim() ? meta.error.trim() : "拾取器发生错误。";
  }
  if (typeof meta?.hintMessage === "string" && meta.hintMessage.trim()) {
    hint = meta.hintMessage.trim();
  }

  picker.ui.frame.textContent = `框架: ${framePath}`;
  if (picker.ui.confidence instanceof HTMLElement) {
    picker.ui.confidence.textContent = `置信度: ${(confidence * 100).toFixed(0)}%`;
  }
  if (picker.ui.fallback instanceof HTMLElement) {
    picker.ui.fallback.textContent = fallbackMessage;
  }
  if (picker.ui.hint instanceof HTMLElement) {
    picker.ui.hint.textContent = hint;
  }
}
function stopEvent(event) {
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
}

function isPickerUiElement(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target.closest(`[${PICKER_UI_ATTR}]`)) {
    return true;
  }
  const rootNode = target.getRootNode();
  return rootNode === picker.ui.shadow;
}

function isFrameElement(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  return tag === "iframe" || tag === "frame";
}

function isInspectableFrameElement(target) {
  if (!(target instanceof HTMLIFrameElement || target instanceof HTMLFrameElement)) {
    return false;
  }
  try {
    const childWindow = target.contentWindow;
    if (!childWindow) {
      return false;
    }
    void childWindow.document;
    return true;
  } catch {
    return false;
  }
}

function normalizePickTargetCandidate(target) {
  if (!(target instanceof Element)) {
    return null;
  }
  if (isPickerUiElement(target)) {
    return null;
  }
  if (isFrameElement(target)) {
    return null;
  }
  const tag = target.tagName.toLowerCase();
  if (["html", "body", "script", "style", "meta", "link", "noscript"].includes(tag)) {
    return null;
  }
  return target;
}

function countSimilarSiblings(target) {
  if (!(target instanceof Element) || !(target.parentElement instanceof Element)) {
    return 0;
  }
  const parent = target.parentElement;
  const tag = target.tagName.toLowerCase();
  const role = safeAttribute(target, "role") || "";
  const sign = safeAttribute(target, "sign") || "";
  let count = 0;
  for (const sibling of Array.from(parent.children || [])) {
    if (!(sibling instanceof Element)) {
      continue;
    }
    if (sibling.tagName.toLowerCase() !== tag) {
      continue;
    }
    if (role && safeAttribute(sibling, "role") !== role) {
      continue;
    }
    if (sign && safeAttribute(sibling, "sign") !== sign) {
      continue;
    }
    count += 1;
  }
  return count;
}

function isInteractiveTagName(tag) {
  return ["button", "a", "input", "textarea", "select", "option", "label"].includes(tag);
}

function isTextEntryInputType(type) {
  const normalized = String(type || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return [
    "text",
    "search",
    "email",
    "password",
    "tel",
    "url",
    "number",
    "date",
    "datetime-local",
    "month",
    "time",
    "week"
  ].includes(normalized);
}

function isTextEntryElement(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  if (tag === "textarea") {
    return true;
  }
  if (tag === "input") {
    const inputType = safeAttribute(target, "type") || "text";
    if (String(inputType).trim().toLowerCase() === "hidden") {
      return false;
    }
    return isTextEntryInputType(inputType);
  }
  if (target.isContentEditable) {
    return true;
  }
  const role = (safeAttribute(target, "role") || "").toLowerCase();
  return role === "textbox" || role === "searchbox" || role === "combobox";
}

function hasInteractiveDescendant(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(
    target.querySelector(
      'input:not([type="hidden"]),textarea,select,button,[contenteditable=""],[contenteditable="true"],[role="textbox"],[role="searchbox"],[role="combobox"]'
    )
  );
}

function resolvePointerCoordinates(pointer) {
  if (!pointer || typeof pointer !== "object") {
    return null;
  }
  const x = Number(pointer.clientX);
  const y = Number(pointer.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

function pointInRect(point, rect) {
  if (!point) {
    return false;
  }
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function findDescendantPickTarget(container, pointer = null) {
  if (!(container instanceof Element)) {
    return null;
  }
  const descendants = Array.from(
    container.querySelectorAll(
      'input:not([type="hidden"]),textarea,select,[contenteditable=""],[contenteditable="true"],[role="textbox"],[role="searchbox"],[role="combobox"]'
    )
  ).slice(0, 48);
  if (descendants.length === 0) {
    return null;
  }

  let best = null;
  let bestScore = -Infinity;
  for (const element of descendants) {
    const candidate = normalizePickTargetCandidate(element);
    if (!(candidate instanceof Element)) {
      continue;
    }
    const rect = candidate.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }
    let score = scorePickTargetCandidate(candidate) + 0.2;
    if (isTextEntryElement(candidate)) {
      score += 0.28;
    }
    if (pointInRect(pointer, rect)) {
      score += 0.42;
    } else if (pointer) {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distance = Math.hypot(pointer.x - centerX, pointer.y - centerY);
      score -= Math.min(0.42, distance / 900);
    }
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function scorePickTargetCandidate(target) {
  const candidate = normalizePickTargetCandidate(target);
  if (!(candidate instanceof Element)) {
    return -Infinity;
  }
  const selectorRules = getPickerRules().selector || DEFAULT_SELECTOR_PICKER_RULES;
  const preferredAttributes = Array.isArray(selectorRules.preferredAttributes)
    ? selectorRules.preferredAttributes
    : [];
  const maxStableTextLength = clampInteger(
    selectorRules.maxStableTextLength,
    DEFAULT_SELECTOR_PICKER_RULES.maxStableTextLength,
    24,
    280
  );
  const maxTextTokenCount = clampInteger(
    selectorRules.maxTextTokenCount,
    DEFAULT_SELECTOR_PICKER_RULES.maxTextTokenCount,
    3,
    24
  );
  const tag = candidate.tagName.toLowerCase();
  const role = safeAttribute(candidate, "role") || inferRoleFromTag(candidate);
  let score = 0;

  if (isInteractiveTagName(tag)) {
    score += 0.22;
  }
  if (isTextEntryElement(candidate)) {
    score += 0.38;
  }
  if (role) {
    score += 0.16;
  }

  const id = String(candidate.id || "").trim();
  if (id) {
    score += isLikelyDynamicToken(id) ? -0.22 : 0.16;
  }

  for (const attr of preferredAttributes) {
    const attrName = String(attr || "").trim().toLowerCase();
    if (!attrName || !isValidAttributeName(attrName)) {
      continue;
    }
    const value = String(safeAttribute(candidate, attrName) || "").trim();
    if (!value) {
      continue;
    }
    if (isLikelyDynamicToken(value)) {
      score -= 0.08;
      continue;
    }
    if (attrName === "sign" || attrName.startsWith("data-")) {
      score += 0.18;
    } else {
      score += 0.08;
    }
  }

  const text = normalizeInlineText(candidate.textContent || "", maxStableTextLength + 60);
  const textTokenCount = countTextTokens(text);
  if (!text) {
    score -= 0.05;
  } else if (text.length <= maxStableTextLength) {
    score += 0.06;
  } else {
    score -= 0.12;
  }
  if (textTokenCount > maxTextTokenCount) {
    score -= 0.08;
  }
  if (isLikelyDynamicText(text)) {
    score -= 0.16;
  }

  const childCount = Number(candidate.childElementCount || 0);
  if (childCount > 80) {
    score -= 0.2;
  } else if (childCount > 24) {
    score -= 0.12;
  }
  if (!isInteractiveTagName(tag) && !isTextEntryElement(candidate) && hasInteractiveDescendant(candidate)) {
    score -= 0.22;
  }

  const similarSiblingCount = countSimilarSiblings(candidate);
  if (similarSiblingCount >= 2) {
    score += 0.12;
  }
  if (similarSiblingCount >= 4) {
    score += 0.06;
  }

  return score;
}

function resolvePickTarget(target, eventPath = null, pointer = null) {
  const direct = normalizePickTargetCandidate(target);
  let best = direct;
  let bestScore = scorePickTargetCandidate(direct);
  const pointerPos = resolvePointerCoordinates(pointer);

  const path = Array.isArray(eventPath) ? eventPath : [];
  for (const node of path) {
    if (!(node instanceof Element)) {
      continue;
    }
    const candidate = normalizePickTargetCandidate(node);
    if (!(candidate instanceof Element)) {
      continue;
    }
    const score = scorePickTargetCandidate(candidate);
    if (score > bestScore + 0.04) {
      best = candidate;
      bestScore = score;
    }
  }

  if (pointerPos && typeof document.elementsFromPoint === "function") {
    const stack = document.elementsFromPoint(pointerPos.x, pointerPos.y);
    for (const node of stack.slice(0, 16)) {
      const candidate = normalizePickTargetCandidate(node);
      if (!(candidate instanceof Element)) {
        continue;
      }
      let score = scorePickTargetCandidate(candidate);
      if (isTextEntryElement(candidate)) {
        score += 0.32;
      } else if (isInteractiveTagName(candidate.tagName.toLowerCase())) {
        score += 0.14;
      }
      if (score > bestScore + 0.02) {
        best = candidate;
        bestScore = score;
      }
    }
  }

  if (best instanceof Element && !isTextEntryElement(best)) {
    const descendant = findDescendantPickTarget(best, pointerPos);
    if (descendant instanceof Element) {
      const descendantScore = scorePickTargetCandidate(descendant) + (isTextEntryElement(descendant) ? 0.24 : 0.08);
      if (descendantScore >= bestScore - 0.02) {
        best = descendant;
        bestScore = descendantScore;
      }
    }
  }

  return best;
}

function buildFrameContainerHint(target) {
  const inspectable = isInspectableFrameElement(target);
  const currentFramePath = buildFramePathString(frameMeta());
  return {
    framePathString: currentFramePath,
    confidence: 0,
    fallbackUsed: false,
    fallbackSelectors: [],
    hintMessage: inspectable
      ? "检测到 iframe 容器，请把鼠标移入 iframe 内部后再选择元素。"
      : "该 iframe 可能跨域或受限，无法直接拾取内部元素。"
  };
}
function buildPickerElementMeta(target) {
  return {
    tag: target.tagName.toLowerCase(),
    id: target.id || "",
    classes: Array.from(target.classList || []).slice(0, 6),
    text: normalizeInlineText(target.textContent || "", 80),
    name: safeAttribute(target, "name") || "",
    role: safeAttribute(target, "role") || inferRoleFromTag(target) || ""
  };
}

function computeHoverMeta(target) {
  const legacyCandidates = buildSelectorCandidates(target);
  const playwrightCandidates = buildPlaywrightCandidates(target, legacyCandidates);
  const primary = playwrightCandidates[0] || legacyCandidates[0];
  const confidence = Number.isFinite(primary?.score) ? primary.score : 0;
  const fallbackSelectors = playwrightCandidates
    .slice(1, 5)
    .map(candidate => candidate.value)
    .filter(Boolean);
  const fallbackUsed = confidence < 0.76 && fallbackSelectors.length > 0;
  const frame = frameMeta();
  const frameLocatorChain = buildFrameLocatorChain(frame.segments);
  return {
    primary,
    candidates: playwrightCandidates,
    legacyCandidates,
    playwrightPrimary: primary || null,
    playwrightCandidates,
    confidence,
    fallbackSelectors,
    fallbackUsed,
    framePath: frame.segments,
    frameLocatorChain,
    framePathString: buildFramePathString(frame),
    hint: buildElementHint(target),
    selectorType: primary?.type || "css",
    elementMeta: buildPickerElementMeta(target)
  };
}

function buildPickPayload(target, meta) {
  const realMeta = meta || computeHoverMeta(target);
  const liveMeta = computeHoverMeta(target);
  const mergedMeta = {
    ...realMeta,
    ...liveMeta,
    // Keep existing fallback decision if present.
    fallbackUsed: typeof realMeta?.fallbackUsed === "boolean" ? realMeta.fallbackUsed : liveMeta.fallbackUsed,
    fallbackSelectors: Array.isArray(realMeta?.fallbackSelectors)
      ? realMeta.fallbackSelectors
      : liveMeta.fallbackSelectors
  };
  const selectorType = selectorTypeFromValue(mergedMeta?.primary?.value || "", mergedMeta?.selectorType || "css");
  const selectorCandidates = Array.isArray(mergedMeta?.candidates) ? mergedMeta.candidates : [];
  const legacySelectorCandidates = Array.isArray(mergedMeta?.legacyCandidates) ? mergedMeta.legacyCandidates : [];
  const playwrightCandidates = Array.isArray(mergedMeta?.playwrightCandidates)
    ? mergedMeta.playwrightCandidates
    : selectorCandidates;
  const incomingFramePath = Array.isArray(mergedMeta?.framePath)
    ? mergedMeta.framePath.map(item => ({ ...item }))
    : [];
  const effectiveFramePath = mergeFramePathWithPrefix(incomingFramePath, picker.framePathPrefix);
  const frameLocatorChain = effectiveFramePath.length > 0
    ? buildFrameLocatorChain(effectiveFramePath)
    : Array.isArray(mergedMeta?.frameLocatorChain)
      ? mergedMeta.frameLocatorChain.map(item => ({
        ...item,
        selectorCandidates: Array.isArray(item?.selectorCandidates)
          ? item.selectorCandidates.map(candidate => ({ ...candidate }))
          : []
      }))
      : [];
  const effectiveFramePathString = buildFramePathString({ segments: effectiveFramePath });
  const playwrightPrimary =
    mergedMeta?.playwrightPrimary && typeof mergedMeta.playwrightPrimary === "object"
      ? { ...mergedMeta.playwrightPrimary }
      : playwrightCandidates[0]
        ? { ...playwrightCandidates[0] }
        : null;
  return {
    payload: {
      selector: mergedMeta?.primary?.value || "",
      selectorType,
      selectorCandidates,
      legacySelectorCandidates,
      playwrightPrimary,
      playwrightCandidates,
      framePath: effectiveFramePath,
      frameLocatorChain,
      framePathString: effectiveFramePathString,
      elementMeta: mergedMeta?.elementMeta || buildPickerElementMeta(target),
      pageUrl: location.href,
      pageTitle: document.title || "",
      pickerVersion: PICKER_VERSION
    },
    pickerMeta: {
      state: PICKER_STATES.PICKED,
      selectorType,
      confidence: mergedMeta?.confidence || 0,
      fallbackUsed: Boolean(mergedMeta?.fallbackUsed),
      fallbackSelectors: mergedMeta?.fallbackSelectors || [],
      framePathString: effectiveFramePathString,
      framePath: effectiveFramePath,
      frameLocatorChain,
      playwrightPrimary,
      playwrightCandidates,
      hint: mergedMeta?.hint || buildElementHint(target),
      sourceUrl: location.href,
      pickerVersion: PICKER_VERSION
    }
  };
}

function normalizePickResultPayload(payload, pickerMeta, sourceWindow = null) {
  const safePayload = payload && typeof payload === "object" ? { ...payload } : {};
  const safeMeta = pickerMeta && typeof pickerMeta === "object" ? { ...pickerMeta } : {};
  const sourcePath =
    window === window.top && sourceWindow && sourceWindow !== window
      ? resolveFramePathByWindowRef(sourceWindow)
      : [];
  const payloadPath = cloneFramePath(safePayload.framePath);
  const metaPath = cloneFramePath(safeMeta.framePath);

  let effectiveFramePath = payloadPath.length > 0 ? payloadPath : metaPath;
  if (sourcePath.length > 0) {
    effectiveFramePath = mergeFramePathWithPrefix(effectiveFramePath, sourcePath);
  }
  if (effectiveFramePath.length === 0 && sourcePath.length > 0) {
    effectiveFramePath = cloneFramePath(sourcePath);
  }

  const fallbackFrameLocatorChain = Array.isArray(safePayload.frameLocatorChain)
    ? safePayload.frameLocatorChain
    : Array.isArray(safeMeta.frameLocatorChain)
      ? safeMeta.frameLocatorChain
      : [];
  const frameLocatorChain = effectiveFramePath.length > 0
    ? buildFrameLocatorChain(effectiveFramePath)
    : fallbackFrameLocatorChain;
  const framePathString = buildFramePathString({ segments: effectiveFramePath });

  return {
    payload: {
      ...safePayload,
      ...(effectiveFramePath.length > 0 ? { framePath: effectiveFramePath } : {}),
      ...(Array.isArray(frameLocatorChain) ? { frameLocatorChain } : {}),
      framePathString
    },
    pickerMeta: {
      ...safeMeta,
      ...(effectiveFramePath.length > 0 ? { framePath: effectiveFramePath } : {}),
      ...(Array.isArray(frameLocatorChain) ? { frameLocatorChain } : {}),
      framePathString
    }
  };
}

function submitPickedResult(payload, pickerMeta, sourceWindow = null) {
  const normalized = normalizePickResultPayload(payload, pickerMeta, sourceWindow);
  chrome.runtime.sendMessage(
    {
      type: "RECORDER_PICKED",
      payload: normalized.payload,
      pickerMeta: normalized.pickerMeta,
      nativeSessionId: picker.nativeSessionId
    },
    response => {
      const error = chrome.runtime.lastError;
      if (error) {
        console.debug("send picked element failed:", error.message);
        notifyPickError(`拾取结果发送失败：${error.message}`, "error");
        return;
      }
      if (!response || response.ok !== true) {
        const errorMessage =
          typeof response?.error === "string" && response.error.trim()
            ? response.error.trim()
            : "后台未接受拾取结果，请重试。";
        console.debug("send picked element rejected:", errorMessage, response);
        setPickerState(PICKER_STATES.LOCKED);
        updatePickerToolbar({ error: errorMessage }, "error");
        return;
      }
      console.debug("[rpa-picker] pick result accepted by background", {
        selector: normalized.payload?.selector || "",
        selectorType: normalized.payload?.selectorType || "",
        framePathString: normalized.payload?.framePathString || ""
      });
      postToPage("RECORDER_PICK_RESULT", {
        payload: normalized.payload,
        pickerMeta: normalized.pickerMeta
      });
      stopPickMode("success", "", { broadcast: true });
      if (window !== window.top) {
        syncPickStateToTop("picked", normalized.pickerMeta);
      }
    }
  );
}

function requestPickConfirm(trigger = "unknown") {
  console.debug("[rpa-picker] confirm requested", {
    trigger,
    state: picker.state,
    hasLockedTarget: picker.lockedTarget instanceof Element,
    hasHoverTarget: picker.hoverTarget instanceof Element
  });
  if (window === window.top && activePickFrame && activePickFrame !== window) {
    const derivedPrefix = resolveFramePathByWindowRef(activePickFrame);
    const hoverPrefix = cloneFramePath(picker.hoverMeta?.framePath);
    const framePathPrefix = derivedPrefix.length > 0 ? derivedPrefix : hoverPrefix;
    postMessageSafe(activePickFrame, {
      source: RECORDER_SOURCE,
      type: "RPA_PICK_CMD_CONFIRM",
      framePathPrefix
    });
    return;
  }
  confirmPick();
}

function lockPickTarget(target) {
  picker.lockedTarget = target;
  picker.hoverTarget = target;
  picker.hoverMeta = computeHoverMeta(target);
  paintPickOverlay(target);
  updatePickBubble(target, picker.hoverMeta);
  setPickerState(PICKER_STATES.LOCKED);
  updatePickerToolbar(picker.hoverMeta, "locked");

  if (window === window.top) {
    lockActiveFrame(window);
  }
  syncPickStateToTop("locked", picker.hoverMeta);
}

function unlockPick() {
  picker.lockedTarget = null;
  setPickerState(PICKER_STATES.INSPECTING);
  updatePickerToolbar(picker.hoverMeta, "hover");
  if (window === window.top) {
    releaseActiveFrameLock();
    activePickFrame = window;
  }
  syncPickStateToTop("unlocked", picker.hoverMeta);
}

function confirmPick() {
  const target = picker.lockedTarget || picker.hoverTarget;
  if (!(target instanceof Element)) {
    updatePickerToolbar({ error: "未选择元素，请先悬停并点击一个元素。" }, "error");
    return;
  }
  const { payload, pickerMeta } = buildPickPayload(target, picker.hoverMeta);
  console.debug("[rpa-picker] confirming target", {
    selector: payload?.selector || "",
    selectorType: payload?.selectorType || "",
    framePathString: payload?.framePathString || ""
  });
  setPickerState(PICKER_STATES.PICKED);
  updatePickerToolbar(pickerMeta || picker.hoverMeta, "picked");
  if (window !== window.top) {
    postMessageSafe(window.top, {
      source: RECORDER_SOURCE,
      type: "RPA_PICK_RESULT_DRAFT",
      payload,
      pickerMeta
    });
    stopPickMode("success", "", { broadcast: false });
    return;
  }
  submitPickedResult(payload, pickerMeta, window);
}

function stopPickMode(stage = "cancelled", message = "", options = {}) {
  const broadcast = options?.broadcast !== false;
  const currentPrefix = cloneFramePath(picker.framePathPrefix);
  const currentNativeSessionId = picker.nativeSessionId;
  if (broadcast) {
    dispatchPickModeToChildFrames(false, currentPrefix, currentNativeSessionId);
  }
  if (!picker.enabled) {
    picker.nativeSessionId = null;
    picker.framePathPrefix = [];
    return;
  }
  if (picker.listeners.mousemove) {
    document.removeEventListener("mousemove", picker.listeners.mousemove, true);
    picker.listeners.mousemove = null;
  }
  if (picker.listeners.click) {
    document.removeEventListener("click", picker.listeners.click, true);
    picker.listeners.click = null;
  }
  if (picker.listeners.keydown) {
    document.removeEventListener("keydown", picker.listeners.keydown, true);
    picker.listeners.keydown = null;
  }
  if (picker.listeners.scroll) {
    window.removeEventListener("scroll", picker.listeners.scroll, true);
    picker.listeners.scroll = null;
  }
  if (picker.listeners.resize) {
    window.removeEventListener("resize", picker.listeners.resize, true);
    picker.listeners.resize = null;
  }
  if (picker.listeners.toolbarPointerMove) {
    window.removeEventListener("pointermove", picker.listeners.toolbarPointerMove, true);
    picker.listeners.toolbarPointerMove = null;
  }
  if (picker.listeners.toolbarPointerUp) {
    window.removeEventListener("pointerup", picker.listeners.toolbarPointerUp, true);
    window.removeEventListener("pointercancel", picker.listeners.toolbarPointerUp, true);
    picker.listeners.toolbarPointerUp = null;
  }
  stopToolbarDrag();
  picker.enabled = false;
  picker.nativeSessionId = null;
  picker.framePathPrefix = [];
  picker.state = stage === "success" ? PICKER_STATES.PICKED : PICKER_STATES.CANCELLED;
  if (window === window.top) {
    releaseActiveFrameLock();
    activePickFrame = null;
  }
  clearPickState();
  hidePickUi();
  if (stage === "error" && message) {
    postToPage("RECORDER_PICKER_ERROR", { error: message, stage });
  }
}

function notifyPickError(message, stage = "error") {
  chrome.runtime.sendMessage(
    {
      type: "RECORDER_PICK_CANCELED",
      error: message,
      stage,
      nativeSessionId: picker.nativeSessionId
    },
    () => {
      const error = chrome.runtime.lastError;
      if (error) {
        console.debug("notify picker cancel failed:", error.message);
      }
    }
  );
  const nextStage = stage === "cancelled" ? "cancelled" : "error";
  stopPickMode(nextStage, message, { broadcast: true });
}

function onPickMouseMove(event) {
  if (!picker.enabled) {
    return;
  }
  if (picker.state === PICKER_STATES.LOCKED) {
    return;
  }
  if (window === window.top && activePickFrame && activePickFrame !== window) {
    return;
  }
  const frameTarget = isFrameElement(event.target) ? event.target : null;
  const eventPath = typeof event.composedPath === "function" ? event.composedPath() : [];
  const target = resolvePickTarget(event.target, eventPath, event);
  if (!(target instanceof Element)) {
    if (frameTarget) {
      picker.hoverTarget = null;
      picker.hoverMeta = null;
      if (picker.ui.overlay instanceof HTMLElement) {
        picker.ui.overlay.style.width = "0";
        picker.ui.overlay.style.height = "0";
      }
      const hintMeta = buildFrameContainerHint(frameTarget);
      updatePickerToolbar(hintMeta, "hover");
      syncPickStateToTop("hover", hintMeta);
    }
    return;
  }
  picker.hoverTarget = target;
  picker.hoverMeta = computeHoverMeta(target);
  paintPickOverlay(target);
  updatePickBubble(target, picker.hoverMeta);

  if (window === window.top) {
    activePickFrame = window;
  }

  if (picker.state !== PICKER_STATES.LOCKED) {
    setPickerState(PICKER_STATES.INSPECTING);
    updatePickerToolbar(picker.hoverMeta, "hover");
    syncPickStateToTop("hover", picker.hoverMeta);
  }
}

function onPickClick(event) {
  if (!picker.enabled) {
    return;
  }
  if (isPickerUiElement(event.target)) {
    return;
  }
  if (picker.state === PICKER_STATES.LOCKED) {
    stopEvent(event);
    return;
  }
  if (window === window.top && activePickFrame && activePickFrame !== window) {
    stopEvent(event);
    return;
  }
  if (isFrameElement(event.target)) {
    stopEvent(event);
    picker.hoverTarget = null;
    picker.hoverMeta = null;
    const hintMeta = buildFrameContainerHint(event.target);
    updatePickerToolbar(hintMeta, "hover");
    syncPickStateToTop("hover", hintMeta);
    return;
  }
  const eventPath = typeof event.composedPath === "function" ? event.composedPath() : [];
  const target = resolvePickTarget(event.target, eventPath, event) || picker.hoverTarget;
  if (!(target instanceof Element)) {
    stopEvent(event);
    updatePickerToolbar({ error: "未命中可选择元素，请重试。" }, "error");
    return;
  }
  stopEvent(event);
  lockPickTarget(target);
}

function onPickKeydown(event) {
  if (!picker.enabled) {
    return;
  }
  if (event.key === "Escape") {
    stopEvent(event);
    notifyPickError("元素拾取已取消。", "cancelled");
    return;
  }
  if (event.key === "Enter" && picker.state === PICKER_STATES.LOCKED) {
    stopEvent(event);
    requestPickConfirm("keyboard_enter");
  }
}

function repaintPicker() {
  const target = picker.lockedTarget || picker.hoverTarget;
  if (!(target instanceof Element)) {
    return;
  }
  paintPickOverlay(target);
  if (picker.hoverMeta) {
    updatePickBubble(target, picker.hoverMeta);
    updatePickerToolbar(picker.hoverMeta, picker.state === PICKER_STATES.LOCKED ? "locked" : "hover");
  }
  applyToolbarPosition();
}

function startPickMode(options = {}) {
  void ensurePickerRulesLoaded();
  const incomingNativeSessionId =
    typeof options?.nativeSessionId === "string" && options.nativeSessionId.trim()
      ? options.nativeSessionId.trim()
      : null;
  picker.nativeSessionId = incomingNativeSessionId;
  const incomingPrefix = cloneFramePath(options?.framePathPrefix);
  if (incomingPrefix.length > 0) {
    picker.framePathPrefix = incomingPrefix;
  } else if (window === window.top) {
    picker.framePathPrefix = [];
  }

  const broadcast = options?.broadcast !== false;
  if (broadcast) {
    dispatchPickModeToChildFrames(true, picker.framePathPrefix, picker.nativeSessionId);
  }
  if (picker.enabled) {
    updatePickerToolbar(
      { framePathString: buildFramePathString(frameMeta()), confidence: 0, fallbackUsed: false },
      picker.state === PICKER_STATES.LOCKED ? "locked" : "hover"
    );
    return;
  }
  picker.enabled = true;
  setPickerState(PICKER_STATES.INSPECTING);
  if (window === window.top) {
    activePickFrame = window;
    releaseActiveFrameLock();
  }
  ensurePickUi();
  updatePickerToolbar({ framePathString: buildFramePathString(frameMeta()), confidence: 0, fallbackUsed: false }, "hover");

  picker.listeners.mousemove = onPickMouseMove;
  picker.listeners.click = onPickClick;
  picker.listeners.keydown = onPickKeydown;
  picker.listeners.scroll = repaintPicker;
  picker.listeners.resize = repaintPicker;

  document.addEventListener("mousemove", picker.listeners.mousemove, true);
  document.addEventListener("click", picker.listeners.click, true);
  document.addEventListener("keydown", picker.listeners.keydown, true);
  window.addEventListener("scroll", picker.listeners.scroll, true);
  window.addEventListener("resize", picker.listeners.resize, true);
}
function startRecording() {
  if (isRecording) {
    return;
  }
  clickListener = onClick;
  inputListener = onInput;
  selectListener = onSelect;
  document.addEventListener("click", clickListener, true);
  document.addEventListener("input", inputListener, true);
  document.addEventListener("change", selectListener, true);
  isRecording = true;
  sendNavigateSnapshot();
}

function stopRecording() {
  if (!isRecording) {
    return;
  }
  if (clickListener) {
    document.removeEventListener("click", clickListener, true);
    clickListener = null;
  }
  if (inputListener) {
    document.removeEventListener("input", inputListener, true);
    inputListener = null;
  }
  if (selectListener) {
    document.removeEventListener("change", selectListener, true);
    selectListener = null;
  }
  isRecording = false;
}

window.addEventListener("message", event => {
  if (event.source !== window) {
    return;
  }
  const data = event.data;
  if (!data || data.source !== DESIGNER_SOURCE || typeof data.type !== "string") {
    return;
  }

  if (data.type === "RECORDER_PULL_LATEST") {
    chrome.runtime.sendMessage({ type: "RECORDER_PULL_LATEST_FOR_PAGE" }, response => {
      const error = chrome.runtime.lastError;
      if (error) {
        postToPage("RECORDER_PICKER_ERROR", { error: `Pull recorder payload failed: ${error.message}` });
        return;
      }
      if (!response?.ok) {
        postToPage("RECORDER_PICKER_ERROR", {
          error: response?.error || "Pull recorder payload failed: extension returned no data."
        });
        return;
      }
      postToPage("RECORDER_EXPORT_PAYLOAD", { payload: response.payload });
    });
    return;
  }

  if (data.type === "RECORDER_PICKER_START") {
    const nodeId =
      typeof data.payload?.nodeId === "string"
        ? data.payload.nodeId.trim()
        : typeof data.nodeId === "string"
          ? data.nodeId.trim()
          : "";
    const url =
      typeof data.payload?.url === "string"
        ? data.payload.url.trim()
        : typeof data.url === "string"
          ? data.url.trim()
          : "";

    if (!/^https?:\/\//i.test(url)) {
      postToPage("RECORDER_PICKER_ERROR", { error: "Start page picker failed: url must start with http:// or https://" });
      return;
    }

    try {
      chrome.runtime.sendMessage(
        {
          type: "RECORDER_PICKER_START",
          payload: {
            url,
            ...(nodeId ? { nodeId } : {})
          }
        },
        response => {
          const error = chrome.runtime.lastError;
          if (error) {
            postToPage("RECORDER_PICKER_ERROR", { error: `Start page picker failed: ${error.message}` });
            return;
          }
          if (!response?.ok) {
            const suffix =
              response && typeof response.received === "object"
                ? ` (received=${JSON.stringify(response.received)})`
                : "";
            postToPage("RECORDER_PICKER_ERROR", {
              error: `${response?.error || "Start page picker failed."}${suffix}`
            });
          }
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      postToPage("RECORDER_PICKER_ERROR", { error: `Start page picker failed: ${message}` });
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "RECORDER_TOGGLE") {
    if (message.enabled) {
      startRecording();
    } else {
      stopRecording();
    }
    sendResponse({ ok: true, recording: isRecording });
    return true;
  }

  if (message?.type === "RECORDER_PICK_MODE") {
    if (message.enabled) {
      startPickMode({ nativeSessionId: message.nativeSessionId });
    } else {
      stopPickMode("cancelled");
    }
    sendResponse({ ok: true, pickModeEnabled: picker.enabled, pickerState: picker.state });
    return true;
  }

  if (message?.type === "RECORDER_PUSH_TO_PAGE") {
    postToPage("RECORDER_EXPORT_PAYLOAD", { payload: message.payload });
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "RECORDER_PUSH_PICK_RESULT") {
    postToPage("RECORDER_PICK_RESULT", {
      payload: message.payload,
      pickerMeta: message.pickerMeta,
      targetNodeId: message.targetNodeId
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "RECORDER_PUSH_PICK_ERROR") {
    postToPage("RECORDER_PICKER_ERROR", { error: message.error || "Page picker failed.", stage: message.stage });
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

chrome.runtime.sendMessage({ type: "RECORDER_PICKER_STATUS" }, response => {
  const error = chrome.runtime.lastError;
  if (error) {
    return;
  }
  if (response?.ok && response.enabled) {
    startPickMode({ nativeSessionId: response.nativeSessionId });
  }
});

window.addEventListener("message", event => {
  const data = event.data;
  if (!data || data.source !== RECORDER_SOURCE) {
    return;
  }

  if (data.type === "RPA_PICK_SYNC" && window === window.top) {
    const syncMeta = normalizeSyncMeta(data.meta, event.source);
    picker.hoverMeta = syncMeta;
    if (data.stage === "locked") {
      if (!shouldIgnoreFrameSwitch(event.source)) {
        lockActiveFrame(event.source);
      }
      setPickerState(PICKER_STATES.LOCKED);
    } else if (data.stage === "unlocked") {
      if (!activePickFrame || event.source === activePickFrame) {
        releaseActiveFrameLock();
        activePickFrame = event.source;
      }
      setPickerState(PICKER_STATES.INSPECTING);
    } else if (data.stage === "hover") {
      if (!shouldIgnoreFrameSwitch(event.source)) {
        activePickFrame = event.source;
      }
      setPickerState(PICKER_STATES.INSPECTING);
    } else if (data.stage === "picked") {
      setPickerState(PICKER_STATES.PICKED);
      if (!shouldIgnoreFrameSwitch(event.source)) {
        activePickFrame = event.source;
      }
    }
    updatePickerToolbar(syncMeta, data.stage);
    return;
  }

  if (data.type === "RPA_PICK_RESULT_DRAFT" && window === window.top) {
    const normalized = normalizePickResultPayload(data.payload, data.pickerMeta, event.source);
    picker.hoverMeta =
      normalized.pickerMeta && typeof normalized.pickerMeta === "object"
        ? { ...(normalized.pickerMeta) }
        : picker.hoverMeta;
    setPickerState(PICKER_STATES.PICKED);
    updatePickerToolbar(picker.hoverMeta, "picked");
    submitPickedResult(normalized.payload, normalized.pickerMeta, event.source);
    return;
  }

  if (data.type === "RPA_PICK_CMD_TOGGLE") {
    if (data.enabled) {
      startPickMode({
        broadcast: true,
        framePathPrefix: cloneFramePath(data.framePathPrefix),
        nativeSessionId:
          typeof data.nativeSessionId === "string" && data.nativeSessionId.trim()
            ? data.nativeSessionId.trim()
            : null
      });
    } else {
      stopPickMode("cancelled", "", { broadcast: true });
    }
    return;
  }

  if (data.type === "RPA_PICK_CMD_CONFIRM") {
    const commandPrefix = cloneFramePath(data.framePathPrefix);
    if (commandPrefix.length > 0) {
      picker.framePathPrefix = mergeFramePathWithPrefix(picker.framePathPrefix, commandPrefix);
    }
    if (picker.lockedTarget || picker.hoverTarget) {
      confirmPick();
    }
    return;
  }
  if (data.type === "RPA_PICK_CMD_UNLOCK") {
    const commandPrefix = cloneFramePath(data.framePathPrefix);
    if (commandPrefix.length > 0) {
      picker.framePathPrefix = mergeFramePathWithPrefix(picker.framePathPrefix, commandPrefix);
    }
    if (picker.lockedTarget) {
      unlockPick();
    }
    return;
  }
});


