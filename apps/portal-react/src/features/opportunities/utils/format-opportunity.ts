import { safeExternalUrl } from "../../../shared/utils/safe-external-url";
import type { Opportunity, OpportunityTender } from "../types";

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export type DocumentMatchPresentation = {
  state: "scored" | "pending" | "queued" | "processing" | "failed" | "not-applicable";
  label: string;
  detail: string;
  score: number | null;
};

export function formatScore(score: number | null): string {
  return score === null ? "Not calculated" : `${Math.round(score)}%`;
}

export function formatOpportunityDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date);
}

export function formatOpportunityValue(tender: OpportunityTender): string | null {
  if (tender.estimatedValue === null) return null;
  const original = `${numberFormatter.format(tender.estimatedValue)} ${tender.currency || ""}`.trim();
  if (tender.estimatedValueEur !== null && tender.currency !== "EUR") {
    return `${original} (≈ ${numberFormatter.format(tender.estimatedValueEur)} EUR)`;
  }
  return original;
}

export function documentMatchPresentation(opportunity: Opportunity): DocumentMatchPresentation {
  const tender = opportunity.tender;
  if (!tender) {
    return {
      state: "not-applicable",
      label: "Not applicable",
      detail: "Document matching applies to tender opportunities.",
      score: null,
    };
  }

  const status = tender.documentAnalysisStatus;
  const hasDocumentEvidence = tender.analyzedDocumentCount > 0;
  if (
    (status === "completed" || status === "partial") &&
    hasDocumentEvidence &&
    opportunity.documentMatchScore !== null
  ) {
    return {
      state: "scored",
      label: formatScore(opportunity.documentMatchScore),
      detail: status === "partial" ? "Partial document evidence" : "Document evidence analyzed",
      score: opportunity.documentMatchScore,
    };
  }
  if (status === "queued") {
    return { state: "queued", label: "Queued", detail: "Document analysis is queued.", score: null };
  }
  if (status === "processing") {
    return { state: "processing", label: "In progress", detail: "Document analysis is running.", score: null };
  }
  if (status === "failed") {
    return { state: "failed", label: "Needs retry", detail: "The document request failed.", score: null };
  }
  return {
    state: "pending",
    label: "Pending",
    detail: "No analyzed document evidence exists yet.",
    score: null,
  };
}

export function safeOpportunitySourceUrl(opportunity: Opportunity): string | null {
  const value = opportunity.tender?.sourceUrl
    ?? opportunity.distributor?.sourceUrl
    ?? opportunity.distributor?.website
    ?? null;
  return safeExternalUrl(value);
}

export function opportunitySourceLabel(opportunity: Opportunity): string | null {
  if (opportunity.tender) {
    const values = [opportunity.tender.source, opportunity.tender.sourceNoticeId].filter(Boolean);
    return values.length ? values.join(" · ") : null;
  }
  return opportunity.distributor?.source ?? null;
}
