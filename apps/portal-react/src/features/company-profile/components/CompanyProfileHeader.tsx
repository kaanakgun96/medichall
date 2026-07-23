import { Building2, ShieldCheck, Target } from "lucide-react";
import type { CompanyProfileRecord } from "../types";

type CompanyProfileHeaderProps = {
  company?: CompanyProfileRecord | null;
};

export function CompanyProfileHeader({ company }: CompanyProfileHeaderProps) {
  return (
    <section className="hero company-profile-hero" aria-labelledby="company-profile-title">
      <div className="page-width hero__inner">
        <div className="hero__copy">
          <span className="eyebrow eyebrow--light">
            <Building2 size={14} aria-hidden="true" /> Manufacturer profile
          </span>
          <h1 id="company-profile-title">
            {company?.name ? `${company.name}.` : "Company profile."}
            <br />
            <span>Ready to be matched.</span>
          </h1>
          <p>
            Maintain the company and matching information already used by the
            Partner Portal, marketplace, and opportunity engine.
          </p>
        </div>
        <div className="hero__facts" aria-label="Company profile details">
          <div>
            <ShieldCheck size={19} aria-hidden="true" />
            <span>
              <strong>Owner and RLS protected</strong>
              Only the company owned by the current partner session is requested
            </span>
          </div>
          <div>
            <Target size={19} aria-hidden="true" />
            <span>
              <strong>Existing match contract</strong>
              Countries, keywords, CPVs, certifications, and preferences keep their production format
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
