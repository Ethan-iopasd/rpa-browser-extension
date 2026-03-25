import { invoke } from "@tauri-apps/api/core";
import "./styles.css";

type ServiceStatus = {
  apiStatus: string;
  apiPort: number;
  agentStatus: string;
  message?: string | null;
  apiPid?: number | null;
};

const apiStatusEl = document.querySelector<HTMLSpanElement>("#api-status");
const agentStatusEl = document.querySelector<HTMLSpanElement>("#agent-status");
const messageEl = document.querySelector<HTMLSpanElement>("#status-message");
const startButton = document.querySelector<HTMLButtonElement>("#start-services");
const refreshButton = document.querySelector<HTMLButtonElement>("#refresh-status");

function renderStatus(status: ServiceStatus): void {
  if (apiStatusEl) {
    apiStatusEl.textContent = status.apiStatus;
  }
  if (agentStatusEl) {
    agentStatusEl.textContent = status.agentStatus;
  }
  if (messageEl) {
    const details = [`port: ${status.apiPort}`];
    if (status.apiPid) {
      details.push(`api pid: ${status.apiPid}`);
    }
    messageEl.textContent = `${status.message ?? "-"} (${details.join(", ")})`;
  }
}

async function refreshStatus(): Promise<void> {
  const status = await invoke<ServiceStatus>("get_service_status");
  renderStatus(status);
}

async function startServices(): Promise<void> {
  if (startButton) {
    startButton.disabled = true;
  }
  try {
    const status = await invoke<ServiceStatus>("start_services");
    renderStatus(status);
  } finally {
    if (startButton) {
      startButton.disabled = false;
    }
  }
}

if (startButton) {
  startButton.addEventListener("click", () => {
    void startServices();
  });
}

if (refreshButton) {
  refreshButton.addEventListener("click", () => {
    void refreshStatus();
  });
}

void refreshStatus();
