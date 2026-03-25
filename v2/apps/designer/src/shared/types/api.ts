export type JsonRecord = Record<string, unknown>;

export type ApiError = {
  code: string;
  message: string;
  details?: JsonRecord;
  requestId?: string;
};

export type ApiResult<T> = {
  ok: true;
  data: T;
} | {
  ok: false;
  error: ApiError;
};
