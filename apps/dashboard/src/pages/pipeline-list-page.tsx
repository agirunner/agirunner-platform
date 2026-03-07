import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardApi, type DashboardProjectRecord } from '../lib/api.js';
import { subscribeToEvents } from '../lib/sse.js';

interface PipelineItem {
  id: string;
  name: string;
  state: string;
  created_at: string;
}

interface PipelineListResult {
  data: PipelineItem[];
}

export function PipelineListPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [stateFilter, setStateFilter] = useState('all');
  const [textFilter, setTextFilter] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [view, setView] = useState<'list' | 'board'>('list');
  const [planningProjectId, setPlanningProjectId] = useState('');
  const [planningBrief, setPlanningBrief] = useState('Plan the next delivery iteration for this project.');
  const [planningName, setPlanningName] = useState('AI Planning');
  const [planningStatus, setPlanningStatus] = useState<string | null>(null);
  const [planningError, setPlanningError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => dashboardApi.listPipelines() as Promise<PipelineListResult>,
  });
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => dashboardApi.listProjects() as Promise<{ data: DashboardProjectRecord[] }>,
  });

  useEffect(() => {
    return subscribeToEvents((eventType) => {
      if (eventType.startsWith('pipeline.') || eventType.startsWith('task.')) {
        void queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      }
    });
  }, [queryClient]);

  const filteredPipelines = useMemo(() => {
    const allPipelines = query.data?.data ?? [];
    const normalizedText = textFilter.trim().toLowerCase();

    const filtered = allPipelines.filter((pipeline) => {
      if (stateFilter !== 'all' && pipeline.state !== stateFilter) {
        return false;
      }

      if (normalizedText.length > 0) {
        const haystack = `${pipeline.name} ${pipeline.id}`.toLowerCase();
        if (!haystack.includes(normalizedText)) {
          return false;
        }
      }

      return true;
    });

    if (sortBy === 'newest') {
      return filtered.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
    }

    if (sortBy === 'oldest') {
      return filtered.sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
    }

    return filtered.sort((left, right) => left.name.localeCompare(right.name));
  }, [query.data?.data, stateFilter, textFilter, sortBy]);

  const groupedPipelines = useMemo(() => {
    return filteredPipelines.reduce<Record<string, PipelineItem[]>>((acc, pipeline) => {
      const key = pipeline.state;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(pipeline);
      return acc;
    }, {});
  }, [filteredPipelines]);

  async function handleStartPlanningPipeline() {
    setPlanningStatus(null);
    setPlanningError(null);
    if (!planningProjectId) {
      setPlanningError('Select a project before starting a planning pipeline.');
      return;
    }
    if (planningBrief.trim().length === 0) {
      setPlanningError('Planning brief is required.');
      return;
    }
    try {
      const response = await dashboardApi.createPlanningPipeline(planningProjectId, {
        brief: planningBrief.trim(),
        name: planningName.trim() || undefined,
      });
      const payload = response as { data?: { id?: string }; id?: string };
      const pipelineId = payload.data?.id ?? payload.id;
      setPlanningStatus(
        pipelineId
          ? `Planning pipeline created: ${pipelineId}`
          : 'Planning pipeline created.',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pipelines'] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ]);
    } catch (error) {
      setPlanningError(String(error));
    }
  }

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2>Pipelines</h2>
          <p className="muted">Filterable real-time list and board view backed by SSE updates.</p>
        </div>
        <div className="row">
          <button
            type="button"
            className={`button ${view === 'list' ? 'primary' : ''}`}
            onClick={() => setView('list')}
          >
            List
          </button>
          <button
            type="button"
            className={`button ${view === 'board' ? 'primary' : ''}`}
            onClick={() => setView('board')}
          >
            Board
          </button>
        </div>
      </div>

      <div className="row">
        <label htmlFor="pipeline-text-filter">Search</label>
        <input
          id="pipeline-text-filter"
          className="input"
          value={textFilter}
          onChange={(event) => setTextFilter(event.target.value)}
          placeholder="Filter by name or id"
        />
        <label htmlFor="pipeline-state-filter">State</label>
        <select id="pipeline-state-filter" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
          <option value="all">All</option>
          <option value="created">Created</option>
          <option value="running">Running</option>
          <option value="paused">Paused</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <label htmlFor="pipeline-sort">Sort</label>
        <select
          id="pipeline-sort"
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value as 'newest' | 'oldest' | 'name')}
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="name">Name</option>
        </select>
      </div>

      <div className="card">
        <h3>Start With AI Planning</h3>
        <p className="muted">
          Launch a planning pipeline from the dashboard using a project brief and get a phase-gated plan for review.
        </p>
        <div className="grid">
          <label htmlFor="planning-project-select">Project</label>
          <select
            id="planning-project-select"
            value={planningProjectId}
            onChange={(event) => setPlanningProjectId(event.target.value)}
          >
            <option value="">Select project</option>
            {(projectsQuery.data?.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <label htmlFor="planning-name">Pipeline name</label>
          <input
            id="planning-name"
            className="input"
            value={planningName}
            onChange={(event) => setPlanningName(event.target.value)}
          />
          <label htmlFor="planning-brief">Project brief</label>
          <textarea
            id="planning-brief"
            className="input"
            rows={5}
            value={planningBrief}
            onChange={(event) => setPlanningBrief(event.target.value)}
          />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="button primary" onClick={() => void handleStartPlanningPipeline()}>
              Start Planning Pipeline
            </button>
          </div>
          {planningStatus ? <p style={{ color: '#16a34a' }}>{planningStatus}</p> : null}
          {planningError ? <p style={{ color: '#dc2626' }}>{planningError}</p> : null}
        </div>
      </div>

      {query.isLoading ? <p>Loading pipelines...</p> : null}
      {query.error ? <p style={{ color: '#dc2626' }}>Failed to load pipelines</p> : null}

      {view === 'list' ? (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {filteredPipelines.map((pipeline) => (
              <tr key={pipeline.id}>
                <td>
                  <Link to={`/pipelines/${pipeline.id}`}>{pipeline.name}</Link>
                </td>
                <td>
                  <span className={`status-badge status-${pipeline.state}`}>{pipeline.state}</span>
                </td>
                <td>{new Date(pipeline.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {filteredPipelines.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  No pipelines match current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : (
        <div className="board-grid">
          {Object.entries(groupedPipelines).map(([state, items]) => (
            <article className="card board-column" key={state}>
              <h3>
                {state} <span className="muted">({items.length})</span>
              </h3>
              <div className="grid">
                {items.map((pipeline) => (
                  <Link className="card board-card" key={pipeline.id} to={`/pipelines/${pipeline.id}`}>
                    <strong>{pipeline.name}</strong>
                    <span className="muted">{new Date(pipeline.created_at).toLocaleString()}</span>
                  </Link>
                ))}
              </div>
            </article>
          ))}
          {Object.keys(groupedPipelines).length === 0 ? <p className="muted">No pipelines match current filters.</p> : null}
        </div>
      )}
    </section>
  );
}
