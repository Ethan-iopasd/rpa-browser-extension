import { apiGet, apiPost } from "./client";
import type {
  NativePickerLaunchMode,
  NativePickerPullResultResponse,
  NativePickerSession
} from "../../shared/types/nativePicker";

export type StartPickerSessionPayload = {
  nodeId: string;
  url?: string;
  launchMode?: NativePickerLaunchMode;
  timeoutMs?: number;
  requestedBy?: string;
};

export type PickerSessionRecord = NativePickerSession;

export function startPickerSessionRequest(payload: StartPickerSessionPayload) {
  return apiPost<
    {
      nodeId: string;
      pageUrl?: string;
      launchMode: NativePickerLaunchMode;
      timeoutMs: number;
      requestedBy: string;
      source: string;
    },
    PickerSessionRecord
  >("/native-picker/sessions", {
    launchMode: payload.launchMode ?? "attach_existing",
    nodeId: payload.nodeId,
    ...(payload.url && payload.url.trim() ? { pageUrl: payload.url.trim() } : {}),
    timeoutMs: payload.timeoutMs ?? 180_000,
    requestedBy: payload.requestedBy ?? "designer",
    source: "designer"
  });
}

export function getPickerSessionRequest(sessionId: string) {
  return apiGet<PickerSessionRecord>(`/native-picker/sessions/${sessionId}`);
}

export function cancelPickerSessionRequest(sessionId: string) {
  return apiPost<{ actor: string; reason: string }, PickerSessionRecord>(
    `/native-picker/sessions/${sessionId}/cancel`,
    {
      actor: "designer",
      reason: "cancelled_by_user"
    }
  );
}

export function pullPickerSessionResultRequest(sessionId: string) {
  return apiGet<NativePickerPullResultResponse>(
    `/native-picker/results/pull?sessionId=${encodeURIComponent(sessionId)}`
  );
}
