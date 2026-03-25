export type DesktopServiceStatus = {
  apiStatus: string;
  apiPort: number;
  agentStatus: string;
  agentMessage?: string | null;
  message?: string | null;
  apiPid?: number | null;
  apiManagedByDesktop: boolean;
  apiSupervisionEnabled: boolean;
  apiRestartCount: number;
  apiConsecutiveFailures: number;
  lastHealthCheckAtEpochMs?: number | null;
  agentSupervisionEnabled: boolean;
  agentConsecutiveFailures: number;
  agentRecoveryCount: number;
  lastAgentHealthCheckAtEpochMs?: number | null;
};

export type DesktopReleaseInfo = {
  version: string;
  identifier: string;
  buildProfile: string;
  diagnosticsDir: string;
  bundleOutputDir: string;
};

export type DesktopCloseBehavior = "ask" | "minimize_to_tray" | "exit";

export type DesktopPreferences = {
  closeBehavior: DesktopCloseBehavior;
  autostartEnabled: boolean;
  autostartSupported: boolean;
};

export type DesktopNativePickerHostStatus = {
  registered: boolean;
  hostName: string;
  extensionId: string;
  manifestPath?: string | null;
  hostExecutablePath?: string | null;
  lastError?: string | null;
};

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export function isDesktopRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const candidate = window as unknown as Record<string, unknown>;
  return (
    "__TAURI_INTERNALS__" in candidate ||
    "__TAURI__" in candidate ||
    (globalThis as unknown as { isTauri?: boolean }).isTauri === true
  );
}

async function getInvoke(): Promise<TauriInvoke | null> {
  if (typeof window === "undefined") {
    return null;
  }
  const api = await import("@tauri-apps/api/core");
  const candidate = window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } };
  if (typeof candidate.__TAURI_INTERNALS__?.invoke === "function") {
    return api.invoke as TauriInvoke;
  }
  if ((globalThis as unknown as { isTauri?: boolean }).isTauri === true) {
    return api.invoke as TauriInvoke;
  }
  return null;
}

export async function getDesktopServiceStatus(): Promise<DesktopServiceStatus | null> {
  const invoke = await getInvoke();
  if (!invoke) {
    return null;
  }
  return invoke<DesktopServiceStatus>("get_service_status");
}

export async function getDesktopApiBase(): Promise<string | null> {
  const invoke = await getInvoke();
  if (!invoke) {
    return null;
  }
  return invoke<string>("get_api_base");
}

export async function restartDesktopServices(): Promise<DesktopServiceStatus | null> {
  const invoke = await getInvoke();
  if (!invoke) {
    return null;
  }
  return invoke<DesktopServiceStatus>("restart_services");
}

export async function exportDesktopDiagnostics(): Promise<string | null> {
  const invoke = await getInvoke();
  if (!invoke) {
    return null;
  }
  return invoke<string>("export_diagnostics");
}

export async function getDesktopReleaseInfo(): Promise<DesktopReleaseInfo | null> {
  const invoke = await getInvoke();
  if (!invoke) {
    return null;
  }
  return invoke<DesktopReleaseInfo>("get_release_info");
}

export async function getDesktopPreferences(): Promise<DesktopPreferences | null> {
  const invoke = await getInvoke();
  if (!invoke) {
    return null;
  }
  return invoke<DesktopPreferences>("get_desktop_preferences");
}

export async function setDesktopCloseBehavior(
  closeBehavior: DesktopCloseBehavior
): Promise<DesktopPreferences | null> {
  const invoke = await getInvoke();
  if (!invoke) {
    return null;
  }
  return invoke<DesktopPreferences>("set_close_behavior", { behavior: closeBehavior });
}

export async function setDesktopAutostartEnabled(enabled: boolean): Promise<DesktopPreferences | null> {
  const invoke = await getInvoke();
  if (!invoke) {
    return null;
  }
  return invoke<DesktopPreferences>("set_autostart_enabled", { enabled });
}

export async function handleDesktopCloseDecision(decision: "minimize" | "exit"): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) {
    return;
  }
  await invoke("handle_close_decision", { decision });
}

export async function acknowledgeDesktopClosePrompt(): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) {
    return;
  }
  await invoke("acknowledge_close_prompt");
}

export async function getDesktopNativePickerHostStatus(): Promise<DesktopNativePickerHostStatus | null> {
  const invoke = await getInvoke();
  if (!invoke) {
    return null;
  }
  return invoke<DesktopNativePickerHostStatus>("get_native_picker_host_status");
}

export async function ensureDesktopNativePickerHostRegistered(): Promise<DesktopNativePickerHostStatus | null> {
  const invoke = await getInvoke();
  if (!invoke) {
    return null;
  }
  return invoke<DesktopNativePickerHostStatus>("ensure_native_picker_host_registered");
}
