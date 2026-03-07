import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { StructuredRecordView } from '../components/structured-data.js';
import {
  dashboardApi,
  type DashboardAuditLogRecord,
  type DashboardGovernanceRetentionPolicy,
} from '../lib/api.js';

export function GovernancePage(): JSX.Element {
  const queryClient = useQueryClient();
  const retentionQuery = useQuery({
    queryKey: ['governance-retention-policy'],
    queryFn: () => dashboardApi.getRetentionPolicy() as Promise<DashboardGovernanceRetentionPolicy>,
  });
  const auditQuery = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => dashboardApi.listAuditLogs({ per_page: '20' }) as Promise<{ data: DashboardAuditLogRecord[] }>,
  });

  const [policyForm, setPolicyForm] = useState({
    task_archive_after_days: '90',
    task_delete_after_days: '365',
    audit_log_retention_days: '2557',
  });
  const [taskHoldId, setTaskHoldId] = useState('');
  const [pipelineHoldId, setPipelineHoldId] = useState('');
  const [holdEnabled, setHoldEnabled] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRetentionSave(): Promise<void> {
    setMessage(null);
    setError(null);
    try {
      await dashboardApi.updateRetentionPolicy({
        task_archive_after_days: Number(policyForm.task_archive_after_days),
        task_delete_after_days: Number(policyForm.task_delete_after_days),
        audit_log_retention_days: Number(policyForm.audit_log_retention_days),
      });
      setMessage('Retention policy updated.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['governance-retention-policy'] }),
        queryClient.invalidateQueries({ queryKey: ['audit-logs'] }),
      ]);
    } catch (caught) {
      setError(String(caught));
    }
  }

  async function handleTaskHold(): Promise<void> {
    if (!taskHoldId.trim()) {
      setError('Task id is required for legal hold.');
      return;
    }
    setMessage(null);
    setError(null);
    try {
      await dashboardApi.setTaskLegalHold(taskHoldId.trim(), holdEnabled);
      setMessage(`Task legal hold ${holdEnabled ? 'enabled' : 'disabled'}.`);
    } catch (caught) {
      setError(String(caught));
    }
  }

  async function handlePipelineHold(): Promise<void> {
    if (!pipelineHoldId.trim()) {
      setError('Pipeline id is required for legal hold.');
      return;
    }
    setMessage(null);
    setError(null);
    try {
      await dashboardApi.setPipelineLegalHold(pipelineHoldId.trim(), holdEnabled);
      setMessage(`Pipeline legal hold ${holdEnabled ? 'enabled' : 'disabled'}.`);
    } catch (caught) {
      setError(String(caught));
    }
  }

  return (
    <section className="grid">
      <div className="grid two">
        <div className="card">
          <h2>Governance</h2>
          <p className="muted">Retention policy, legal holds, and recent audit activity.</p>
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
            <label htmlFor="audit-days">Audit log retention days</label>
            <input id="audit-days" className="input" value={policyForm.audit_log_retention_days} onChange={(event) => setPolicyForm((current) => ({ ...current, audit_log_retention_days: event.target.value }))} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="button primary" onClick={() => void handleRetentionSave()}>
                Save Policy
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h3>Legal Holds</h3>
          <div className="grid">
            <label className="row" htmlFor="hold-enabled">
              <input id="hold-enabled" type="checkbox" checked={holdEnabled} onChange={(event) => setHoldEnabled(event.target.checked)} />
              Enable legal hold
            </label>
            <label htmlFor="task-hold-id">Task id</label>
            <input id="task-hold-id" className="input" value={taskHoldId} onChange={(event) => setTaskHoldId(event.target.value)} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="button" onClick={() => void handleTaskHold()}>
                Apply to Task
              </button>
            </div>
            <label htmlFor="pipeline-hold-id">Pipeline id</label>
            <input id="pipeline-hold-id" className="input" value={pipelineHoldId} onChange={(event) => setPipelineHoldId(event.target.value)} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="button" onClick={() => void handlePipelineHold()}>
                Apply to Pipeline
              </button>
            </div>
            {message ? <p style={{ color: '#16a34a' }}>{message}</p> : null}
            {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}
          </div>
        </div>

        <div className="card">
          <h3>Audit Log</h3>
          {auditQuery.isLoading ? <p>Loading audit log...</p> : null}
          {auditQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load audit log.</p> : null}
          <div className="grid">
            {(auditQuery.data?.data ?? []).map((entry) => (
              <article key={entry.id} className="card timeline-entry">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{entry.action}</strong>
                  <span className="muted">{new Date(entry.created_at).toLocaleString()}</span>
                </div>
                <StructuredRecordView
                  data={{
                    actor_type: entry.actor_type,
                    actor_id: entry.actor_id,
                    resource_type: entry.resource_type,
                    resource_id: entry.resource_id,
                    details: entry.details,
                  }}
                  emptyMessage="No audit details."
                />
              </article>
            ))}
            {(auditQuery.data?.data ?? []).length === 0 && !auditQuery.isLoading ? (
              <p className="muted">No audit events found.</p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
