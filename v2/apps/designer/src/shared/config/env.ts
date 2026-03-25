type RuntimeConfig = {
  apiBase?: string;
};

declare global {
  interface Window {
    __RPA_RUNTIME_CONFIG__?: RuntimeConfig;
  }
}

const DEFAULT_API_BASE = "http://127.0.0.1:8000/api/v1";

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveApiBase(): string {
  if (typeof window !== "undefined") {
    const runtimeApiBase = window.__RPA_RUNTIME_CONFIG__?.apiBase;
    if (runtimeApiBase && runtimeApiBase.trim().length > 0) {
      return normalizeBaseUrl(runtimeApiBase.trim());
    }
  }

  const envApiBase = import.meta.env.VITE_API_BASE;
  if (typeof envApiBase === "string" && envApiBase.trim().length > 0) {
    return normalizeBaseUrl(envApiBase.trim());
  }

  return DEFAULT_API_BASE;
}

export const API_BASE = resolveApiBase();
