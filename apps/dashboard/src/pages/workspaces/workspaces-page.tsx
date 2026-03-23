import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { StructuredRecordView } from '../components/structured-data.js';
import {
  dashboardApi,
  type DashboardWorkspaceRecord,
  type DashboardWorkspaceResourceRecord,
  type DashboardWorkspaceSpecRecord,
  type DashboardWorkspaceToolCatalog,
} from '../lib/api.js';
import { WorkspaceDeliveryHistory } from './workspaces/workspace-delivery-history.js';

export function WorkspacesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => dashboardApi.listWorkspaces() as Promise<{ data: DashboardWorkspaceRecord[] }>,
  });
  const workspaces = workspacesQuery.data?.data ?? [];
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [createName, setCreateName] = useState('');
  const [createSlug, setCreateSlug] = useState('');
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const activeWorkspaceId = selectedWorkspaceId || workspaces[0]?.id || '';

  const workspaceQuery = useQuery({
    queryKey: ['workspace', activeWorkspaceId],
    queryFn: () => dashboardApi.getWorkspace(activeWorkspaceId),
    enabled: activeWorkspaceId.length > 0,
  });
  const specQuery = useQuery({
    queryKey: ['workspace-spec', activeWorkspaceId],
    queryFn: () => dashboardApi.getWorkspaceSpec(activeWorkspaceId) as Promise<DashboardWorkspaceSpecRecord>,
    enabled: activeWorkspaceId.length > 0,
  });
  const resourcesQuery = useQuery({
    queryKey: ['workspace-resources', activeWorkspaceId],
    queryFn: () =>
      dashboardApi.listWorkspaceResources(activeWorkspaceId) as Promise<{ data: DashboardWorkspaceResourceRecord[] }>,
    enabled: activeWorkspaceId.length > 0,
  });
  const toolsQuery = useQuery({
    queryKey: ['workspace-tools', activeWorkspaceId],
    queryFn: () => dashboardApi.listWorkspaceTools(activeWorkspaceId) as Promise<{ data: DashboardWorkspaceToolCatalog }>,
    enabled: activeWorkspaceId.length > 0,
  });
  const selectedWorkspace = workspaceQuery.data;
  const runSummary = useMemo(
    () => asRecord(selectedWorkspace?.memory).last_run_summary,
    [selectedWorkspace],
  );

  async function handleCreateWorkspace(): Promise<void> {
    setCreateMessage(null);
    setCreateError(null);
    if (!createName.trim() || !createSlug.trim()) {
      setCreateError('Workspace name and slug are required.');
      return;
    }

    try {
      const created = await dashboardApi.createWorkspace({
        name: createName.trim(),
        slug: createSlug.trim(),
        settings: {
          workspace_storage_type: 'workspace_artifacts',
          workspace_storage: {},
        },
      });
      setCreateMessage(`Created workspace ${created.name}.`);
      setSelectedWorkspaceId(created.id);
      setCreateName('');
      setCreateSlug('');
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    } catch (error) {
      setCreateError(String(error));
    }
  }

  return (
    <section className="grid">
      <div className="grid two">
        <div className="card">
          <h2>Workspaces</h2>
          <p className="muted">Workspace continuity, specs, tools, resources, and run summaries in one place.</p>
          {workspacesQuery.isLoading ? <p>Loading workspaces...</p> : null}
          {workspacesQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load workspaces.</p> : null}
          <div className="grid">
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                className={`button ${activeWorkspaceId === workspace.id ? 'primary' : ''}`}
                onClick={() => setSelectedWorkspaceId(workspace.id)}
              >
                {workspace.name}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>Create Workspace</h3>
          <div className="grid">
            <label htmlFor="workspace-name">Name</label>
            <input id="workspace-name" className="input" value={createName} onChange={(event) => setCreateName(event.target.value)} />
            <label htmlFor="workspace-slug">Slug</label>
            <input id="workspace-slug" className="input" value={createSlug} onChange={(event) => setCreateSlug(event.target.value)} />
            {createMessage ? <p style={{ color: '#16a34a' }}>{createMessage}</p> : null}
            {createError ? <p style={{ color: '#dc2626' }}>{createError}</p> : null}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="button primary" onClick={() => void handleCreateWorkspace()}>
                Create Workspace
              </button>
            </div>
          </div>
        </div>
      </div>

      {selectedWorkspace ? (
        <>
          <div className="grid two">
            <div className="card">
              <h3>Workspace Overview</h3>
              <StructuredRecordView
                data={{
                  name: selectedWorkspace.name,
                  slug: selectedWorkspace.slug,
                  description: selectedWorkspace.description,
                  storage: selectedWorkspace.settings?.workspace_storage_type ?? (selectedWorkspace.repository_url ? 'git_remote' : 'workspace_artifacts'),
                  is_active: selectedWorkspace.is_active,
                }}
                emptyMessage="No workspace details available."
              />
            </div>

            <div className="card">
              <h3>Run Summary</h3>
              <StructuredRecordView data={runSummary} emptyMessage="No run summary recorded yet." />
            </div>
          </div>

          <div className="grid two">
            <div className="card">
              <h3>Workspace Spec</h3>
              {specQuery.isLoading ? <p>Loading workspace spec...</p> : null}
              {specQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load workspace spec.</p> : null}
              {specQuery.data ? <StructuredRecordView data={specQuery.data} emptyMessage="No workspace spec available." /> : null}
            </div>

            <div className="card">
              <h3>Workspace Timeline</h3>
              <WorkspaceDeliveryHistory workspaceId={activeWorkspaceId} />
            </div>
          </div>

          <div className="grid two">
            <div className="card">
              <h3>Resources</h3>
              {resourcesQuery.isLoading ? <p>Loading resources...</p> : null}
              {resourcesQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load resources.</p> : null}
              <div className="grid">
                {(resourcesQuery.data?.data ?? []).map((resource, index) => (
                  <article key={String(resource.id ?? index)} className="card timeline-entry">
                    <StructuredRecordView data={resource} emptyMessage="No resource details." />
                  </article>
                ))}
                {(resourcesQuery.data?.data ?? []).length === 0 && !resourcesQuery.isLoading ? (
                  <p className="muted">No workspace resources registered.</p>
                ) : null}
              </div>
            </div>

            <div className="card">
              <h3>Tools</h3>
              {toolsQuery.isLoading ? <p>Loading tools...</p> : null}
              {toolsQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load workspace tools.</p> : null}
              <StructuredRecordView data={toolsQuery.data?.data} emptyMessage="No workspace tools registered." />
            </div>
          </div>
        </>
      ) : (
        <div className="card">
          <p className="muted">Select or create a workspace to inspect continuity data.</p>
        </div>
      )}
    </section>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
