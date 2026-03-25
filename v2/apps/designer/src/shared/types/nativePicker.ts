import type { PickerResult } from "./picker";

export type NativePickerMessageType =
  | "ping"
  | "session_create"
  | "session_ready"
  | "pick_result"
  | "ack"
  | "cancel"
  | "error"
  | "heartbeat";

export type NativePickerSessionStatus =
  | "pending"
  | "ready"
  | "picking"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timeout";

export type NativePickerLaunchMode = "attach_existing" | "open_url";

export type NativePickerSession = {
  sessionId: string;
  status: NativePickerSessionStatus;
  nodeId: string;
  pageUrl: string;
  launchMode: NativePickerLaunchMode;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string | null;
  finishedAt?: string | null;
  requestedBy?: string | null;
  source: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  diagnostics: Record<string, unknown>;
};

export type NativePickerResultRecord = {
  sessionId: string;
  createdAt: string;
  consumedAt?: string | null;
  source: string;
  result: PickerResult;
};

export type NativePickerPullResultResponse = {
  found: boolean;
  result?: NativePickerResultRecord | null;
};

export type NativePickerMessageEnvelope = {
  schemaVersion?: string;
  type: NativePickerMessageType;
  requestId?: string;
  sessionId?: string;
  source?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
};

export type NativePickerMessageAck = {
  schemaVersion?: string;
  ok: boolean;
  requestId?: string;
  sessionId?: string;
  sessionStatus?: NativePickerSessionStatus;
  code?: string | null;
  message: string;
  details?: Record<string, unknown>;
  serverTime?: string;
};
