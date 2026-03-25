import type { RunEvent } from "@rpa/flow-schema/generated/types";

import type { ApiError } from "../types/api";

export type RunFailureKind = "browser-startup" | "page-timeout" | "element-not-found";

export type RunFailureHint = {
  kind: RunFailureKind;
  code: string;
  title: string;
  description: string;
  suggestion: string;
  nodeId?: string;
  reason?: string;
};

const FAILURE_HINTS: Record<string, Omit<RunFailureHint, "code" | "nodeId" | "reason">> = {
  BROWSER_STARTUP_FAILED: {
    kind: "browser-startup",
    title: "浏览器启动失败",
    description: "执行引擎无法拉起真实浏览器进程。",
    suggestion: "检查 Playwright/Chromium 安装、系统权限或沙箱策略后重试。"
  },
  PAGE_TIMEOUT: {
    kind: "page-timeout",
    title: "页面超时",
    description: "页面加载或网络等待超时。",
    suggestion: "确认目标地址可访问，并适当提高 timeoutMs/defaultTimeoutMs。"
  },
  ELEMENT_NOT_FOUND: {
    kind: "element-not-found",
    title: "元素未找到",
    description: "节点执行时未命中目标元素或选择器。",
    suggestion: "检查 selector / selectorCandidates，或先加等待节点。"
  }
};

export function detectRunFailureHint(
  runEvents: RunEvent[],
  runState: unknown,
  panelError?: string
): RunFailureHint | null {
  const eventHint = fromEvents(runEvents);
  if (eventHint) {
    return eventHint;
  }

  const stateHint = fromRunState(runState);
  if (stateHint) {
    return stateHint;
  }

  const textHint = fromText(panelError);
  if (textHint) {
    return textHint;
  }

  return null;
}

function fromEvents(events: RunEvent[]): RunFailureHint | null {
  for (const event of events) {
    const code = typeof event.data?.errorCode === "string" ? event.data.errorCode : null;
    if (!code) {
      continue;
    }
    const base = FAILURE_HINTS[code];
    if (!base) {
      continue;
    }
    const reason = typeof event.data?.details === "object" && event.data?.details
      ? readReason(event.data.details as Record<string, unknown>)
      : undefined;
    return {
      ...base,
      code,
      nodeId: event.nodeId,
      reason
    };
  }
  return null;
}

function fromRunState(runState: unknown): RunFailureHint | null {
  if (!isApiError(runState)) {
    return null;
  }
  const direct = FAILURE_HINTS[runState.code];
  if (direct) {
    return {
      ...direct,
      code: runState.code,
      reason: readReason(runState.details)
    };
  }
  if (Array.isArray(runState.details?.errors)) {
    for (const item of runState.details.errors) {
      if (typeof item !== "string") {
        continue;
      }
      const hint = fromText(item);
      if (hint) {
        return hint;
      }
    }
  }
  return null;
}

function fromText(text: string | undefined): RunFailureHint | null {
  if (!text) {
    return null;
  }
  for (const code of Object.keys(FAILURE_HINTS)) {
    if (text.includes(code)) {
      const base = FAILURE_HINTS[code];
      if (!base) {
        continue;
      }
      return {
        ...base,
        code
      };
    }
  }
  return null;
}

function isApiError(value: unknown): value is ApiError {
  return !!value && typeof value === "object" && "code" in value && "message" in value;
}

function readReason(details: Record<string, unknown> | undefined): string | undefined {
  if (!details) {
    return undefined;
  }
  if (typeof details.reason === "string" && details.reason) {
    return details.reason;
  }
  if (typeof details.details === "object" && details.details) {
    const nested = details.details as Record<string, unknown>;
    if (typeof nested.reason === "string" && nested.reason) {
      return nested.reason;
    }
  }
  return undefined;
}
