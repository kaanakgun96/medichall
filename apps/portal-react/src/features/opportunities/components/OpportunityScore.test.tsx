import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OpportunityScore } from "./OpportunityScore";

describe("OpportunityScore", () => {
  it("renders an honest uncalculated state with the separate legacy match score", () => {
    const markup = renderToStaticMarkup(
      <OpportunityScore opportunityScore={null} matchScore={68} />,
    );

    expect(markup).toContain("Opportunity score");
    expect(markup).toContain("Not calculated · legacy match 68%");
  });
});
