const RECORDER_SCHEMA_VERSION = "1.0.0";
const RECORDER_SOURCE = "rpa-flow-recorder";

const NATIVE_PICKER_SCHEMA_VERSION = "native-picker.v1";
const NATIVE_PICKER_HOST_NAME = "com.rpaflow.desktop.picker";
const NATIVE_PICKER_POLL_MS = 280;
const NATIVE_PICKER_ALARM_NAME = "rpa_native_picker_poll";
const NATIVE_PICKER_ALARM_DELAY_MS = 1200;
const NATIVE_PICKER_ACK_TIMEOUT_MS = 4000;
const NATIVE_PICKER_DEFAULT_PORT = 18080;
const NATIVE_PICKER_PORT_SCAN_STEPS = 40;
const NATIVE_PICKER_MAX_SESSION_CANDIDATES = 20;
const NATIVE_PICKER_MAX_ARM_RETRIES = 10;

const recorderStateByTab = new Map();
const recorderEventsByTab = new Map();
let lastRecorderTabId = null;
let pickerSession = null;

const nativePickerState = {
  apiBase: null,
  apiPort: null,
  pollTimer: null,
  pollInFlight: false,
  sessionById: new Map(),
  sessionIdByTab: new Map(),
  completedSessionIds: new Set(),
  pendingAcksByRequestId: new Map(),
  requestCounter: 0,
  nativePort: null
};

function ensureTabState(tabId) {
  if (!recorderStateByTab.has(tabId)) {
    recorderStateByTab.set(tabId, { recording: false });
  }
  if (!recorderEventsByTab.has(tabId)) {
    recorderEventsByTab.set(tabId, []);
  }
}

function toIso() {
  return new Date().toISOString();
}

function addEvent(tabId, event) {
  ensureTabState(tabId);
  lastRecorderTabId = tabId;
  const list = recorderEventsByTab.get(tabId);
  list.push(event);
  if (list.length > 1200) {
    list.splice(0, list.length - 1200);
  }
}

function buildPayload(tabId) {
  if (typeof tabId !== "number") {
    return {
      source: RECORDER_SOURCE,
      schemaVersion: RECORDER_SCHEMA_VERSION,
      tabId: null,
      exportedAt: toIso(),
      recording: false,
      events: []
    };
  }
  ensureTabState(tabId);
  return {
    source: RECORDER_SOURCE,
    schemaVersion: RECORDER_SCHEMA_VERSION,
    tabId,
    exportedAt: toIso(),
    recording: recorderStateByTab.get(tabId).recording,
    events: recorderEventsByTab.get(tabId)
  };
}

function findLatestTabId() {
  if (typeof lastRecorderTabId === "number" && recorderEventsByTab.has(lastRecorderTabId)) {
    return lastRecorderTabId;
  }
  let selectedTabId = null;
  let maxCount = -1;
  for (const [tabId, events] of recorderEventsByTab.entries()) {
    if (events.length > maxCount) {
      selectedTabId = tabId;
      maxCount = events.length;
    }
  }
  return selectedTabId;
}

function sendToggleToTab(tabId, enabled) {
  chrome.tabs.sendMessage(tabId, { type: "RECORDER_TOGGLE", enabled }, () => {
    const error = chrome.runtime.lastError;
    if (error) {
      console.debug("content script toggle failed:", error.message);
    }
  });
}

function sendPayloadToTabPage(targetTabId, sourceTabId) {
  const payload = buildPayload(sourceTabId);
  chrome.tabs.sendMessage(
    targetTabId,
    { type: "RECORDER_PUSH_TO_PAGE", payload },
    response => {
      const error = chrome.runtime.lastError;
      if (error) {
        console.debug("push payload failed:", error.message);
      } else {
        console.debug("push payload response:", response);
      }
    }
  );
}

function sendPickerMode(tabId, enabled) {
  chrome.tabs.sendMessage(tabId, { type: "RECORDER_PICK_MODE", enabled }, () => {
    const error = chrome.runtime.lastError;
    if (error) {
      console.debug("toggle picker mode failed:", error.message);
    }
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, message, response => {
      const error = chrome.runtime.lastError;
      if (error) {
        resolve({ ok: false, error: error.message || "Unknown tab messaging error.", response: null });
        return;
      }
      resolve({ ok: true, error: "", response: response ?? null });
    });
  });
}

function shouldTryInjectContentScript(errorMessage) {
  const normalized = String(errorMessage || "").toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("receiving end does not exist") ||
    normalized.includes("could not establish connection") ||
    normalized.includes("no matching signature")
  );
}

function injectContentScript(tabId) {
  return new Promise(resolve => {
    try {
      chrome.scripting.executeScript(
        {
          target: { tabId, allFrames: true },
          files: ["content.js"]
        },
        () => {
          const error = chrome.runtime.lastError;
          if (error) {
            console.debug("inject content script failed:", error.message);
            resolve(false);
            return;
          }
          resolve(true);
        }
      );
    } catch (error) {
      console.debug("inject content script threw:", error);
      resolve(false);
    }
  });
}

function pushPickerResultToRequester(requesterTabId, payload, pickerMeta, targetNodeId = null) {
  const message = {
    type: "RECORDER_PUSH_PICK_RESULT",
    payload,
    pickerMeta
  };
  if (typeof targetNodeId === "string" && targetNodeId.trim()) {
    message.targetNodeId = targetNodeId.trim();
  }
  chrome.tabs.sendMessage(requesterTabId, message, () => {
    const error = chrome.runtime.lastError;
    if (error) {
      console.debug("push pick result failed:", error.message);
    }
  });
}

function pushPickerErrorToRequester(requesterTabId, errorMessage, stage = "error") {
  chrome.tabs.sendMessage(
    requesterTabId,
    { type: "RECORDER_PUSH_PICK_ERROR", error: errorMessage, stage },
    () => {
      const error = chrome.runtime.lastError;
      if (error) {
        console.debug("push pick error failed:", error.message);
      }
    }
  );
}

function clearPickerSession(errorMessage, stage = "error") {
  if (!pickerSession) {
    return;
  }
  const { requesterTabId, targetTabId } = pickerSession;
  sendPickerMode(targetTabId, false);
  if (errorMessage) {
    pushPickerErrorToRequester(requesterTabId, errorMessage, stage);
  }
  pickerSession = null;
}

function armPickerWhenReady(targetTabId, attempt = 0) {
  chrome.tabs.sendMessage(targetTabId, { type: "RECORDER_PICK_MODE", enabled: true }, () => {
    const error = chrome.runtime.lastError;
    if (!error) {
      return;
    }
    if (attempt >= 20) {
      console.debug("arm picker failed after retries:", error.message);
      clearPickerSession("Unable to start page picker on target page.");
      return;
    }
    setTimeout(() => {
      armPickerWhenReady(targetTabId, attempt + 1);
    }, 250);
  });
}

function isTerminalNativePickerStatus(status) {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "timeout";
}

function makeNativeRequestId() {
  nativePickerState.requestCounter += 1;
  return `np_req_${Date.now()}_${nativePickerState.requestCounter}`;
}

function ensureNativeHostPort() {
  if (nativePickerState.nativePort) {
    return nativePickerState.nativePort;
  }
  try {
    const port = chrome.runtime.connectNative(NATIVE_PICKER_HOST_NAME);
    nativePickerState.nativePort = port;
    port.onMessage.addListener(message => {
      const requestId = typeof message?.requestId === "string" ? message.requestId : "";
      if (!requestId) {
        return;
      }
      const pending = nativePickerState.pendingAcksByRequestId.get(requestId);
      if (!pending) {
        return;
      }
      nativePickerState.pendingAcksByRequestId.delete(requestId);
      clearTimeout(pending.timeout);
      pending.resolve(message);
    });
    port.onDisconnect.addListener(() => {
      const disconnectError = chrome.runtime.lastError;
      if (disconnectError) {
        console.debug("native host disconnected:", disconnectError.message);
      }
      nativePickerState.nativePort = null;
      for (const pending of nativePickerState.pendingAcksByRequestId.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(disconnectError?.message || "Native host disconnected."));
      }
      nativePickerState.pendingAcksByRequestId.clear();
    });
    return port;
  } catch (error) {
    console.debug("connectNative failed:", error);
    nativePickerState.nativePort = null;
    return null;
  }
}

function sendEnvelopeViaNativeHost(envelope) {
  return new Promise((resolve, reject) => {
    const port = ensureNativeHostPort();
    if (!port) {
      reject(new Error("Native host is unavailable."));
      return;
    }
    const requestId =
      typeof envelope.requestId === "string" && envelope.requestId.trim()
        ? envelope.requestId.trim()
        : makeNativeRequestId();
    const payload = {
      schemaVersion: NATIVE_PICKER_SCHEMA_VERSION,
      requestId,
      source: "recorder_extension",
      timestamp: toIso(),
      ...envelope,
      requestId,
      senderExtensionId: chrome.runtime.id
    };
    const timeout = setTimeout(() => {
      nativePickerState.pendingAcksByRequestId.delete(requestId);
      reject(new Error("Native host ack timeout."));
    }, NATIVE_PICKER_ACK_TIMEOUT_MS);
    nativePickerState.pendingAcksByRequestId.set(requestId, { resolve, reject, timeout });
    try {
      port.postMessage(payload);
    } catch (error) {
      nativePickerState.pendingAcksByRequestId.delete(requestId);
      clearTimeout(timeout);
      reject(error);
    }
  });
}

function storageGet(keys) {
  return new Promise(resolve => {
    chrome.storage.local.get(keys, items => resolve(items || {}));
  });
}

function storageSet(values) {
  return new Promise(resolve => {
    chrome.storage.local.set(values, () => resolve());
  });
}

function parseUrlSafe(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function buildApiBase(port) {
  return `http://127.0.0.1:${port}/api/v1`;
}

async function listNativePickerApiPortCandidates() {
  const stored = await storageGet(["nativePickerApiPort"]);
  const storedPort =
    typeof stored.nativePickerApiPort === "number" && Number.isFinite(stored.nativePickerApiPort)
      ? Math.floor(stored.nativePickerApiPort)
      : null;

  const candidates = [];
  const pushCandidate = port => {
    if (!Number.isFinite(port)) {
      return;
    }
    const normalized = Math.floor(port);
    if (normalized < 1024 || normalized > 65535) {
      return;
    }
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  pushCandidate(storedPort);
  pushCandidate(NATIVE_PICKER_DEFAULT_PORT);
  for (let offset = 1; offset <= NATIVE_PICKER_PORT_SCAN_STEPS; offset += 1) {
    pushCandidate(NATIVE_PICKER_DEFAULT_PORT + offset);
  }
  return candidates;
}

async function isApiHealthy(port) {
  const base = buildApiBase(port);
  try {
    const response = await fetch(`${base}/health`, {
      method: "GET",
      cache: "no-store"
    });
    if (!response.ok) {
      return false;
    }
    const payload = await response.json().catch(() => null);
    return payload && payload.status === "ok";
  } catch {
    return false;
  }
}

async function supportsNativePickerApi(port) {
  const base = buildApiBase(port);
  try {
    const response = await fetch(`${base}/native-picker/sessions?limit=1&offset=0`, {
      method: "GET",
      cache: "no-store"
    });
    if (!response.ok) {
      return false;
    }
    const payload = await response.json().catch(() => null);
    return payload && typeof payload === "object" && Array.isArray(payload.sessions);
  } catch {
    return false;
  }
}

async function hasNativePickerSessionOnPort(port, sessionId) {
  const targetSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!targetSessionId) {
    return false;
  }
  const base = buildApiBase(port);
  try {
    const response = await fetch(
      `${base}/native-picker/sessions/${encodeURIComponent(targetSessionId)}`,
      {
        method: "GET",
        cache: "no-store"
      }
    );
    if (!response.ok) {
      return false;
    }
    const payload = await response.json().catch(() => null);
    return payload && typeof payload.sessionId === "string" && payload.sessionId === targetSessionId;
  } catch {
    return false;
  }
}

function isSessionNotFoundAck(ack, sessionId = "") {
  if (!ack || typeof ack !== "object") {
    return false;
  }
  const code = typeof ack.code === "string" ? ack.code.trim().toUpperCase() : "";
  if (code.includes("SESSION_NOT_FOUND")) {
    return true;
  }
  const message = typeof ack.message === "string" ? ack.message.trim().toLowerCase() : "";
  if (!message) {
    return false;
  }
  if (message.includes("session not found")) {
    return true;
  }
  const normalizedSessionId = String(sessionId || "").trim().toLowerCase();
  return Boolean(normalizedSessionId && message.includes(normalizedSessionId));
}

async function resolveNativePickerApiBaseBySessionId(sessionId) {
  const targetSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!targetSessionId) {
    return null;
  }
  const candidates = await listNativePickerApiPortCandidates();
  for (const candidate of candidates) {
    const healthy = await isApiHealthy(candidate);
    if (!healthy) {
      continue;
    }
    const nativePickerReady = await supportsNativePickerApi(candidate);
    if (!nativePickerReady) {
      continue;
    }
    const hasSession = await hasNativePickerSessionOnPort(candidate, targetSessionId);
    if (!hasSession) {
      continue;
    }
    nativePickerState.apiPort = candidate;
    nativePickerState.apiBase = buildApiBase(candidate);
    await storageSet({ nativePickerApiPort: candidate });
    console.debug("[rpa-picker] rebound API port by session id", {
      sessionId: targetSessionId,
      port: candidate
    });
    return nativePickerState.apiBase;
  }
  return null;
}

async function resolveNativePickerApiBase(forceRefresh = false) {
  if (!forceRefresh && nativePickerState.apiBase) {
    return nativePickerState.apiBase;
  }
  const candidates = await listNativePickerApiPortCandidates();

  for (const candidate of candidates) {
    const healthy = await isApiHealthy(candidate);
    if (!healthy) {
      continue;
    }
    const nativePickerReady = await supportsNativePickerApi(candidate);
    if (!nativePickerReady) {
      console.debug("[rpa-picker] skip API port without native-picker support:", candidate);
      continue;
    }
    nativePickerState.apiPort = candidate;
    nativePickerState.apiBase = buildApiBase(candidate);
    await storageSet({ nativePickerApiPort: candidate });
    return nativePickerState.apiBase;
  }

  throw new Error("Desktop API with native-picker support is unreachable.");
}

async function fetchNativePickerApi(path, init = {}) {
  const doRequest = async forceRefresh => {
    const base = await resolveNativePickerApiBase(forceRefresh);
    const hasBody = Object.prototype.hasOwnProperty.call(init, "body");
    const headers = {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {})
    };
    const response = await fetch(`${base}${path}`, {
      ...init,
      cache: "no-store",
      headers
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const code = payload?.code || "HTTP_ERROR";
      const message = payload?.message || response.statusText || "Native picker API request failed.";
      throw new Error(`${code}: ${message}`);
    }
    return payload;
  };

  try {
    return await doRequest(false);
  } catch (firstError) {
    nativePickerState.apiBase = null;
    nativePickerState.apiPort = null;
    return doRequest(true).catch(() => {
      throw firstError;
    });
  }
}

async function sendEnvelopeViaHttp(envelope) {
  return fetchNativePickerApi("/native-picker/messages", {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: NATIVE_PICKER_SCHEMA_VERSION,
      source: "recorder_extension",
      timestamp: toIso(),
      ...envelope
    })
  });
}

async function sendNativePickerEnvelope(type, sessionId, payload = {}) {
  const envelope = {
    schemaVersion: NATIVE_PICKER_SCHEMA_VERSION,
    type,
    requestId: makeNativeRequestId(),
    sessionId,
    payload
  };

  let httpAck = null;
  let httpError = null;

  try {
    httpAck = await sendEnvelopeViaHttp(envelope);
    if (httpAck && typeof httpAck.ok === "boolean" && httpAck.ok) {
      return httpAck;
    }
  } catch (error) {
    httpError = error;
    console.debug("native picker http send failed, fallback to native host:", error);
  }

  if (isSessionNotFoundAck(httpAck, sessionId)) {
    try {
      const reboundBase = await resolveNativePickerApiBaseBySessionId(sessionId);
      if (reboundBase) {
        const reboundAck = await sendEnvelopeViaHttp(envelope);
        if (reboundAck && typeof reboundAck.ok === "boolean") {
          return reboundAck;
        }
      }
    } catch (reboundError) {
      console.debug("native picker rebound http send failed:", reboundError);
    }
  }

  try {
    const nativeAck = await sendEnvelopeViaNativeHost(envelope);
    if (nativeAck && typeof nativeAck.ok === "boolean") {
      return nativeAck;
    }
  } catch (nativeError) {
    console.debug("native host send failed:", nativeError);
    if (httpError) {
      throw httpError;
    }
    throw nativeError;
  }

  if (httpAck && typeof httpAck.ok === "boolean") {
    return httpAck;
  }
  if (httpError) {
    throw httpError;
  }
  throw new Error("Native picker ack is missing.");
}

function findNativeSessionIdByTab(tabId) {
  if (typeof tabId !== "number") {
    return null;
  }
  const mapped = nativePickerState.sessionIdByTab.get(tabId);
  if (mapped) {
    return mapped;
  }
  for (const [sessionId, entry] of nativePickerState.sessionById.entries()) {
    if (entry && entry.tabId === tabId) {
      nativePickerState.sessionIdByTab.set(tabId, sessionId);
      return sessionId;
    }
  }
  return null;
}

function clearNativeSession(sessionId, options = {}) {
  if (!sessionId) {
    return;
  }
  const entry = nativePickerState.sessionById.get(sessionId);
  nativePickerState.sessionById.delete(sessionId);
  nativePickerState.completedSessionIds.add(sessionId);
  if (entry && typeof entry.tabId === "number") {
    nativePickerState.sessionIdByTab.delete(entry.tabId);
    if (options.disablePickMode !== false) {
      sendPickerMode(entry.tabId, false);
    }
  }
}

async function armNativePickerWhenReady(sessionId, targetTabId, attempt = 0) {
  const sendResult = await sendMessageToTab(targetTabId, {
    type: "RECORDER_PICK_MODE",
    enabled: true,
    nativeSessionId: sessionId
  });
  if (sendResult.ok) {
    try {
      await sendNativePickerEnvelope("session_ready", sessionId, {
        tabId: targetTabId
      });
    } catch (sendError) {
      console.debug("session_ready send failed:", sendError);
    }
    return;
  }

  if (shouldTryInjectContentScript(sendResult.error) && attempt <= 2) {
    const injected = await injectContentScript(targetTabId);
    if (injected) {
      setTimeout(() => {
        void armNativePickerWhenReady(sessionId, targetTabId, attempt + 1);
      }, 40);
      return;
    }
  }

  if (attempt >= NATIVE_PICKER_MAX_ARM_RETRIES) {
    console.debug("native picker arm failed after retries:", sendResult.error);
    try {
      await sendNativePickerEnvelope("error", sessionId, {
        errorCode: "NATIVE_PICKER_TAB_UNAVAILABLE",
        errorMessage: sendResult.error || "Unable to start picker UI in target tab."
      });
    } catch (sendError) {
      console.debug("native picker error send failed:", sendError);
    }
    clearNativeSession(sessionId, { disablePickMode: true });
    return;
  }

  const retryDelay = attempt <= 2 ? 80 : 140;
  setTimeout(() => {
    void armNativePickerWhenReady(sessionId, targetTabId, attempt + 1);
  }, retryDelay);
}

async function queryTabs(queryInfo) {
  return new Promise(resolve => {
    chrome.tabs.query(queryInfo, tabs => resolve(tabs || []));
  });
}

async function createTab(createProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties, tab => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tab);
    });
  });
}

async function updateTab(tabId, updateProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties, tab => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tab);
    });
  });
}

async function updateWindow(windowId, updateProperties) {
  return new Promise((resolve, reject) => {
    chrome.windows.update(windowId, updateProperties, window => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(window);
    });
  });
}

async function bringTabToFront(tab) {
  if (!tab || typeof tab.id !== "number") {
    return tab;
  }
  const refreshedTab = await updateTab(tab.id, { active: true });
  const windowId = typeof refreshedTab?.windowId === "number"
    ? refreshedTab.windowId
    : typeof tab.windowId === "number"
      ? tab.windowId
      : null;
  if (typeof windowId === "number") {
    try {
      await updateWindow(windowId, { focused: true, drawAttention: true });
    } catch (error) {
      console.debug("focus picker window failed:", error);
    }
  }
  return refreshedTab || tab;
}

function pickTabByUrl(tabs, pageUrl) {
  const target = parseUrlSafe(pageUrl);
  if (!target) {
    return null;
  }
  const targetNoHash = `${target.origin}${target.pathname}${target.search}`;
  let sameOrigin = null;
  for (const tab of tabs) {
    if (!tab || typeof tab.id !== "number" || typeof tab.url !== "string") {
      continue;
    }
    const current = parseUrlSafe(tab.url);
    if (!current) {
      continue;
    }
    const currentNoHash = `${current.origin}${current.pathname}${current.search}`;
    if (currentNoHash === targetNoHash) {
      return tab;
    }
    if (!sameOrigin && current.origin === target.origin) {
      sameOrigin = tab;
    }
  }
  return sameOrigin;
}

function isAttachableTab(tab) {
  if (!tab || typeof tab.id !== "number") {
    return false;
  }
  if (typeof tab.url !== "string") {
    return false;
  }
  return /^https?:\/\//i.test(tab.url.trim());
}

async function pickAttachableTabForSession(session) {
  const pageUrl = typeof session?.pageUrl === "string" ? session.pageUrl.trim() : "";
  const allTabs = await queryTabs({});

  const focusedActiveTabs = await queryTabs({ active: true, lastFocusedWindow: true });
  const focusedActive = focusedActiveTabs.find(isAttachableTab);
  if (focusedActive) {
    return focusedActive;
  }

  const currentActiveTabs = await queryTabs({ active: true, currentWindow: true });
  const currentActive = currentActiveTabs.find(isAttachableTab);
  if (currentActive) {
    return currentActive;
  }

  if (pageUrl) {
    const byUrl = pickTabByUrl(allTabs, pageUrl);
    if (isAttachableTab(byUrl)) {
      return byUrl;
    }
  }

  return allTabs.find(isAttachableTab) || null;
}

async function openOrReuseNativePickerTab(pageUrl) {
  const tabs = await queryTabs({});
  const selected = pickTabByUrl(tabs, pageUrl);
  if (selected && typeof selected.id === "number") {
    await updateTab(selected.id, { active: true, url: pageUrl });
    return selected;
  }
  return createTab({ url: pageUrl, active: true });
}

async function activateNativeSession(session) {
  if (!session || typeof session.sessionId !== "string") {
    return;
  }
  if (nativePickerState.sessionById.has(session.sessionId)) {
    return;
  }
  if (nativePickerState.sessionById.size > 0) {
    return;
  }
  try {
    const launchMode =
      typeof session.launchMode === "string" && session.launchMode.trim()
        ? session.launchMode.trim()
        : "attach_existing";
    let tab = null;
    if (launchMode === "open_url") {
      const pageUrl = typeof session.pageUrl === "string" ? session.pageUrl.trim() : "";
      if (!/^https?:\/\//i.test(pageUrl)) {
        throw new Error("pageUrl is required when launchMode=open_url.");
      }
      tab = await openOrReuseNativePickerTab(pageUrl);
    } else {
      tab = await pickAttachableTabForSession(session);
    }
    if (!tab || typeof tab.id !== "number") {
      throw new Error("No attachable browser tab found. Open target page in Chrome and retry.");
    }
    tab = await bringTabToFront(tab);
    nativePickerState.sessionById.set(session.sessionId, {
      tabId: tab.id,
      pageUrl: session.pageUrl,
      launchMode,
      updatedAt: Date.now()
    });
    nativePickerState.sessionIdByTab.set(tab.id, session.sessionId);
    armNativePickerWhenReady(session.sessionId, tab.id);
  } catch (error) {
    console.debug("activate native session failed:", error);
    try {
      await sendNativePickerEnvelope("error", session.sessionId, {
        errorCode: "NATIVE_PICKER_ATTACH_TAB_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    } catch (sendError) {
      console.debug("native picker open tab error send failed:", sendError);
    }
    clearNativeSession(session.sessionId, { disablePickMode: true });
  }
}

async function pollNativePickerSessions() {
  if (nativePickerState.pollInFlight) {
    return;
  }
  nativePickerState.pollInFlight = true;
  try {
    const payload = await fetchNativePickerApi(
      `/native-picker/sessions?limit=${NATIVE_PICKER_MAX_SESSION_CANDIDATES}&offset=0`,
      {
        method: "GET"
      }
    );
    const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
    const serverSessionsById = new Map();
    for (const session of sessions) {
      if (session && typeof session.sessionId === "string") {
        serverSessionsById.set(session.sessionId, session);
      }
    }

    for (const [sessionId] of nativePickerState.sessionById.entries()) {
      const serverSession = serverSessionsById.get(sessionId);
      if (!serverSession || isTerminalNativePickerStatus(serverSession.status)) {
        clearNativeSession(sessionId, { disablePickMode: true });
      }
    }

    const candidates = sessions
      .filter(session => {
        if (!session || typeof session.sessionId !== "string") {
          return false;
        }
        if (nativePickerState.completedSessionIds.has(session.sessionId)) {
          return false;
        }
        return session.status === "pending" || session.status === "ready" || session.status === "picking";
      })
      .sort((a, b) => {
        const left = Date.parse(a.createdAt || "");
        const right = Date.parse(b.createdAt || "");
        return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
      });

    for (const session of candidates) {
      await activateNativeSession(session);
    }
  } catch (error) {
    console.debug("native picker polling failed:", error);
  } finally {
    nativePickerState.pollInFlight = false;
  }
}

function ensureNativePickerPolling() {
  if (nativePickerState.pollTimer !== null) {
    scheduleNativePickerPollAlarm(1500);
    return;
  }
  const tick = () => {
    void pollNativePickerSessions();
  };
  tick();
  nativePickerState.pollTimer = setInterval(tick, NATIVE_PICKER_POLL_MS);
  scheduleNativePickerPollAlarm(1200);
}

function scheduleNativePickerPollAlarm(delayMs = NATIVE_PICKER_ALARM_DELAY_MS) {
  try {
    const minDelay = Math.max(1000, Math.floor(delayMs));
    chrome.alarms.create(NATIVE_PICKER_ALARM_NAME, {
      when: Date.now() + minDelay
    });
  } catch (error) {
    console.debug("schedule native picker alarm failed:", error);
  }
}

function triggerNativePickerPoll() {
  void pollNativePickerSessions();
  scheduleNativePickerPollAlarm();
}

async function resolveNativeSessionIdForTab(sourceTabId) {
  const mapped = findNativeSessionIdByTab(sourceTabId);
  if (mapped) {
    return mapped;
  }

  const inMemoryCandidates = Array.from(nativePickerState.sessionById.entries())
    .filter(([sessionId]) => !nativePickerState.completedSessionIds.has(sessionId));
  if (inMemoryCandidates.length === 1) {
    const [sessionId, entry] = inMemoryCandidates[0];
    nativePickerState.sessionIdByTab.set(sourceTabId, sessionId);
    nativePickerState.sessionById.set(sessionId, {
      ...(entry || {}),
      tabId: sourceTabId,
      updatedAt: Date.now()
    });
    return sessionId;
  }

  try {
    const payload = await fetchNativePickerApi(
      `/native-picker/sessions?limit=${NATIVE_PICKER_MAX_SESSION_CANDIDATES}&offset=0`,
      { method: "GET" }
    );
    const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
    const candidates = sessions
      .filter(session => {
        if (!session || typeof session.sessionId !== "string") {
          return false;
        }
        if (nativePickerState.completedSessionIds.has(session.sessionId)) {
          return false;
        }
        return session.status === "pending" || session.status === "ready" || session.status === "picking";
      })
      .sort((a, b) => {
        const left = Date.parse(a.createdAt || "");
        const right = Date.parse(b.createdAt || "");
        return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
      });

    const byDiagnostics = candidates.find(session => {
      const tabId = Number(session?.diagnostics?.tabId);
      return Number.isFinite(tabId) && tabId === sourceTabId;
    });
    const resolved = byDiagnostics || (candidates.length === 1 ? candidates[0] : null);
    if (!resolved || typeof resolved.sessionId !== "string") {
      return null;
    }

    nativePickerState.sessionById.set(resolved.sessionId, {
      tabId: sourceTabId,
      pageUrl: resolved.pageUrl,
      launchMode: resolved.launchMode,
      updatedAt: Date.now()
    });
    nativePickerState.sessionIdByTab.set(sourceTabId, resolved.sessionId);
    return resolved.sessionId;
  } catch (error) {
    console.debug("resolve native session by tab failed:", error);
    return null;
  }
}

async function handleNativePickedMessage(sourceTabId, message) {
  const explicitSessionId =
    typeof message?.nativeSessionId === "string" && message.nativeSessionId.trim()
      ? message.nativeSessionId.trim()
      : "";
  const sessionId = explicitSessionId || (await resolveNativeSessionIdForTab(sourceTabId));
  if (!sessionId) {
    return { ok: false, error: "Native picker session not found for this tab." };
  }

  const sendPickResult = async targetSessionId =>
    sendNativePickerEnvelope("pick_result", targetSessionId, {
      result: message.payload,
      pickerMeta: message.pickerMeta || null,
      tabId: sourceTabId
    });

  try {
    let effectiveSessionId = sessionId;
    let ack = await sendPickResult(effectiveSessionId);

    if (!ack?.ok && isSessionNotFoundAck(ack, effectiveSessionId)) {
      // Drop stale tab->session binding and try to recover current live session once.
      nativePickerState.sessionIdByTab.delete(sourceTabId);
      nativePickerState.sessionById.delete(effectiveSessionId);
      const recoveredSessionId = await resolveNativeSessionIdForTab(sourceTabId);
      if (recoveredSessionId && recoveredSessionId !== effectiveSessionId) {
        console.debug("[rpa-picker] retry pick_result with recovered session", {
          sourceTabId,
          previousSessionId: effectiveSessionId,
          recoveredSessionId
        });
        effectiveSessionId = recoveredSessionId;
        ack = await sendPickResult(effectiveSessionId);
      }
    }

    if (!ack?.ok) {
      console.debug("pick_result rejected:", ack);
      return { ok: false, error: ack?.message || "Native picker rejected the result." };
    }
    clearNativeSession(effectiveSessionId, { disablePickMode: true });
    return { ok: true, sessionId: effectiveSessionId };
  } catch (error) {
    console.debug("pick_result send failed:", error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function handleNativePickCanceledMessage(sourceTabId, message) {
  const explicitSessionId =
    typeof message?.nativeSessionId === "string" && message.nativeSessionId.trim()
      ? message.nativeSessionId.trim()
      : "";
  const sessionId = explicitSessionId || (await resolveNativeSessionIdForTab(sourceTabId));
  if (!sessionId) {
    return false;
  }
  const stage = typeof message.stage === "string" ? message.stage : "cancelled";
  const errorMessage =
    typeof message.error === "string" && message.error.trim()
      ? message.error.trim()
      : "Element pick cancelled.";
  try {
    if (stage === "cancelled") {
      await sendNativePickerEnvelope("cancel", sessionId, {
        reason: errorMessage,
        tabId: sourceTabId
      });
    } else {
      await sendNativePickerEnvelope("error", sessionId, {
        errorCode: "NATIVE_PICKER_PAGE_ERROR",
        errorMessage,
        tabId: sourceTabId
      });
    }
  } catch (error) {
    console.debug("cancel/error send failed:", error);
  } finally {
    clearNativeSession(sessionId, { disablePickMode: true });
  }
  return true;
}

chrome.tabs.onRemoved.addListener(tabId => {
  const nativeSessionId = findNativeSessionIdByTab(tabId);
  if (nativeSessionId) {
    void sendNativePickerEnvelope("cancel", nativeSessionId, {
      reason: "Picker tab has been closed.",
      tabId
    }).catch(error => {
      console.debug("tab close cancel send failed:", error);
    });
    clearNativeSession(nativeSessionId, { disablePickMode: false });
  }

  if (pickerSession && tabId === pickerSession.targetTabId) {
    pushPickerErrorToRequester(pickerSession.requesterTabId, "Picker tab has been closed.");
    pickerSession = null;
  } else if (pickerSession && tabId === pickerSession.requesterTabId) {
    sendPickerMode(pickerSession.targetTabId, false);
    pickerSession = null;
  }

  recorderStateByTab.delete(tabId);
  recorderEventsByTab.delete(tabId);
  if (lastRecorderTabId === tabId) {
    lastRecorderTabId = null;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  ensureNativePickerPolling();
  triggerNativePickerPoll();
});

chrome.runtime.onStartup.addListener(() => {
  ensureNativePickerPolling();
  triggerNativePickerPoll();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (!alarm || alarm.name !== NATIVE_PICKER_ALARM_NAME) {
    return;
  }
  triggerNativePickerPoll();
});

chrome.tabs.onCreated.addListener(() => {
  triggerNativePickerPoll();
});

chrome.tabs.onActivated.addListener(() => {
  triggerNativePickerPoll();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "loading" || changeInfo.status === "complete") {
    triggerNativePickerPoll();
  }
});

chrome.windows.onFocusChanged.addListener(() => {
  triggerNativePickerPoll();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ensureNativePickerPolling();
  triggerNativePickerPoll();

  if (!message || typeof message.type !== "string") {
    sendResponse({ ok: false, error: "Invalid message" });
    return true;
  }

  if (message.type === "RECORDER_EVENT") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "tabId missing in sender" });
      return true;
    }

    ensureTabState(tabId);
    if (!recorderStateByTab.get(tabId).recording) {
      sendResponse({ ok: true, ignored: true });
      return true;
    }

    const event = {
      id: `evt_${crypto.randomUUID()}`,
      timestamp: toIso(),
      tabId,
      ...message.event
    };
    addEvent(tabId, event);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "RECORDER_START") {
    const tabId = message.tabId;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "tabId is required" });
      return true;
    }
    ensureTabState(tabId);
    recorderStateByTab.set(tabId, { recording: true });
    lastRecorderTabId = tabId;
    sendToggleToTab(tabId, true);
    sendResponse({ ok: true, tabId, recording: true });
    return true;
  }

  if (message.type === "RECORDER_STOP") {
    const tabId = message.tabId;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "tabId is required" });
      return true;
    }
    ensureTabState(tabId);
    recorderStateByTab.set(tabId, { recording: false });
    sendToggleToTab(tabId, false);
    sendResponse({ ok: true, tabId, recording: false });
    return true;
  }

  if (message.type === "RECORDER_CLEAR") {
    const tabId = message.tabId;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "tabId is required" });
      return true;
    }
    recorderEventsByTab.set(tabId, []);
    sendResponse({ ok: true, tabId });
    return true;
  }

  if (message.type === "RECORDER_GET_STATE") {
    const tabId = typeof message.tabId === "number" ? message.tabId : findLatestTabId();
    sendResponse({
      ok: true,
      latestRecorderTabId: findLatestTabId(),
      ...buildPayload(tabId)
    });
    return true;
  }

  if (message.type === "RECORDER_PUSH_DESIGNER") {
    const targetTabId = message.targetTabId;
    const sourceTabId =
      typeof message.sourceTabId === "number" ? message.sourceTabId : findLatestTabId();
    if (typeof targetTabId !== "number") {
      sendResponse({ ok: false, error: "targetTabId is required" });
      return true;
    }
    if (typeof sourceTabId !== "number") {
      sendResponse({ ok: false, error: "No recorder payload available" });
      return true;
    }
    sendPayloadToTabPage(targetTabId, sourceTabId);
    sendResponse({ ok: true, targetTabId, sourceTabId });
    return true;
  }

  if (message.type === "RECORDER_PULL_LATEST_FOR_PAGE") {
    const sourceTabId = findLatestTabId();
    if (typeof sourceTabId !== "number") {
      sendResponse({ ok: false, error: "No recorder payload available." });
      return true;
    }
    sendResponse({ ok: true, sourceTabId, payload: buildPayload(sourceTabId) });
    return true;
  }

  if (message.type === "RECORDER_PICKER_STATUS") {
    const tabId = sender.tab?.id;
    const nativeSessionId = findNativeSessionIdByTab(tabId);
    const enabled =
      typeof tabId === "number" &&
      ((pickerSession !== null && pickerSession.targetTabId === tabId) || Boolean(nativeSessionId));
    sendResponse({
      ok: true,
      enabled,
      targetTabId: pickerSession?.targetTabId ?? tabId ?? null,
      requesterTabId: pickerSession?.requesterTabId ?? null,
      nativeSessionId
    });
    return true;
  }

  if (message.type === "RECORDER_PICKER_START") {
    const requesterTabId = sender.tab?.id;
    const url =
      typeof message.payload?.url === "string"
        ? message.payload.url.trim()
        : typeof message.url === "string"
          ? message.url.trim()
          : "";
    const source =
      typeof message.payload?.url === "string"
        ? "payload.url"
        : typeof message.url === "string"
          ? "url"
          : "none";
    const requestedNodeId =
      typeof message.payload?.nodeId === "string" && message.payload.nodeId.trim()
        ? message.payload.nodeId.trim()
        : null;
    if (typeof requesterTabId !== "number") {
      sendResponse({ ok: false, error: "requester tab id is missing" });
      return true;
    }
    if (!/^https?:\/\//i.test(url)) {
      sendResponse({
        ok: false,
        error: "url must start with http:// or https://",
        received: {
          url,
          source,
          hasPayload: Boolean(message.payload)
        }
      });
      return true;
    }

    clearPickerSession("Previous picker session cancelled.");
    chrome.tabs.create({ url, active: true }, tab => {
      const createError = chrome.runtime.lastError;
      if (createError) {
        sendResponse({ ok: false, error: `open picker page failed: ${createError.message}` });
        return;
      }
      if (!tab || typeof tab.id !== "number") {
        sendResponse({ ok: false, error: "target tab creation failed" });
        return;
      }
      void bringTabToFront(tab)
        .catch(error => {
          console.debug("bring picker tab to front failed:", error);
          return tab;
        })
        .then(focusedTab => {
          const targetTabId = typeof focusedTab?.id === "number" ? focusedTab.id : tab.id;
          pickerSession = {
            requesterTabId,
            targetTabId,
            nodeId: requestedNodeId,
            startedAt: Date.now()
          };
          armPickerWhenReady(targetTabId);
          sendResponse({ ok: true, requesterTabId, targetTabId, url });
        });
    });
    return true;
  }

  if (message.type === "RECORDER_PICKED") {
    const sourceTabId = sender.tab?.id;
    if (typeof sourceTabId === "number") {
      if (pickerSession && sourceTabId === pickerSession.targetTabId) {
        console.debug("[rpa-picker] route pick result via extension session", {
          sourceTabId,
          requesterTabId: pickerSession.requesterTabId,
          targetTabId: pickerSession.targetTabId
        });
        const requesterTabId = pickerSession.requesterTabId;
        pushPickerResultToRequester(
          requesterTabId,
          message.payload,
          message.pickerMeta,
          pickerSession.nodeId || null
        );
        clearPickerSession();
        void updateTab(requesterTabId, { active: true })
          .then(tab => bringTabToFront(tab))
          .catch(error => {
            console.debug("focus requester tab after pick failed:", error);
          });
        sendResponse({ ok: true });
        return true;
      }

      void handleNativePickedMessage(sourceTabId, message)
        .then(result => {
          if (result?.ok) {
            console.debug("[rpa-picker] route pick result via native session", {
              sourceTabId,
              nativeSessionId: result.sessionId || null
            });
            sendResponse({ ok: true, nativeSessionId: result.sessionId || null });
            return;
          }
          console.debug("[rpa-picker] native pick result route failed", {
            sourceTabId,
            error: result?.error || "Native picker result sync failed."
          });
          sendResponse({ ok: false, error: result?.error || "Native picker result sync failed." });
        })
        .catch(error => sendResponse({ ok: false, error: String(error) }));
      return true;
    }

    if (!pickerSession) {
      sendResponse({ ok: false, error: "No active picker session" });
      return true;
    }
    if (sourceTabId !== pickerSession.targetTabId) {
      sendResponse({ ok: false, error: "Unexpected picker tab" });
      return true;
    }

    pushPickerResultToRequester(
      pickerSession.requesterTabId,
      message.payload,
      message.pickerMeta,
      pickerSession.nodeId || null
    );
    clearPickerSession();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "RECORDER_PICK_CANCELED") {
    const sourceTabId = sender.tab?.id;
    if (typeof sourceTabId === "number") {
      if (pickerSession && sourceTabId === pickerSession.targetTabId) {
        console.debug("[rpa-picker] route cancel via extension session", {
          sourceTabId,
          requesterTabId: pickerSession.requesterTabId,
          targetTabId: pickerSession.targetTabId
        });
        const errorMessage =
          typeof message.error === "string" && message.error.trim()
            ? message.error.trim()
            : "Element pick cancelled.";
        clearPickerSession(errorMessage, typeof message.stage === "string" ? message.stage : "cancelled");
        sendResponse({ ok: true });
        return true;
      }

      void handleNativePickCanceledMessage(sourceTabId, message)
        .then(handled => {
          if (handled) {
            sendResponse({ ok: true });
            return;
          }
          sendResponse({ ok: false, error: "No active picker session" });
        })
        .catch(error => sendResponse({ ok: false, error: String(error) }));
      return true;
    }

    if (!pickerSession) {
      sendResponse({ ok: false, error: "No active picker session" });
      return true;
    }
    if (sourceTabId !== pickerSession.targetTabId) {
      sendResponse({ ok: false, error: "Unexpected picker tab" });
      return true;
    }

    const errorMessage =
      typeof message.error === "string" && message.error.trim()
        ? message.error.trim()
        : "Element pick cancelled.";
    clearPickerSession(errorMessage, typeof message.stage === "string" ? message.stage : "cancelled");
    sendResponse({ ok: true });
    return true;
  }

  sendResponse({ ok: false, error: `Unknown type: ${message.type}` });
  return true;
});

ensureNativePickerPolling();
