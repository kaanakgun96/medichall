/* MedicHall shared production UI safety and request coordination helpers. */
(function (global) {
  "use strict";

  const flights = new Map();
  const pollers = new Map();
  const SAFE_CODES = new Set([
    "AUTH_NETWORK", "AUTH_SESSION_EXPIRED", "ADMIN_PERMISSION", "HTTP_400", "HTTP_401",
    "HTTP_403", "HTTP_404", "HTTP_409", "HTTP_422", "HTTP_429", "HTTP_500",
    "HTTP_502", "HTTP_503", "HTTP_504", "23505", "40001", "42501", "PGRST202",
  ]);

  function normalizedCode(error) {
    const candidate = String(error?.code || "").trim().toUpperCase();
    return SAFE_CODES.has(candidate) ? candidate : "REQUEST_FAILED";
  }

  function normalizedStatus(error) {
    const value = Number(error?.status || 0);
    return Number.isInteger(value) && value >= 400 && value <= 599 ? value : 0;
  }

  function category(error) {
    const code = normalizedCode(error);
    const status = normalizedStatus(error);
    const name = String(error?.name || "");
    const raw = String(error?.message || "").toLowerCase();
    if (name === "AbortError") return "cancelled";
    if (code.startsWith("AUTH_") || status === 401) return "authentication";
    if (code === "ADMIN_PERMISSION" || code === "42501" || status === 403) return "permission";
    if (code === "23505" || status === 409) return "conflict";
    if (code === "40001") return "concurrency";
    if (status === 429) return "rate_limit";
    if (status >= 500) return "service";
    if (status === 400 || status === 422) return "validation";
    if (raw.includes("failed to fetch") || raw.includes("network") || raw.includes("offline")) return "network";
    return "request";
  }

  function errorMessage(error, fallback) {
    const kind = category(error);
    const code = normalizedCode(error);
    const status = normalizedStatus(error);
    if (kind === "cancelled") return "The request was cancelled.";
    if (kind === "authentication") return "Your session has expired. Please log in again.";
    if (kind === "permission") return "You do not have permission to complete this action.";
    if (kind === "conflict") return "This record already exists or was updated elsewhere. Refresh and try again.";
    if (kind === "concurrency") return "This record changed while you were working. Refresh and try again.";
    if (kind === "rate_limit") return "Too many attempts. Please wait a moment and try again.";
    if (kind === "network") return "We could not reach MedicHall. Check your connection and try again.";
    if (kind === "service") return "MedicHall is temporarily unavailable. Please try again shortly.";
    if (kind === "validation") return "Some information could not be accepted. Check the fields and try again.";
    if (code === "PGRST202" || status === 404) return "This feature is not available right now. Please try again later.";
    return fallback || "We could not complete that request. Please try again.";
  }

  function report(context, error) {
    console.error("MedicHall request failed", {
      context: String(context || "request").replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 80),
      category: category(error),
      code: normalizedCode(error),
      status: normalizedStatus(error) || undefined,
    });
  }

  function safeError(context, error, fallback) {
    report(context, error);
    return errorMessage(error, fallback);
  }

  function httpError(response, payload) {
    const error = new Error("Request failed");
    error.status = Number(response?.status || 0);
    const providerCode = String(payload?.code || payload?.error_code || "").toUpperCase();
    error.code = SAFE_CODES.has(providerCode) ? providerCode : `HTTP_${error.status || 500}`;
    return error;
  }

  function singleFlight(key, task) {
    const flightKey = String(key || "request");
    if (flights.has(flightKey)) return flights.get(flightKey);
    const promise = Promise.resolve().then(task).finally(() => flights.delete(flightKey));
    flights.set(flightKey, promise);
    return promise;
  }

  function startPoll(key, task, intervalMs, options = {}) {
    const pollKey = String(key || "poll");
    stopPoll(pollKey);
    let active = true;
    let timer = 0;
    const schedule = () => {
      if (!active) return;
      timer = global.setTimeout(run, Math.max(5000, Number(intervalMs) || 30000));
    };
    const run = async () => {
      if (!active) return;
      if (document.visibilityState === "hidden") {
        schedule();
        return;
      }
      try {
        await singleFlight(`poll:${pollKey}`, task);
      } catch (error) {
        if (!options.silent) report(`poll:${pollKey}`, error);
      } finally {
        schedule();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && active) run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const stop = () => {
      active = false;
      global.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      pollers.delete(pollKey);
    };
    pollers.set(pollKey, stop);
    if (options.immediate === false) schedule(); else run();
    return stop;
  }

  function stopPoll(key) {
    const stop = pollers.get(String(key || "poll"));
    if (stop) stop();
  }

  function setBusy(button, busy, label) {
    if (!(button instanceof HTMLElement)) return;
    if (busy) {
      if (!button.dataset.mhLabel) button.dataset.mhLabel = button.textContent || "";
      button.setAttribute("aria-busy", "true");
      if ("disabled" in button) button.disabled = true;
      button.textContent = label || "Working…";
      return;
    }
    button.removeAttribute("aria-busy");
    if ("disabled" in button) button.disabled = false;
    button.textContent = button.dataset.mhLabel || button.textContent;
    delete button.dataset.mhLabel;
  }

  global.MedicHallUI = Object.freeze({
    errorMessage, safeError, report, httpError, singleFlight, startPoll, stopPoll, setBusy,
  });
})(globalThis);
