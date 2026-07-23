import { useMemo } from "react";
import { StatePanel } from "../../../shared/components/StatePanel";
import { useCompanyProfile } from "../hooks/useCompanyProfile";
import { useCompanyProfileForm } from "../hooks/useCompanyProfileForm";
import type { CompanyProfileData } from "../types";
import { profileReadiness } from "../utils/profile-readiness";
import { CompanyDetailsForm } from "./CompanyDetailsForm";
import { CompanyProfileError } from "./CompanyProfileError";
import { CompanyProfileHeader } from "./CompanyProfileHeader";
import { CompanyProfileLoading } from "./CompanyProfileLoading";
import { MatchingProfileForm } from "./MatchingProfileForm";
import { ProfileReadiness } from "./ProfileReadiness";

type CompanyProfilePageProps = {
  legacyPortalUrl: string;
};

type ReadyCompanyProfileProps = CompanyProfilePageProps & {
  data: CompanyProfileData;
};

function ReadyCompanyProfile({
  data,
  legacyPortalUrl,
}: ReadyCompanyProfileProps) {
  const form = useCompanyProfileForm(data);
  const readiness = useMemo(
    () => profileReadiness(
      form.state.company,
      form.state.matching,
      data.productCount,
      legacyPortalUrl,
    ),
    [
      data.productCount,
      form.state.company,
      form.state.matching,
      legacyPortalUrl,
    ],
  );

  return (
    <div className="page-width company-profile-content">
      <div className="company-profile-status" role="status">
        <div>
          <span>Company status</span>
          <strong>{data.company.isApproved ? "Live" : "Pending approval"}</strong>
        </div>
        {data.company.isVerified ? <b>✓ Documents verified by MedicHall</b> : null}
        {data.company.slug ? (
          <a href={`/m/${encodeURIComponent(data.company.slug)}`}>
            View current public profile
          </a>
        ) : null}
      </div>
      <div className="company-profile-layout">
        <div className="company-profile-forms">
          <CompanyDetailsForm
            value={form.state.company}
            errors={form.state.companyErrors}
            dirty={form.companyDirty}
            feedback={form.state.companySave}
            onChange={form.changeCompany}
            onSubmit={() => void form.saveCompany()}
          />
          <MatchingProfileForm
            value={form.state.matching}
            profile={form.matchingProfile}
            errors={form.state.matchingErrors}
            dirty={form.matchingDirty}
            feedback={form.state.matchingSave}
            onChange={form.changeMatching}
            onSubmit={() => void form.saveMatching()}
          />
        </div>
        <ProfileReadiness readiness={readiness} />
      </div>
    </div>
  );
}

export function CompanyProfilePage({
  legacyPortalUrl,
}: CompanyProfilePageProps) {
  const profile = useCompanyProfile();

  let content;
  if (profile.error) {
    content = <CompanyProfileError error={profile.error} onRetry={profile.retry} />;
  } else if (profile.eligibility === "signed-out") {
    content = (
      <div className="page-width company-profile-content">
        <StatePanel
          title="Sign in to manage your company profile"
          description="Company and matching-profile editing requires the existing Partner Portal session. Login and registration remain in the production HTML portal."
          action={(
            <a className="button button--primary button--medium" href={legacyPortalUrl}>
              Sign in through the current Partner Portal
            </a>
          )}
        />
      </div>
    );
  } else if (profile.eligibility === "no-company") {
    content = (
      <div className="page-width company-profile-content">
        <StatePanel
          title="Create a manufacturer company first"
          description="The session is valid but does not own a company row. Complete the existing manufacturer onboarding flow before editing a company or matching profile."
          action={(
            <a className="button button--primary button--medium" href={legacyPortalUrl}>
              Continue in the current Partner Portal
            </a>
          )}
        />
      </div>
    );
  } else if (profile.eligibility === "eligible" && profile.data) {
    content = <ReadyCompanyProfile data={profile.data} legacyPortalUrl={legacyPortalUrl} />;
  } else {
    content = <CompanyProfileLoading />;
  }

  return (
    <>
      <CompanyProfileHeader company={profile.data?.company} />
      {content}
    </>
  );
}
