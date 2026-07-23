export function CompanyProfileLoading() {
  return (
    <section
      className="page-width company-profile-content"
      aria-busy="true"
      aria-label="Loading company profile"
    >
      <div className="company-profile-layout">
        <div className="company-profile-forms">
          {[0, 1].map((item) => (
            <div className="profile-section-card profile-section-card--loading" key={item}>
              <span className="skeleton skeleton--kicker" />
              <span className="skeleton skeleton--title-short" />
              <div className="profile-loading-grid">
                <span className="skeleton" />
                <span className="skeleton" />
                <span className="skeleton" />
                <span className="skeleton" />
              </div>
            </div>
          ))}
        </div>
        <div className="profile-readiness profile-readiness--loading">
          <span className="skeleton skeleton--kicker" />
          <span className="skeleton skeleton--title-short" />
          <span className="skeleton profile-loading-meter" />
        </div>
      </div>
    </section>
  );
}
