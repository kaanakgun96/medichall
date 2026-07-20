export type TenderFilters = {
  query: string;
  country: string;
  cpv: string;
  noticeType: string;
  deadlineWithinDays: number | null;
  valueMinEur: number | null;
  valueMaxEur: number | null;
  includeUnknownValue: boolean;
};

export type Tender = {
  id: number;
  title: string | null;
  title_en: string | null;
  buyer_name: string | null;
  country_name: string | null;
  publication_date: string | null;
  deadline_at: string | null;
  estimated_value: number | null;
  currency: string | null;
  estimated_value_eur: number | null;
  eur_rate_as_of: string | null;
  cpv_codes: string[] | null;
  notice_type: string | null;
  source_url: string | null;
  total_count: number | string | null;
};

export type TenderFacets = {
  countries: string[];
  notice_types: string[];
  currencies: string[];
  fx_as_of: string | null;
};

export type CpvCatalogItem = {
  code: string;
  code_full: string;
  label_en: string;
  depth: number;
  parent_code: string | null;
  open_tender_count: number | string | null;
};
