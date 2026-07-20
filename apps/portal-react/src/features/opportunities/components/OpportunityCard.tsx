import {
  AlertTriangle,
  Building2,
  CalendarDays,
  ExternalLink,
  Languages,
  MapPin,
  Tags,
} from "lucide-react";
import { Button } from "../../../shared/components/Button";
import type { Opportunity, OpportunityStatus } from "../types";
import {
  formatOpportunityDate,
  formatOpportunityValue,
  opportunitySourceLabel,
  safeOpportunitySourceUrl,
} from "../utils/format-opportunity";
import { MatchBreakdown } from "./MatchBreakdown";
import { MatchedReasons } from "./MatchedReasons";
import { MissingRequirements } from "./MissingRequirements";
import { OpportunityScore } from "./OpportunityScore";

type OpportunityCardProps = {
  opportunity: Opportunity;
  legacyPortalUrl: string;
  mutating: boolean;
  onStatusChange: (opportunity: Opportunity, status: OpportunityStatus) => void;
};

function readableStatus(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function OpportunityCard({
  opportunity,
  legacyPortalUrl,
  mutating,
  onStatusChange,
}: OpportunityCardProps) {
  const tender = opportunity.tender;
  const distributor = opportunity.distributor;
  const title = tender?.title ?? distributor?.name ?? "Opportunity";
  const country = tender?.countryName ?? distributor?.countryName;
  const sourceUrl = safeOpportunitySourceUrl(opportunity);
  const sourceLabel = opportunitySourceLabel(opportunity);
  const deadline = formatOpportunityDate(tender?.deadlineAt ?? null);
  const value = tender ? formatOpportunityValue(tender) : null;
  const missingRequirements = opportunity.missingInformation.length
    ? opportunity.missingInformation
    : tender?.missingInformation ?? [];
  const legacyOpportunityUrl = `${legacyPortalUrl.split("#")[0]}#opportunities`;
  const headingId = `opportunity-title-${opportunity.id}`;
  const saved = opportunity.status === "saved";

  const dismiss = () => {
    if (window.confirm(`Dismiss “${title}” from My Opportunities?`)) {
      onStatusChange(opportunity, "dismissed");
    }
  };

  return (
    <article className="opportunity-card" aria-labelledby={headingId}>
      <div className="opportunity-card__accent" aria-hidden="true" />
      <div className="opportunity-card__body">
        <div className="opportunity-card__top">
          <div className="opportunity-card__identity">
            <div className="opportunity-card__kicker">
              <span>{opportunity.kind === "tender" ? "Tender match" : "Distributor match"}</span>
              {tender?.noticeType ? <span>{tender.noticeType}</span> : null}
              {opportunity.status !== "new" ? <span>{readableStatus(opportunity.status)}</span> : null}
              {distributor?.verificationStatus ? (
                <span className={`verification verification--${distributor.verificationStatus}`}>
                  {readableStatus(distributor.verificationStatus)}
                </span>
              ) : null}
            </div>
            <h2 id={headingId}>{title}</h2>
            {tender?.titleEn && tender.titleEn !== tender.title ? (
              <p className="tender-card__translation">
                <Languages size={15} aria-hidden="true" />
                <span><strong>EN (machine translation):</strong> {tender.titleEn}</span>
              </p>
            ) : null}
            <dl className="opportunity-card__meta">
              {country ? <div><dt><MapPin size={15} aria-hidden="true" /> Country</dt><dd>{country}</dd></div> : null}
              {tender?.buyerName ? <div><dt><Building2 size={15} aria-hidden="true" /> Buyer</dt><dd>{tender.buyerName}</dd></div> : null}
              {distributor?.companyType ? <div><dt><Building2 size={15} aria-hidden="true" /> Type</dt><dd>{distributor.companyType}</dd></div> : null}
              {deadline ? <div><dt><CalendarDays size={15} aria-hidden="true" /> Deadline</dt><dd>{deadline}</dd></div> : null}
              {sourceLabel ? <div><dt>Source</dt><dd>{sourceLabel}</dd></div> : null}
            </dl>
          </div>
          <OpportunityScore
            opportunityScore={opportunity.opportunityScore}
            matchScore={opportunity.matchScore}
          />
        </div>

        {tender ? (
          <div className="opportunity-card__tender-data">
            <div className="cpv-list">
              <Tags size={15} aria-hidden="true" />
              {tender.cpvCodes.length
                ? tender.cpvCodes.slice(0, 5).map((code) => <span key={code}>{code}</span>)
                : <span>CPV not stated</span>}
            </div>
            <div className="tender-card__value">
              <span>Estimated value</span>
              <strong>{value || "Not stated"}</strong>
            </div>
          </div>
        ) : null}

        <MatchBreakdown opportunity={opportunity} />

        <div className="opportunity-card__explanation">
          <MatchedReasons reasons={opportunity.reasons} />
          <MissingRequirements requirements={missingRequirements} />
        </div>

        {opportunity.risks.length ? (
          <section className="opportunity-risks">
            <h3><AlertTriangle size={15} aria-hidden="true" /> Risk / verification indicators</h3>
            <ul>{opportunity.risks.map((risk, index) => <li key={`${risk}-${index}`}>{risk}</li>)}</ul>
          </section>
        ) : null}

        {opportunity.nextBestAction ? (
          <p className="next-best-action"><strong>Next best action:</strong> {opportunity.nextBestAction}</p>
        ) : null}

        <div className="opportunity-card__actions">
          {sourceUrl ? (
            <a className="button button--secondary button--small" href={sourceUrl} target="_blank" rel="noopener noreferrer">
              Open original source <ExternalLink size={14} aria-hidden="true" />
            </a>
          ) : null}
          <Button
            size="small"
            disabled={mutating}
            aria-label={`${saved ? "Remove saved status from" : "Save"} ${title}`}
            onClick={() => onStatusChange(opportunity, saved ? "viewed" : "saved")}
          >
            {saved ? "Saved" : "Save opportunity"}
          </Button>
          <Button
            size="small"
            disabled={mutating}
            aria-label={`Mark ${title} as contacted`}
            onClick={() => onStatusChange(opportunity, "contacted")}
          >
            {opportunity.status === "contacted" ? "Contacted" : "Mark contacted"}
          </Button>
          <Button tone="danger" size="small" disabled={mutating} onClick={dismiss}>
            Dismiss opportunity
          </Button>
          <a className="legacy-detail-link" href={legacyOpportunityUrl}>
            Profile, AI and document tools remain in the current portal
          </a>
        </div>
      </div>
    </article>
  );
}
