import { describe, expect, it } from "vitest";
import { routeFromHash, routeHref } from "./portal-routes";

describe("portal routes", () => {
  it("routes the migrated dashboard without changing the anonymous default", () => {
    expect(routeFromHash("#/dashboard")).toBe("dashboard");
    expect(routeFromHash("#/buyer-discovery")).toBe("buyer-discovery");
    expect(routeFromHash("#/all-tenders")).toBe("all-tenders");
    expect(routeFromHash("#/company-profile")).toBe("company-profile");
    expect(routeFromHash("#/unknown")).toBe("all-tenders");
    expect(routeHref("dashboard")).toBe("#/dashboard");
    expect(routeHref("buyer-discovery")).toBe("#/buyer-discovery");
    expect(routeHref("company-profile")).toBe("#/company-profile");
  });
});
