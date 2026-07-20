import type { Tender } from "../types";

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export function formatTenderDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date);
}

export function formatTenderValue(tender: Tender): string | null {
  if (tender.estimated_value == null) return null;

  const original = `${numberFormatter.format(Number(tender.estimated_value))} ${tender.currency || ""}`.trim();
  if (tender.estimated_value_eur != null && tender.currency !== "EUR") {
    return `${original} (≈ ${numberFormatter.format(Number(tender.estimated_value_eur))} EUR)`;
  }
  return original;
}

export function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
