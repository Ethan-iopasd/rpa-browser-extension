function getActiveTabId() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs[0];
      if (!tab || typeof tab.id !== "number") {
        reject(new Error("Active tab not found"));
        return;
      }
      resolve(tab.id);
    });
  });
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

function renderEvents(events) {
  const container = document.getElementById("events");
  if (!Array.isArray(events) || events.length === 0) {
    container.innerHTML = "<div class='event'>No events.</div>";
    return;
  }
  const html = events
    .slice()
    .reverse()
    .map(event => {
      const frameText = event.frame?.isTop ? "top" : "iframe";
      return `
      <div class="event">
        <div><strong>${event.action}</strong> @ ${formatTime(event.timestamp)} <em>[${frameText}]</em></div>
        <div><code>${event.selector || "unknown"}</code></div>
      </div>
    `;
    })
    .join("");
  container.innerHTML = html;
}

async function getState() {
  const tabId = await getActiveTabId();
  const state = await sendMessage({ type: "RECORDER_GET_STATE", tabId });
  return { activeTabId: tabId, state };
}

async function refreshState() {
  const statusEl = document.getElementById("status");
  try {
    const { activeTabId, state } = await getState();
    const sourceTab = state.latestRecorderTabId ?? state.tabId;
    statusEl.textContent = `Active ${activeTabId} | Source ${sourceTab ?? "-"} | Recording: ${
      state.recording ? "ON" : "OFF"
    } | Events: ${state.events.length}`;
    renderEvents(state.events);
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  }
}

async function startRecording() {
  const tabId = await getActiveTabId();
  await sendMessage({ type: "RECORDER_START", tabId });
  await refreshState();
}

async function stopRecording() {
  const tabId = await getActiveTabId();
  await sendMessage({ type: "RECORDER_STOP", tabId });
  await refreshState();
}

async function clearEvents() {
  const tabId = await getActiveTabId();
  await sendMessage({ type: "RECORDER_CLEAR", tabId });
  await refreshState();
}

async function getPayload() {
  const { tabId, state } = await getState();
  return {
    source: state.source,
    schemaVersion: state.schemaVersion,
    tabId,
    exportedAt: state.exportedAt,
    events: state.events
  };
}

async function exportEvents() {
  const payload = await getPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rpa-recorder-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyPayload() {
  const payload = await getPayload();
  const text = JSON.stringify(payload, null, 2);
  await navigator.clipboard.writeText(text);
}

async function pushToDesigner() {
  const targetTabId = await getActiveTabId();
  const state = await sendMessage({ type: "RECORDER_GET_STATE" });
  const sourceTabId = state.latestRecorderTabId ?? state.tabId;
  await sendMessage({ type: "RECORDER_PUSH_DESIGNER", targetTabId, sourceTabId });
}

document.getElementById("startBtn").addEventListener("click", () => {
  startRecording().catch(error => console.error(error));
});
document.getElementById("stopBtn").addEventListener("click", () => {
  stopRecording().catch(error => console.error(error));
});
document.getElementById("clearBtn").addEventListener("click", () => {
  clearEvents().catch(error => console.error(error));
});
document.getElementById("exportBtn").addEventListener("click", () => {
  exportEvents().catch(error => console.error(error));
});
document.getElementById("copyBtn").addEventListener("click", () => {
  copyPayload()
    .then(() => {
      document.getElementById("status").textContent = "Payload copied to clipboard.";
    })
    .catch(error => {
      document.getElementById("status").textContent = `Copy failed: ${error.message}`;
    });
});
document.getElementById("pushBtn").addEventListener("click", () => {
  pushToDesigner()
    .then(() => {
      document.getElementById("status").textContent = "Payload sent to current page.";
    })
    .catch(error => {
      document.getElementById("status").textContent = `Push failed: ${error.message}`;
    });
});

refreshState();
