import { useQuery } from '@tanstack/react-query';

import { dashboardApi } from '../lib/api.js';

export function SystemMetricsPage(): JSX.Element {
  const query = useQuery({
    queryKey: ['metrics'],
    queryFn: () => dashboardApi.getMetrics(),
    refetchInterval: 15000,
  });

  return (
    <section className="card">
      <h2>System Metrics</h2>
      <p className="muted">Prometheus exposition from /metrics (admin scope).</p>
      {query.isLoading ? <p>Loading metrics...</p> : null}
      {query.error ? <p style={{ color: '#dc2626' }}>Failed to load metrics</p> : null}
      <pre>{query.data}</pre>
    </section>
  );
}
