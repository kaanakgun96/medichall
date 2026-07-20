import {
  clearLegacySession,
  getLegacyAccessToken,
  hasLegacySession,
  refreshLegacySession,
} from "../auth/legacy-session";
import { getPublicAppConfig } from "../config/env";

type SupabaseErrorBody = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

export class SupabaseApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: string;

  constructor(message: string, status: number, body?: SupabaseErrorBody) {
    super(message);
    this.name = "SupabaseApiError";
    this.status = status;
    this.code = body?.code;
    this.details = body?.details;
  }
}

type SupabaseRequestOptions = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
  retrySession?: boolean;
};

async function errorFromResponse(response: Response): Promise<SupabaseApiError> {
  const raw = await response.text();
  let body: SupabaseErrorBody | undefined;
  try {
    body = JSON.parse(raw) as SupabaseErrorBody;
  } catch {
    body = undefined;
  }

  const message = body?.message || body?.details || raw || `Supabase request failed (${response.status})`;
  return new SupabaseApiError(message, response.status, body);
}

export async function supabaseRequest<T>(
  path: string,
  options: SupabaseRequestOptions = {},
): Promise<T> {
  const { supabaseUrl, supabasePublishableKey } = getPublicAppConfig();
  const { retrySession = true, headers, ...requestInit } = options;
  let token = getLegacyAccessToken();

  if (!token && retrySession && hasLegacySession()) {
    token = await refreshLegacySession(options.signal ?? undefined);
  }

  const response = await fetch(`${supabaseUrl}${path}`, {
    ...requestInit,
    headers: {
      apikey: supabasePublishableKey,
      Authorization: `Bearer ${token || supabasePublishableKey}`,
      "Content-Type": "application/json",
      ...headers,
    },
  });

  if (response.status === 401 && token && retrySession) {
    const refreshedToken = await refreshLegacySession(options.signal ?? undefined);
    if (refreshedToken) {
      return supabaseRequest<T>(path, { ...options, retrySession: false });
    }
    clearLegacySession();
  }

  if (!response.ok) throw await errorFromResponse(response);
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function postRpc<T>(
  functionName: string,
  parameters: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  return supabaseRequest<T>(`/rest/v1/rpc/${functionName}`, {
    method: "POST",
    body: JSON.stringify(parameters),
    signal,
  });
}
