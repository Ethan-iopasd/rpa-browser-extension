import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

function createEvent() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    listeners
  };
}

function mockJsonResponse(payload, status = 200, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async json() {
      return payload;
    }
  };
}

function createChromeMock() {
  const runtimeOnInstalled = createEvent();
  const runtimeOnStartup = createEvent();
  const runtimeOnMessage = createEvent();

  const tabsOnRemoved = createEvent();
  const tabsOnCreated = createEvent();
  const tabsOnActivated = createEvent();
  const tabsOnUpdated = createEvent();

  const alarmsOnAlarm = createEvent();
  const windowsOnFocusChanged = createEvent();

  const sentMessages = [];
  let nextTabId = 2000;

  const chrome = {
    runtime: {
      id: "test-extension-id",
      lastError: null,
      onInstalled: runtimeOnInstalled,
      onStartup: runtimeOnStartup,
      onMessage: runtimeOnMessage,
      connectNative() {
        throw new Error("connectNative not implemented in smoke test mock.");
      }
    },
    tabs: {
      sendMessage(tabId, message, callback) {
        sentMessages.push({ tabId, message });
        chrome.runtime.lastError = null;
        if (typeof callback === "function") {
          callback({ ok: true });
        }
      },
      create(createProperties, callback) {
        const tab = {
          id: nextTabId,
          url: createProperties?.url || "",
          active: Boolean(createProperties?.active),
          windowId: 1
        };
        nextTabId += 1;
        chrome.runtime.lastError = null;
        if (typeof callback === "function") {
          callback(tab);
        }
      },
      query(_queryInfo, callback) {
        chrome.runtime.lastError = null;
        if (typeof callback === "function") {
          callback([]);
        }
      },
      update(tabId, updateProperties, callback) {
        chrome.runtime.lastError = null;
        if (typeof callback === "function") {
          callback({
            id: tabId,
            windowId: 1,
            active: Boolean(updateProperties?.active),
            url: typeof updateProperties?.url === "string" ? updateProperties.url : "https://example.com"
          });
        }
      },
      onRemoved: tabsOnRemoved,
      onCreated: tabsOnCreated,
      onActivated: tabsOnActivated,
      onUpdated: tabsOnUpdated
    },
    windows: {
      onFocusChanged: windowsOnFocusChanged,
      update(windowId, updateProperties, callback) {
        if (typeof callback === "function") {
          callback({
            id: windowId,
            focused: Boolean(updateProperties?.focused)
          });
        }
      }
    },
    alarms: {
      onAlarm: alarmsOnAlarm,
      create() {
        // No-op in smoke test.
      }
    },
    storage: {
      local: {
        get(_keys, callback) {
          if (typeof callback === "function") {
            callback({});
          }
        },
        set(_values, callback) {
          if (typeof callback === "function") {
            callback();
          }
        }
      }
    },
    scripting: {
      executeScript(_options, callback) {
        if (typeof callback === "function") {
          callback();
        }
      }
    },
    _sentMessages: sentMessages
  };

  return chrome;
}

async function dispatchRuntimeMessage(listener, message, senderTabId) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = value => {
      if (done) {
        return;
      }
      done = true;
      resolve(value);
    };

    try {
      const result = listener(
        message,
        typeof senderTabId === "number" ? { tab: { id: senderTabId } } : {},
        response => finish(response)
      );
      if (result !== true) {
        finish(undefined);
      }
      setTimeout(() => finish(undefined), 0);
    } catch (error) {
      reject(error);
    }
  });
}

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const backgroundPath = path.resolve(currentDir, "..", "background.js");
const backgroundCode = fs.readFileSync(backgroundPath, "utf8");

const chrome = createChromeMock();
const context = {
  console,
  chrome,
  crypto,
  URL,
  Date,
  setTimeout,
  clearTimeout,
  setInterval() {
    return 1;
  },
  clearInterval() {
    // No-op in smoke test.
  },
  fetch: async url => {
    const target = String(url || "");
    if (target.includes("/api/v1/health")) {
      return mockJsonResponse({ status: "ok" });
    }
    if (target.includes("/native-picker/sessions")) {
      return mockJsonResponse({ sessions: [] });
    }
    if (target.includes("/native-picker/messages")) {
      return mockJsonResponse({ ok: true });
    }
    return mockJsonResponse({});
  }
};
context.globalThis = context;

vm.runInNewContext(backgroundCode, context, { filename: backgroundPath });

const onMessageListener = chrome.runtime.onMessage.listeners[0];
assert.equal(typeof onMessageListener, "function", "background onMessage listener should be registered");

const requesterTabId = 101;
const startResponse = await dispatchRuntimeMessage(
  onMessageListener,
  {
    type: "RECORDER_PICKER_START",
    payload: { url: "https://example.com/path", nodeId: "n_click" }
  },
  requesterTabId
);
assert.equal(startResponse?.ok, true, "RECORDER_PICKER_START should succeed");
assert.equal(typeof startResponse?.targetTabId, "number", "targetTabId should be returned");

const pickerTabId = startResponse.targetTabId;

const pickedResponse = await dispatchRuntimeMessage(
  onMessageListener,
  {
    type: "RECORDER_PICKED",
    payload: { selector: "#submit", selectorType: "css" },
    pickerMeta: { selectorType: "css" }
  },
  pickerTabId
);
assert.equal(pickedResponse?.ok, true, "RECORDER_PICKED should be accepted");

const pushedPickResult = chrome._sentMessages.find(
  item => item.tabId === requesterTabId && item.message?.type === "RECORDER_PUSH_PICK_RESULT"
);
assert.ok(pushedPickResult, "should route pick result back to requester tab");
assert.equal(pushedPickResult.message.payload.selector, "#submit");
assert.equal(pushedPickResult.message.targetNodeId, "n_click");

const cancelStartResponse = await dispatchRuntimeMessage(
  onMessageListener,
  {
    type: "RECORDER_PICKER_START",
    payload: { url: "https://example.com/cancel", nodeId: "n_click" }
  },
  requesterTabId
);
assert.equal(cancelStartResponse?.ok, true, "cancel scenario start should succeed");

const cancelResponse = await dispatchRuntimeMessage(
  onMessageListener,
  {
    type: "RECORDER_PICK_CANCELED",
    error: "user cancelled",
    stage: "cancelled"
  },
  cancelStartResponse.targetTabId
);
assert.equal(cancelResponse?.ok, true, "RECORDER_PICK_CANCELED should be accepted");

const pushedCancelError = chrome._sentMessages.find(
  item => item.tabId === requesterTabId && item.message?.type === "RECORDER_PUSH_PICK_ERROR"
);
assert.ok(pushedCancelError, "should route cancel error back to requester tab");
assert.equal(pushedCancelError.message.error, "user cancelled");
assert.equal(pushedCancelError.message.stage, "cancelled");

console.log("PASS picker_route_smoke");
