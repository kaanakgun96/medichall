import { createElement } from "react";
import type { PortalRoute } from "../routing/portal-routes";

type PortalHeaderProps = {
  activeRoute: PortalRoute;
  legacyPortalUrl: string;
};

export function PortalHeader({ activeRoute, legacyPortalUrl }: PortalHeaderProps) {
  return createElement("medichall-header", {
    mode: "react",
    "active-route": activeRoute,
    "legacy-url": legacyPortalUrl,
  });
}
