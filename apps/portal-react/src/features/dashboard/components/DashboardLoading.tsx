export function DashboardLoading() {
  return (
    <section className="page-width dashboard-content" aria-busy="true" aria-label="Loading dashboard">
      <div className="dashboard-summary-grid" aria-hidden="true">
        {[0, 1, 2, 3].map((item) => (
          <div className="dashboard-summary-card dashboard-summary-card--skeleton" key={item}>
            <span className="skeleton skeleton--kicker" />
            <span className="skeleton dashboard-skeleton--metric" />
            <span className="skeleton skeleton--count" />
          </div>
        ))}
      </div>
      <div className="dashboard-main-grid" aria-hidden="true">
        <div className="dashboard-panel dashboard-panel--skeleton">
          <span className="skeleton skeleton--title-short" />
          {[0, 1, 2].map((item) => (
            <span className="skeleton dashboard-skeleton--row" key={item} />
          ))}
        </div>
        <div className="dashboard-panel dashboard-panel--skeleton">
          <span className="skeleton skeleton--title-short" />
          <span className="skeleton dashboard-skeleton--meter" />
          {[0, 1, 2, 3, 4].map((item) => (
            <span className="skeleton dashboard-skeleton--todo" key={item} />
          ))}
        </div>
      </div>
      <p className="sr-only">Loading company metrics, top opportunities, and match readiness.</p>
    </section>
  );
}
