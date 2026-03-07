import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { StructuredRecordView } from '../components/structured-data.js';
import { dashboardApi, type DashboardIntegrationRecord } from '../lib/api.js';

export function IntegrationsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const integrationsQuery = useQuery({
    queryKey: ['integrations'],
    queryFn: () => dashboardApi.listIntegrations() as Promise<DashboardIntegrationRecord[]>,
  });
  const [kind, setKind] = useState<DashboardIntegrationRecord['kind']>('webhook');
  const [subscriptions, setSubscriptions] = useState('workflow.completed');
  const [configText, setConfigText] = useState('{\n  "url": "https://example.com/webhook"\n}');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreateIntegration(): Promise<void> {
    setMessage(null);
    setError(null);
    try {
      const config = JSON.parse(configText) as Record<string, unknown>;
      await dashboardApi.createIntegration({
        kind,
        subscriptions: subscriptions
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        config,
      });
      setMessage('Integration created.');
      await queryClient.invalidateQueries({ queryKey: ['integrations'] });
    } catch (caught) {
      setError(String(caught));
    }
  }

  async function handleToggleIntegration(adapter: DashboardIntegrationRecord): Promise<void> {
    await dashboardApi.updateIntegration(adapter.id, { is_active: !adapter.is_active });
    await queryClient.invalidateQueries({ queryKey: ['integrations'] });
  }

  async function handleDeleteIntegration(adapter: DashboardIntegrationRecord): Promise<void> {
    await dashboardApi.deleteIntegration(adapter.id);
    await queryClient.invalidateQueries({ queryKey: ['integrations'] });
  }

  return (
    <section className="grid">
      <div className="grid two">
        <div className="card">
          <h2>Integrations</h2>
          <p className="muted">Manage outbound adapters and event subscriptions from the dashboard.</p>
          {integrationsQuery.isLoading ? <p>Loading integrations...</p> : null}
          {integrationsQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load integrations.</p> : null}
          <div className="grid">
            {(integrationsQuery.data ?? []).map((adapter) => (
              <article key={adapter.id} className="card timeline-entry">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{adapter.kind}</strong>
                  <span className={`status-badge status-${adapter.is_active ? 'running' : 'cancelled'}`}>
                    {adapter.is_active ? 'active' : 'inactive'}
                  </span>
                </div>
                <div className="row">
                  {adapter.subscriptions.map((subscription) => (
                    <span key={subscription} className="status-badge">{subscription}</span>
                  ))}
                </div>
                <StructuredRecordView data={adapter.config} emptyMessage="No integration config." />
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="button" onClick={() => void handleToggleIntegration(adapter)}>
                    {adapter.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button type="button" className="button" onClick={() => void handleDeleteIntegration(adapter)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
            {(integrationsQuery.data ?? []).length === 0 && !integrationsQuery.isLoading ? (
              <p className="muted">No integrations configured yet.</p>
            ) : null}
          </div>
        </div>

        <div className="card">
          <h3>Create Integration</h3>
          <div className="grid">
            <label htmlFor="integration-kind">Kind</label>
            <select id="integration-kind" value={kind} onChange={(event) => setKind(event.target.value as DashboardIntegrationRecord['kind'])}>
              <option value="webhook">webhook</option>
              <option value="slack">slack</option>
              <option value="otlp_http">otlp_http</option>
              <option value="github_issues">github_issues</option>
            </select>
            <label htmlFor="integration-subscriptions">Subscriptions (comma separated)</label>
            <input id="integration-subscriptions" className="input" value={subscriptions} onChange={(event) => setSubscriptions(event.target.value)} />
            <label htmlFor="integration-config">Config (JSON)</label>
            <textarea id="integration-config" className="input" rows={10} value={configText} onChange={(event) => setConfigText(event.target.value)} />
            {message ? <p style={{ color: '#16a34a' }}>{message}</p> : null}
            {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="button primary" onClick={() => void handleCreateIntegration()}>
                Create Integration
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
