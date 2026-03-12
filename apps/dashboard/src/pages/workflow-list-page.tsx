import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardApi, type DashboardProjectRecord } from '../lib/api.js';
import { subscribeToEvents } from '../lib/sse.js';

interface WorkflowItem {
  id: string;
  name: string;
  state: string;
  created_at: string;
}

interface WorkflowListResult {
  data: WorkflowItem[];
}

type DeliveryPosture = 'planned' | 'active' | 'needs_attention' | 'done';

function resolveDeliveryPosture(state: string): DeliveryPosture {
  const normalized = state.toLowerCase();
  if (normalized === 'created') return 'planned';
  if (normalized === 'running' || normalized === 'active') return 'active';
  if (normalized === 'completed') return 'done';
  if (normalized === 'failed' || normalized === 'cancelled' || normalized === 'paused') {
    return 'needs_attention';
  }
  return 'planned';
}

function describeDeliveryPostureLabel(state: string): string {
  const posture = resolveDeliveryPosture(state);
  if (posture === 'planned') return 'Planned';
  if (posture === 'active') return 'Active';
  if (posture === 'done') return 'Done';
  return 'Needs Attention';
}

export function WorkflowListPage(): JSX.Element {
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
    queryKey: ['workflows'],
    queryFn: () => dashboardApi.listWorkflows() as Promise<WorkflowListResult>,
  });
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => dashboardApi.listProjects() as Promise<{ data: DashboardProjectRecord[] }>,
  });

  useEffect(() => {
    return subscribeToEvents((eventType) => {
      if (eventType.startsWith('workflow.') || eventType.startsWith('task.')) {
        void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      }
    });
  }, [queryClient]);

  const filteredWorkflows = useMemo(() => {
    const allWorkflows = query.data?.data ?? [];
    const normalizedText = textFilter.trim().toLowerCase();

    const filtered = allWorkflows.filter((workflow) => {
      if (stateFilter !== 'all' && resolveDeliveryPosture(workflow.state) !== stateFilter) {
        return false;
      }

      if (normalizedText.length > 0) {
        const haystack = `${workflow.name} ${workflow.id}`.toLowerCase();
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

  const groupedWorkflows = useMemo(() => {
    return filteredWorkflows.reduce<Record<string, WorkflowItem[]>>((acc, workflow) => {
      const key = resolveDeliveryPosture(workflow.state);
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(workflow);
      return acc;
    }, {});
  }, [filteredWorkflows]);

  async function handleStartPlanningWorkflow() {
    setPlanningStatus(null);
    setPlanningError(null);
    if (!planningProjectId) {
      setPlanningError('Select a project before starting a planning workflow.');
      return;
    }
    if (planningBrief.trim().length === 0) {
      setPlanningError('Planning brief is required.');
      return;
    }
    try {
      const response = await dashboardApi.createPlanningWorkflow(planningProjectId, {
        brief: planningBrief.trim(),
        name: planningName.trim() || undefined,
      });
      const payload = response as { data?: { id?: string }; id?: string };
      const workflowId = payload.data?.id ?? payload.id;
      setPlanningStatus(
        workflowId
          ? `Planning workflow created: ${workflowId}`
          : 'Planning workflow created.',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
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
          <h2>Delivery Runs</h2>
          <p className="muted">Filterable real-time list and fallback posture board backed by SSE updates.</p>
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
        <label htmlFor="workflow-text-filter">Search</label>
        <input
          id="workflow-text-filter"
          className="input"
          value={textFilter}
          onChange={(event) => setTextFilter(event.target.value)}
          placeholder="Filter by name or id"
        />
        <label htmlFor="workflow-state-filter">Delivery Posture Fallback</label>
        <select id="workflow-state-filter" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
          <option value="all">All</option>
          <option value="planned">Planned</option>
          <option value="active">Active</option>
          <option value="needs_attention">Needs Attention</option>
          <option value="done">Done</option>
        </select>
        <label htmlFor="workflow-sort">Sort</label>
        <select
          id="workflow-sort"
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
          Launch a planning workflow from the dashboard using a project brief and get a playbook-aligned delivery plan ready for operator review.
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
          <label htmlFor="planning-name">Run name</label>
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
            <button type="button" className="button primary" onClick={() => void handleStartPlanningWorkflow()}>
              Start Planning Run
            </button>
          </div>
          {planningStatus ? <p style={{ color: '#16a34a' }}>{planningStatus}</p> : null}
          {planningError ? <p style={{ color: '#dc2626' }}>{planningError}</p> : null}
        </div>
      </div>

      {query.isLoading ? <p>Loading runs...</p> : null}
      {query.error ? <p style={{ color: '#dc2626' }}>Failed to load runs</p> : null}

      {view === 'list' ? (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Delivery Posture</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {filteredWorkflows.map((workflow) => (
              <tr key={workflow.id}>
                <td>
                  <Link to={`/workflows/${workflow.id}`}>{workflow.name}</Link>
                </td>
                <td>
                  <span className={`status-badge status-${resolveDeliveryPosture(workflow.state)}`}>
                    {describeDeliveryPostureLabel(workflow.state)}
                  </span>
                </td>
                <td>{new Date(workflow.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {filteredWorkflows.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  No runs match current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : (
        <div className="board-grid">
          {Object.entries(groupedWorkflows).map(([state, items]) => (
            <article className="card board-column" key={state}>
              <h3>
                {describeDeliveryPostureLabel(state)} <span className="muted">({items.length})</span>
              </h3>
              <div className="grid">
                {items.map((workflow) => (
                  <Link className="card board-card" key={workflow.id} to={`/workflows/${workflow.id}`}>
                    <strong>{workflow.name}</strong>
                    <span className="muted">{new Date(workflow.created_at).toLocaleString()}</span>
                  </Link>
                ))}
              </div>
            </article>
          ))}
          {Object.keys(groupedWorkflows).length === 0 ? <p className="muted">No runs match current filters.</p> : null}
        </div>
      )}
    </section>
  );
}
