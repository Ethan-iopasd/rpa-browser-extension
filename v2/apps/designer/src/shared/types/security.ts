export type CredentialSummary = {
  credentialId: string;
  name: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CredentialListResponse = {
  total: number;
  credentials: CredentialSummary[];
};

export type CredentialSecretResponse = {
  credentialId: string;
  name: string;
  value: string;
  updatedAt: string;
};

export type AuditRecord = {
  auditId: string;
  action: string;
  actor: string;
  target: string;
  timestamp: string;
  metadata: Record<string, unknown>;
};

export type AuditListResponse = {
  total: number;
  records: AuditRecord[];
};
