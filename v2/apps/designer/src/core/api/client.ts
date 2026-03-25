import { API_BASE } from "../../shared/config/env";
import { getDesktopApiBase, isDesktopRuntime } from "../../shared/desktop/bridge";
import type { ApiError, ApiResult } from "../../shared/types/api";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

async function parseJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function asApiError(payload: unknown, statusText: string): ApiError {
  if (payload && typeof payload === "object" && "code" in payload && "message" in payload) {
    return payload as ApiError;
  }
  return {
    code: "UNEXPECTED_ERROR",
    message: statusText || "Unknown API error",
    details: {}
  };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

async function resolveApiBaseForRequest(): Promise<string> {
  if (!isDesktopRuntime()) {
    return API_BASE;
  }

  if (typeof window !== "undefined") {
    const runtimeApiBase = window.__RPA_RUNTIME_CONFIG__?.apiBase;
    if (typeof runtimeApiBase === "string" && runtimeApiBase.trim()) {
      return normalizeBaseUrl(runtimeApiBase.trim());
    }
  }

  try {
    const desktopApiBase = await getDesktopApiBase();
    if (typeof desktopApiBase === "string" && desktopApiBase.trim()) {
      return normalizeBaseUrl(desktopApiBase.trim());
    }
  } catch {
    // Fallback to static base below.
  }

  return API_BASE;
}

function asNetworkError(error: unknown, requestUrl: string): ApiError {
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      code: "NETWORK_TIMEOUT",
      message: "API request timed out.",
      details: {
        requestUrl,
        timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS
      }
    };
  }
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message.trim()
      : "Unable to reach API service.";
  return {
    code: "NETWORK_ERROR",
    message,
    details: {
      requestUrl
    }
  };
}

async function fetchWithTimeout(requestUrl: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(requestUrl, {
      ...init,
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function apiPost<TRequest extends object, TResponse>(
  path: string,
  body: TRequest
): Promise<ApiResult<TResponse>> {
  const apiBase = await resolveApiBaseForRequest();
  const requestUrl = `${apiBase}${path}`;
  let response: Response;
  try {
    response = await fetchWithTimeout(requestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (error) {
    return {
      ok: false,
      error: asNetworkError(error, requestUrl)
    };
  }
  const payload = await parseJson<TResponse | ApiError>(response);
  if (!response.ok) {
    return {
      ok: false,
      error: asApiError(payload, response.statusText)
    };
  }
  return { ok: true, data: (payload ?? {}) as TResponse };
}

export async function apiGet<TResponse>(path: string): Promise<ApiResult<TResponse>> {
  const apiBase = await resolveApiBaseForRequest();
  const requestUrl = `${apiBase}${path}`;
  let response: Response;
  try {
    response = await fetchWithTimeout(requestUrl, {
      method: "GET"
    });
  } catch (error) {
    return {
      ok: false,
      error: asNetworkError(error, requestUrl)
    };
  }
  const payload = await parseJson<TResponse | ApiError>(response);
  if (!response.ok) {
    return {
      ok: false,
      error: asApiError(payload, response.statusText)
    };
  }
  return { ok: true, data: (payload ?? {}) as TResponse };
}

export async function apiPatch<TRequest extends object, TResponse>(
  path: string,
  body: TRequest
): Promise<ApiResult<TResponse>> {
  const apiBase = await resolveApiBaseForRequest();
  const requestUrl = `${apiBase}${path}`;
  let response: Response;
  try {
    response = await fetchWithTimeout(requestUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (error) {
    return {
      ok: false,
      error: asNetworkError(error, requestUrl)
    };
  }
  const payload = await parseJson<TResponse | ApiError>(response);
  if (!response.ok) {
    return {
      ok: false,
      error: asApiError(payload, response.statusText)
    };
  }
  return { ok: true, data: (payload ?? {}) as TResponse };
}

export async function apiDelete<TResponse>(path: string): Promise<ApiResult<TResponse>> {
  const apiBase = await resolveApiBaseForRequest();
  const requestUrl = `${apiBase}${path}`;
  let response: Response;
  try {
    response = await fetchWithTimeout(requestUrl, {
      method: "DELETE"
    });
  } catch (error) {
    return {
      ok: false,
      error: asNetworkError(error, requestUrl)
    };
  }
  const payload = await parseJson<TResponse | ApiError>(response);
  if (!response.ok) {
    return {
      ok: false,
      error: asApiError(payload, response.statusText)
    };
  }
  return { ok: true, data: (payload ?? {}) as TResponse };
}
