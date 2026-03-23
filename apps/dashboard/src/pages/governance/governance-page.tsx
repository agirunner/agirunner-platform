import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { StructuredRecordView } from '../../components/structured-data.js';
import {
  dashboardApi,
  type DashboardGovernanceRetentionPolicy,
} from '../../lib/api.js';

export function GovernancePage(): JSX.Element {
  const queryClient = useQueryClient();
  const retentionQuery = useQuery({
    queryKey: ['governance-retention-policy'],
    queryFn: () => dashboardApi.getRetentionPolicy() as Promise<DashboardGovernanceRetentionPolicy>,
  });

  const [policyForm, setPolicyForm] = useState({
    task_archive_after_days: '90',
    task_delete_after_days: '365',
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRetentionSave(): Promise<void> {
    setMessage(null);
    setError(null);
    try {
      await dashboardApi.updateRetentionPolicy({
        task_archive_after_days: Number(policyForm.task_archive_after_days),
        task_delete_after_days: Number(policyForm.task_delete_after_days),
      });
      setMessage('Retention policy updated.');
      await queryClient.invalidateQueries({ queryKey: ['governance-retention-policy'] });
    } catch (caught) {
      setError(String(caught));
    }
  }

  return (
    <section className="grid">
      <div className="grid two">
        <div className="card">
          <h2>Governance</h2>
          <p className="muted">Retention policy settings.</p>
          {retentionQuery.isLoading ? <p>Loading retention policy...</p> : null}
          {retentionQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load retention policy.</p> : null}
          {retentionQuery.data ? (
            <StructuredRecordView data={retentionQuery.data} emptyMessage="No retention policy found." />
          ) : null}
        </div>

        <div className="card">
          <h3>Retention Policy</h3>
          <div className="grid">
            <label htmlFor="archive-days">Task archive after days</label>
            <input id="archive-days" className="input" value={policyForm.task_archive_after_days} onChange={(event) => setPolicyForm((current) => ({ ...current, task_archive_after_days: event.target.value }))} />
            <label htmlFor="delete-days">Task delete after days</label>
            <input id="delete-days" className="input" value={policyForm.task_delete_after_days} onChange={(event) => setPolicyForm((current) => ({ ...current, task_delete_after_days: event.target.value }))} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="button primary" onClick={() => void handleRetentionSave()}>
                Save Policy
              </button>
            </div>
            {message ? <p style={{ color: '#16a34a' }}>{message}</p> : null}
            {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
