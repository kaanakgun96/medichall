/* MedicHall canonical legacy-session compatibility layer. */
(function (global) {
  "use strict";

  const ACCESS_KEY = "mh_p_token";
  const REFRESH_KEY = "mh_p_refresh";
  let configuration = null;
  let refreshPromise = null;
  let userPromise = null;

  function sessionError(code, message, status) {
    const error = new Error(message);
    error.code = code;
    if (status) error.status = status;
    return error;
  }

  function configure(options) {
    const url = String(options?.url || "").replace(/\/$/, "");
    const key = String(options?.key || "");
    const fetchImpl = options?.fetch || global.fetch?.bind(global);
    if (!url || !key || typeof fetchImpl !== "function") {
      throw sessionError("AUTH_CONFIG_MISSING", "Authentication configuration is unavailable.");
    }
    configuration = { url, key, fetchImpl };
    return api;
  }

  function requireConfiguration() {
    if (!configuration) {
      throw sessionError("AUTH_CONFIG_MISSING", "Authentication configuration is unavailable.");
    }
    return configuration;
  }

  function accessToken() {
    return global.localStorage?.getItem(ACCESS_KEY) || null;
  }

  function refreshToken() {
    return global.localStorage?.getItem(REFRESH_KEY) || null;
  }

  function hasStoredSession() {
    return Boolean(accessToken() || refreshToken());
  }

  function persist(session) {
    if (!session?.access_token) {
      throw sessionError("AUTH_MALFORMED_RESPONSE", "The authentication service returned an invalid session.");
    }
    global.localStorage?.setItem(ACCESS_KEY, session.access_token);
    if (session.refresh_token) global.localStorage?.setItem(REFRESH_KEY, session.refresh_token);
    return session.access_token;
  }

  function clear() {
    global.localStorage?.removeItem(ACCESS_KEY);
    global.localStorage?.removeItem(REFRESH_KEY);
    refreshPromise = null;
    userPromise = null;
  }

  async function jsonBody(response) {
    try {
      return await response.json();
    } catch (_) {
      return {};
    }
  }

  function classifyAuthFailure(status, data) {
    const providerCode = String(data?.error_code || data?.code || "").toLowerCase();
    const providerMessage = String(
      data?.error_description || data?.msg || data?.message || data?.error || "",
    ).toLowerCase();
    if (status === 400 && (
      providerCode === "invalid_credentials" ||
      providerMessage.includes("invalid login credentials") ||
      providerMessage.includes("invalid credentials")
    )) {
      return { code: "AUTH_INVALID_CREDENTIALS", message: "Invalid email or password." };
    }
    if (providerMessage.includes("email not confirmed")) {
      return { code: "AUTH_EMAIL_UNCONFIRMED", message: "Please confirm your email before logging in." };
    }
    if (status === 429) {
      return { code: "AUTH_RATE_LIMITED", message: "Too many login attempts. Please wait and try again." };
    }
    if (status === 401) {
      return { code: "AUTH_SESSION_EXPIRED", message: "Your session has expired. Please log in again." };
    }
    return { code: "AUTH_SERVICE_ERROR", message: "The authentication service is temporarily unavailable." };
  }

  async function signIn(credentials) {
    const { url, key, fetchImpl } = requireConfiguration();
    const timeoutMs = Number(credentials?.timeoutMs) > 0 ? Number(credentials.timeoutMs) : 15000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        signal: controller.signal,
        headers: { apikey: key, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(credentials?.email || "").trim(),
          password: String(credentials?.password || ""),
        }),
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw sessionError("AUTH_TIMEOUT", "The login request timed out.");
      }
      throw sessionError("AUTH_NETWORK", "Unable to reach the authentication service.");
    } finally {
      clearTimeout(timer);
    }
    const data = await jsonBody(response);
    if (!response.ok) {
      const failure = classifyAuthFailure(response.status, data);
      throw sessionError(failure.code, failure.message, response.status);
    }
    if (!data?.access_token || !data?.user?.id) {
      throw sessionError("AUTH_MALFORMED_RESPONSE", "The authentication service returned an invalid response.");
    }
    persist(data);
    return data;
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    const token = refreshToken();
    if (!token) return false;
    const { url, key, fetchImpl } = requireConfiguration();
    refreshPromise = (async () => {
      let response;
      try {
        response = await fetchImpl(`${url}/auth/v1/token?grant_type=refresh_token`, {
          method: "POST",
          headers: { apikey: key, "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: token }),
        });
      } catch (_) {
        throw sessionError("AUTH_NETWORK", "Unable to refresh the current session.");
      }
      const data = await jsonBody(response);
      if (!response.ok || !data?.access_token) {
        if (response.status === 400 || response.status === 401) clear();
        return false;
      }
      persist(data);
      return true;
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  async function request(path, options = {}, control = {}) {
    const { url, key, fetchImpl } = requireConfiguration();
    const authenticated = control.authenticated !== false;
    const execute = () => {
      const token = authenticated ? accessToken() : null;
      return fetchImpl(`${url}${path}`, {
        ...options,
        headers: {
          ...(options.headers || {}),
          apikey: key,
          Authorization: `Bearer ${token || key}`,
        },
      });
    };
    let response;
    try {
      response = await execute();
    } catch (_) {
      throw sessionError("AUTH_NETWORK", "Unable to reach the MedicHall service.");
    }
    if (authenticated && response.status === 401 && control.retry !== false) {
      const refreshed = await refresh();
      if (refreshed) {
        try {
          response = await execute();
        } catch (_) {
          throw sessionError("AUTH_NETWORK", "Unable to reach the MedicHall service.");
        }
      }
    }
    return response;
  }

  async function getUser() {
    if (userPromise) return userPromise;
    userPromise = (async () => {
      const response = await request("/auth/v1/user");
      const data = await jsonBody(response);
      if (!response.ok) {
        if (response.status === 401) clear();
        const failure = classifyAuthFailure(response.status, data);
        throw sessionError(failure.code, failure.message, response.status);
      }
      if (!data?.id) {
        throw sessionError("AUTH_MALFORMED_RESPONSE", "The authentication service returned an invalid user.");
      }
      return data;
    })().finally(() => {
      userPromise = null;
    });
    return userPromise;
  }

  const api = Object.freeze({
    ACCESS_KEY,
    REFRESH_KEY,
    configure,
    accessToken,
    refreshToken,
    hasStoredSession,
    persist,
    clear,
    signIn,
    refresh,
    request,
    getUser,
    classifyAuthFailure,
  });

  global.MedicHallSession = api;
})(globalThis);
