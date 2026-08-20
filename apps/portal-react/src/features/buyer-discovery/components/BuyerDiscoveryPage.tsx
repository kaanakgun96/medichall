import { useEffect, useRef, useState } from "react";
import { StatePanel } from "../../../shared/components/StatePanel";
import { postRpc, supabaseRequest } from "../../../shared/api/supabase-http";
import { usePartnerCompany } from "../../opportunities/hooks/usePartnerCompany";

type MatchmakingProfile = {
  role?: string;
  target_countries?: string[];
};

type MatchmakingWorkspace = {
  profile?: MatchmakingProfile | null;
};

type BuyerDiscoveryPageProps = {
  legacyPortalUrl: string;
};

function CanonicalBuyerWorkspace({ companyId }: { companyId: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [context, setContext] = useState<{
    profile: MatchmakingProfile;
    activeProductCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      postRpc<MatchmakingWorkspace>("get_matchmaking_workspace", { p_limit: 100 }, controller.signal),
      supabaseRequest<Array<{ id: number }>>(
        `/rest/v1/products?select=id&company_id=eq.${companyId}&is_active=eq.true&limit=100`,
        { signal: controller.signal },
      ),
    ]).then(([workspace, products]) => {
      if (!workspace.profile || workspace.profile.role !== "manufacturer") {
        setError("Complete an active manufacturer matchmaking profile before using Buyer Discovery.");
        return;
      }
      setContext({ profile: workspace.profile, activeProductCount: products.length });
    }).catch((loadError: unknown) => {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError("European Buyer Discovery could not load your company context.");
    });
    return () => controller.abort();
  }, [companyId]);

  useEffect(() => {
    if (!context || !rootRef.current) return;
    const workspace = globalThis.MedicHallExternalProspects.createWorkspace({
      root: rootRef.current,
      companyId,
      profile: context.profile,
      activeProductCount: context.activeProductCount,
      targetCountries: context.profile.target_countries ?? [],
      rpc: (name, parameters) => postRpc(name, parameters),
      edge: (name, body) => supabaseRequest(`/functions/v1/${name}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
      toast: () => undefined,
      track: (event) => globalThis.MedicHallTraffic?.trackConversion?.(event),
    });
    void workspace.load();
    return () => workspace.destroy();
  }, [companyId, context]);

  if (error) {
    return <StatePanel title="Buyer Discovery is not ready" description={error} />;
  }
  if (!context) {
    return <div className="inline-state" role="status">Loading European Buyer Discovery…</div>;
  }
  return <div ref={rootRef} />;
}

export function BuyerDiscoveryPage({ legacyPortalUrl }: BuyerDiscoveryPageProps) {
  const partner = usePartnerCompany();
  let content;
  if (partner.eligibility === "signed-out") {
    content = <StatePanel title="Sign in to discover European buyers" description="Buyer Discovery uses your authenticated manufacturer profile and remains isolated to your company." action={<a className="button button--primary button--medium" href={`${legacyPortalUrl}#buyer-discovery`}>Sign in through the Partner Portal</a>} />;
  } else if (partner.eligibility === "no-company") {
    content = <StatePanel title="Create a manufacturer company first" description="A structured company, active product and target market are required before a public-source search can start." action={<a className="button button--primary button--medium" href={`${legacyPortalUrl}#profile`}>Complete company setup</a>} />;
  } else if (partner.error) {
    content = <StatePanel kind="error" title="Buyer Discovery could not verify your account" description={partner.error.message} />;
  } else if (partner.eligibility === "eligible" && partner.company) {
    content = <CanonicalBuyerWorkspace companyId={partner.company.id} />;
  } else {
    content = <div className="inline-state" role="status">Loading your company…</div>;
  }

  return (
    <>
      <section className="hero buyer-discovery-hero" aria-labelledby="buyer-discovery-title">
        <div className="page-width hero__inner">
          <div className="hero__copy">
            <span className="eyebrow eyebrow--light">European market development</span>
            <h1 id="buyer-discovery-title">Find credible buyers beyond the network.</h1>
            <p>Evidence-backed distributors, importers, wholesalers and institutional buyers—without collecting private contact details or sending outreach.</p>
          </div>
        </div>
      </section>
      <div className="page-width buyer-discovery-content">{content}</div>
    </>
  );
}
