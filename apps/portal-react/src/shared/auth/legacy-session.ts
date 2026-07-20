import { getPublicAppConfig } from "../config/env";

const ACCESS_TOKEN_KEY = "mh_p_token";
const REFRESH_TOKEN_KEY = "mh_p_refresh";

type RefreshedSession = {
  access_token?: string;
  refresh_token?: string;
};

let refreshInFlight: Promise<string | null> | null = null;

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The tender feed still works anonymously when storage is unavailable.
  }
}

export function getLegacyAccessToken(): string | null {
  return readStorage(ACCESS_TOKEN_KEY);
}

export function hasLegacySession(): boolean {
  return Boolean(readStorage(ACCESS_TOKEN_KEY) || readStorage(REFRESH_TOKEN_KEY));
}

export function clearLegacySession(): void {
  try {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // Nothing else to clear when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent("medichall:session-changed"));
}

export async function refreshLegacySession(signal?: AbortSignal): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = readStorage(REFRESH_TOKEN_KEY);
    if (!refreshToken) return null;

    const { supabaseUrl, supabasePublishableKey } = getPublicAppConfig();
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        apikey: supabasePublishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal,
    });

    if (!response.ok) {
      clearLegacySession();
      return null;
    }

    const session = (await response.json()) as RefreshedSession;
    if (!session.access_token) {
      clearLegacySession();
      return null;
    }

    writeStorage(ACCESS_TOKEN_KEY, session.access_token);
    if (session.refresh_token) writeStorage(REFRESH_TOKEN_KEY, session.refresh_token);
    window.dispatchEvent(new CustomEvent("medichall:session-changed"));
    return session.access_token;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}
