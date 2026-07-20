import { Building2, CalendarDays, ExternalLink, Languages, MapPin, Tags } from "lucide-react";
import type { Tender } from "../types";
import { formatTenderDate, formatTenderValue, safeExternalUrl } from "../utils/format-tender";

type TenderCardProps = {
  tender: Tender;
};

export function TenderCard({ tender }: TenderCardProps) {
  const deadline = formatTenderDate(tender.deadline_at);
  const publicationDate = formatTenderDate(tender.publication_date);
  const value = formatTenderValue(tender);
  const sourceUrl = safeExternalUrl(tender.source_url);
  const cpvCodes = tender.cpv_codes?.slice(0, 4) ?? [];

  return (
    <article className="tender-card">
      <div className="tender-card__accent" aria-hidden="true" />
      <div className="tender-card__body">
        <div className="tender-card__heading">
          <div>
            <div className="tender-card__kicker">
              <span>Tender · feed</span>
              {tender.notice_type ? <span>{tender.notice_type}</span> : null}
            </div>
            <h2>{tender.title || "Tender"}</h2>
            {tender.title_en && tender.title_en !== tender.title ? (
              <p className="tender-card__translation">
                <Languages size={15} aria-hidden="true" />
                <span><strong>EN (machine translation):</strong> {tender.title_en}</span>
              </p>
            ) : null}
          </div>
          {sourceUrl ? (
            <a className="source-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">
              Open source <ExternalLink size={15} aria-hidden="true" />
            </a>
          ) : null}
        </div>

        <dl className="tender-card__meta">
          {tender.country_name ? (
            <div><dt><MapPin size={15} aria-hidden="true" /><span className="sr-only">Country</span></dt><dd>{tender.country_name}</dd></div>
          ) : null}
          {tender.buyer_name ? (
            <div><dt><Building2 size={15} aria-hidden="true" /><span className="sr-only">Buyer</span></dt><dd>{tender.buyer_name}</dd></div>
          ) : null}
          {deadline ? (
            <div><dt><CalendarDays size={15} aria-hidden="true" /><span>Deadline</span></dt><dd>{deadline}</dd></div>
          ) : null}
          {publicationDate ? (
            <div className="tender-card__published"><dt>Published</dt><dd>{publicationDate}</dd></div>
          ) : null}
        </dl>

        <div className="tender-card__footer">
          <div className="cpv-list">
            <Tags size={15} aria-hidden="true" />
            {cpvCodes.length ? cpvCodes.map((code) => <span key={code}>{code}</span>) : <span>CPV not stated</span>}
          </div>
          <div className="tender-card__value">
            <span>Estimated value</span>
            <strong>{value || "Not stated"}</strong>
          </div>
        </div>
      </div>
    </article>
  );
}
