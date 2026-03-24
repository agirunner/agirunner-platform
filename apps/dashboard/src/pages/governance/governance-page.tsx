import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { StructuredRecordView } from '../../components/structured-data/structured-data.js';
import { dashboardApi, type DashboardGovernanceRetentionPolicy } from '../../lib/api.js';

export function GovernancePage(): JSX.Element {
  const queryClient = useQueryClient();
  const retentionQuery = useQuery({
    queryKey: ['governance-retention-policy'],
    queryFn: () => dashboardApi.getRetentionPolicy() as Promise<DashboardGovernanceRetentionPolicy>,
  });

  const [policyForm, setPolicyForm] = useState({
    task_prune_after_days: '30',
    workflow_delete_after_days: '30',
    execution_log_retention_days: '30',
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRetentionSave(): Promise<void> {
    setMessage(null);
    setError(null);
    try {
      await dashboardApi.updateRetentionPolicy({
        task_prune_after_days: Number(policyForm.task_prune_after_days),
        workflow_delete_after_days: Number(policyForm.workflow_delete_after_days),
        execution_log_retention_days: Number(policyForm.execution_log_retention_days),
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
          {retentionQuery.error ? (
            <p style={{ color: '#dc2626' }}>Failed to load retention policy.</p>
          ) : null}
          {retentionQuery.data ? (
            <StructuredRecordView
              data={retentionQuery.data}
              emptyMessage="No retention policy found."
            />
          ) : null}
        </div>

        <div className="card">
          <h3>Retention Policy</h3>
          <div className="grid">
            <label htmlFor="prune-days">Task pruning retention days</label>
            <input
              id="prune-days"
              className="input"
              value={policyForm.task_prune_after_days}
              onChange={(event) =>
                setPolicyForm((current) => ({
                  ...current,
                  task_prune_after_days: event.target.value,
                }))
              }
            />
            <label htmlFor="workflow-delete-days">Workflow retention days</label>
            <input
              id="workflow-delete-days"
              className="input"
              value={policyForm.workflow_delete_after_days}
              onChange={(event) =>
                setPolicyForm((current) => ({
                  ...current,
                  workflow_delete_after_days: event.target.value,
                }))
              }
            />
            <label htmlFor="log-retention-days">Log retention days</label>
            <input
              id="log-retention-days"
              className="input"
              value={policyForm.execution_log_retention_days}
              onChange={(event) =>
                setPolicyForm((current) => ({
                  ...current,
                  execution_log_retention_days: event.target.value,
                }))
              }
            />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="button primary"
                onClick={() => void handleRetentionSave()}
              >
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
