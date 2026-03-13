import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { StructuredRecordView } from '../components/structured-data.js';
import {
  dashboardApi,
  type DashboardProjectRecord,
  type DashboardProjectResourceRecord,
  type DashboardProjectSpecRecord,
  type DashboardProjectToolCatalog,
} from '../lib/api.js';
import { ProjectDeliveryHistory } from './projects/project-delivery-history.js';

export function ProjectsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => dashboardApi.listProjects() as Promise<{ data: DashboardProjectRecord[] }>,
  });
  const projects = projectsQuery.data?.data ?? [];
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [createName, setCreateName] = useState('');
  const [createSlug, setCreateSlug] = useState('');
  const [createRepoUrl, setCreateRepoUrl] = useState('');
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const activeProjectId = selectedProjectId || projects[0]?.id || '';

  const projectQuery = useQuery({
    queryKey: ['project', activeProjectId],
    queryFn: () => dashboardApi.getProject(activeProjectId),
    enabled: activeProjectId.length > 0,
  });
  const specQuery = useQuery({
    queryKey: ['project-spec', activeProjectId],
    queryFn: () => dashboardApi.getProjectSpec(activeProjectId) as Promise<DashboardProjectSpecRecord>,
    enabled: activeProjectId.length > 0,
  });
  const resourcesQuery = useQuery({
    queryKey: ['project-resources', activeProjectId],
    queryFn: () =>
      dashboardApi.listProjectResources(activeProjectId) as Promise<{ data: DashboardProjectResourceRecord[] }>,
    enabled: activeProjectId.length > 0,
  });
  const toolsQuery = useQuery({
    queryKey: ['project-tools', activeProjectId],
    queryFn: () => dashboardApi.listProjectTools(activeProjectId) as Promise<{ data: DashboardProjectToolCatalog }>,
    enabled: activeProjectId.length > 0,
  });
  const selectedProject = projectQuery.data;
  const runSummary = useMemo(
    () => asRecord(selectedProject?.memory).last_run_summary,
    [selectedProject],
  );

  async function handleCreateProject(): Promise<void> {
    setCreateMessage(null);
    setCreateError(null);
    if (!createName.trim() || !createSlug.trim()) {
      setCreateError('Project name and slug are required.');
      return;
    }

    try {
      const created = await dashboardApi.createProject({
        name: createName.trim(),
        slug: createSlug.trim(),
        repository_url: createRepoUrl.trim() || undefined,
      });
      setCreateMessage(`Created project ${created.name}.`);
      setSelectedProjectId(created.id);
      setCreateName('');
      setCreateSlug('');
      setCreateRepoUrl('');
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch (error) {
      setCreateError(String(error));
    }
  }

  return (
    <section className="grid">
      <div className="grid two">
        <div className="card">
          <h2>Projects</h2>
          <p className="muted">Project continuity, specs, tools, resources, and run summaries in one place.</p>
          {projectsQuery.isLoading ? <p>Loading projects...</p> : null}
          {projectsQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load projects.</p> : null}
          <div className="grid">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={`button ${activeProjectId === project.id ? 'primary' : ''}`}
                onClick={() => setSelectedProjectId(project.id)}
              >
                {project.name}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>Create Project</h3>
          <div className="grid">
            <label htmlFor="project-name">Name</label>
            <input id="project-name" className="input" value={createName} onChange={(event) => setCreateName(event.target.value)} />
            <label htmlFor="project-slug">Slug</label>
            <input id="project-slug" className="input" value={createSlug} onChange={(event) => setCreateSlug(event.target.value)} />
            <label htmlFor="project-repo-url">Repository URL</label>
            <input id="project-repo-url" className="input" value={createRepoUrl} onChange={(event) => setCreateRepoUrl(event.target.value)} />
            {createMessage ? <p style={{ color: '#16a34a' }}>{createMessage}</p> : null}
            {createError ? <p style={{ color: '#dc2626' }}>{createError}</p> : null}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="button primary" onClick={() => void handleCreateProject()}>
                Create Project
              </button>
            </div>
          </div>
        </div>
      </div>

      {selectedProject ? (
        <>
          <div className="grid two">
            <div className="card">
              <h3>Project Overview</h3>
              <StructuredRecordView
                data={{
                  name: selectedProject.name,
                  slug: selectedProject.slug,
                  description: selectedProject.description,
                  repository_url: selectedProject.repository_url,
                  is_active: selectedProject.is_active,
                }}
                emptyMessage="No project details available."
              />
            </div>

            <div className="card">
              <h3>Run Summary</h3>
              <StructuredRecordView data={runSummary} emptyMessage="No run summary recorded yet." />
            </div>
          </div>

          <div className="grid two">
            <div className="card">
              <h3>Project Spec</h3>
              {specQuery.isLoading ? <p>Loading project spec...</p> : null}
              {specQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load project spec.</p> : null}
              {specQuery.data ? <StructuredRecordView data={specQuery.data} emptyMessage="No project spec available." /> : null}
            </div>

            <div className="card">
              <h3>Project Timeline</h3>
              <ProjectDeliveryHistory projectId={activeProjectId} />
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
                  <p className="muted">No project resources registered.</p>
                ) : null}
              </div>
            </div>

            <div className="card">
              <h3>Tools</h3>
              {toolsQuery.isLoading ? <p>Loading tools...</p> : null}
              {toolsQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load project tools.</p> : null}
              <StructuredRecordView data={toolsQuery.data?.data} emptyMessage="No project tools registered." />
            </div>
          </div>
        </>
      ) : (
        <div className="card">
          <p className="muted">Select or create a project to inspect continuity data.</p>
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
