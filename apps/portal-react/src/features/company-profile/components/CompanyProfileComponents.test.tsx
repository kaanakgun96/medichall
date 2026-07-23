import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CompanyProfileRecord } from "../types";
import { CompanyProfileHeader } from "./CompanyProfileHeader";
import { ProfileSaveBar } from "./ProfileSaveBar";

const company: CompanyProfileRecord = {
  id: 17,
  name: '<script>alert("unsafe")</script>',
  type: null,
  description: null,
  website: null,
  country: null,
  city: null,
  contactEmail: null,
  phone: null,
  certifications: null,
  videoUrl: null,
  isApproved: false,
  isVerified: false,
  slug: null,
  createdAt: null,
  updatedAt: null,
};

describe("company profile components", () => {
  it("renders backend-provided company text safely", () => {
    const markup = renderToStaticMarkup(<CompanyProfileHeader company={company} />);
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
  });

  it("reports save success through an accessible live status", () => {
    const markup = renderToStaticMarkup(
      <ProfileSaveBar
        dirty={false}
        feedback={{ status: "success", message: "Company profile saved." }}
        buttonLabel="Save company details"
      />,
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Company profile saved.");
    expect(markup).toContain("disabled");
  });
});
