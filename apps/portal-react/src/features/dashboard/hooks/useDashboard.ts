import { useEffect, useState } from "react";
import { fetchDashboardData } from "../api/dashboard-api";
import type { DashboardData, DashboardError } from "../types";
import { toDashboardError } from "../utils/dashboard-errors";

export function useDashboard(companyId: number) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState<DashboardError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setData(null);
    setError(null);

    void fetchDashboardData(companyId, controller.signal)
      .then((dashboardData) => {
        setData(dashboardData);
        setStatus("success");
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(toDashboardError(loadError));
        setStatus("error");
      });

    return () => controller.abort();
  }, [companyId, reloadKey]);

  return {
    data,
    status,
    error,
    retry: () => setReloadKey((key) => key + 1),
  };
}
