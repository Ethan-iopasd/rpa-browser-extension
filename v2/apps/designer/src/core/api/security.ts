import type {
  AuditListResponse,
  CredentialListResponse,
  CredentialSecretResponse,
  CredentialSummary
} from "../../shared/types/security";
import { apiGet, apiPost } from "./client";

export function createCredentialRequest(payload: {
  name: string;
  value: string;
  description?: string;
}) {
  return apiPost<{ name: string; value: string; description?: string }, CredentialSummary>(
    "/security/credentials",
    payload
  );
}

export function listCredentialsRequest(query: { limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams();
  if (typeof query.limit === "number") {
    params.set("limit", String(query.limit));
  }
  if (typeof query.offset === "number") {
    params.set("offset", String(query.offset));
  }
  const suffix = params.toString();
  return apiGet<CredentialListResponse>(`/security/credentials${suffix ? `?${suffix}` : ""}`);
}

export function getCredentialSecretRequest(credentialId: string) {
  return apiGet<CredentialSecretResponse>(`/security/credentials/${credentialId}/secret`);
}

export function listAuditRecordsRequest(query: { limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams();
  if (typeof query.limit === "number") {
    params.set("limit", String(query.limit));
  }
  if (typeof query.offset === "number") {
    params.set("offset", String(query.offset));
  }
  const suffix = params.toString();
  return apiGet<AuditListResponse>(`/security/audit${suffix ? `?${suffix}` : ""}`);
}
