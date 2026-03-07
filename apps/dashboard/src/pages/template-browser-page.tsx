import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardApi, type DashboardTemplate } from '../lib/api.js';

interface TemplateListResult {
  data: DashboardTemplate[];
}

interface LaunchFormState {
  templateId: string;
  name: string;
  repo: string;
  goal: string;
  constraints: string;
  acceptanceCriteria: string;
}

export function buildInitialLaunchState(templates: DashboardTemplate[]): LaunchFormState {
  return {
    templateId: templates[0]?.id ?? '',
    name: '',
    repo: '',
    goal: '',
    constraints: '',
    acceptanceCriteria: '',
  };
}

export function TemplateBrowserPage(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const templatesQuery = useQuery({
    queryKey: ['templates'],
    queryFn: () => dashboardApi.listTemplates() as Promise<TemplateListResult>,
  });

  const templates = templatesQuery.data?.data ?? [];
  const [form, setForm] = useState<LaunchFormState>(() => buildInitialLaunchState([]));
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const preview = {
    template_id: form.templateId,
    name: form.name.trim(),
    parameters: {
      repo: form.repo.trim(),
      goal: form.goal.trim(),
      constraints: form.constraints.trim(),
      acceptance_criteria: form.acceptanceCriteria.trim(),
    },
  };

  useEffect(() => {
    if (!form.templateId && templates[0]?.id) {
      setForm((current) => ({ ...current, templateId: templates[0].id, name: current.name || `${templates[0].name} run` }));
    }
  }, [form.templateId, templates]);

  async function handleLaunch(): Promise<void> {
    if (!form.templateId) {
      setLaunchError('Select a template before launching a workflow.');
      return;
    }

    if (!form.name.trim()) {
      setLaunchError('Workflow name is required.');
      return;
    }

    try {
      setIsLaunching(true);
      setLaunchError(null);

      const workflow = await dashboardApi.createWorkflow({
        template_id: form.templateId,
        name: form.name.trim(),
        parameters: {
          repo: form.repo.trim(),
          goal: form.goal.trim(),
          constraints: form.constraints.trim(),
          acceptance_criteria: form.acceptanceCriteria.trim(),
        },
      });

      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
      navigate(`/workflows/${String((workflow as { id: string }).id)}`);
    } catch {
      setLaunchError('Failed to launch workflow. Check template and parameter values.');
    } finally {
      setIsLaunching(false);
    }
  }

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2>Templates</h2>
          <p className="muted">Browse workflow templates and launch a workflow with repo-specific parameters.</p>
        </div>
      </div>

      {templatesQuery.isLoading ? <p>Loading templates...</p> : null}
      {templatesQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load templates</p> : null}

      <div className="board-grid" style={{ marginBottom: '1rem' }}>
        {templates.map((template) => (
          <article className="card board-column" key={template.id}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{template.name}</strong>
              <span className="muted">v{template.version}</span>
            </div>
            <p className="muted">{template.description ?? template.slug}</p>
            <div className="row">
              <span className={`status-badge status-${template.is_published ? 'completed' : 'paused'}`}>
                {template.is_published ? 'published' : 'draft'}
              </span>
              <span className={`status-badge status-${template.is_built_in ? 'running' : 'ready'}`}>
                {template.is_built_in ? 'built-in' : 'custom'}
              </span>
            </div>
            <button
              type="button"
              className={`button ${form.templateId === template.id ? 'primary' : ''}`}
              onClick={() => setForm((current) => ({ ...current, templateId: template.id, name: current.name || `${template.name} run` }))}
            >
              Use template
            </button>
          </article>
        ))}
      </div>

      <article className="card">
        <h3>Launch Workflow</h3>
        <div className="grid">
          <label htmlFor="template-select">Template</label>
          <select
            id="template-select"
            value={form.templateId}
            onChange={(event) => setForm((current) => ({ ...current, templateId: event.target.value }))}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>

          <label htmlFor="workflow-name">Workflow name</label>
          <input
            id="workflow-name"
            className="input"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Fancy Hello World App"
          />

          <label htmlFor="workflow-repo">Repo</label>
          <input
            id="workflow-repo"
            className="input"
            value={form.repo}
            onChange={(event) => setForm((current) => ({ ...current, repo: event.target.value }))}
            placeholder="ssh://git@github.com:2222/mark/test.git"
          />

          <label htmlFor="workflow-goal">Goal</label>
          <textarea
            id="workflow-goal"
            className="input"
            value={form.goal}
            onChange={(event) => setForm((current) => ({ ...current, goal: event.target.value }))}
            placeholder="Create a fancy hello world app."
          />

          <label htmlFor="workflow-constraints">Constraints</label>
          <textarea
            id="workflow-constraints"
            className="input"
            value={form.constraints}
            onChange={(event) => setForm((current) => ({ ...current, constraints: event.target.value }))}
            placeholder="Keep it small, readable, and easy to verify."
          />

          <label htmlFor="workflow-acceptance-criteria">Acceptance criteria</label>
          <textarea
            id="workflow-acceptance-criteria"
            className="input"
            value={form.acceptanceCriteria}
            onChange={(event) => setForm((current) => ({ ...current, acceptanceCriteria: event.target.value }))}
            placeholder="Repo contains a runnable app, tests, and documentation."
          />
        </div>

        {launchError ? <p style={{ color: '#dc2626' }}>{launchError}</p> : null}

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="button primary" onClick={() => void handleLaunch()} disabled={isLaunching}>
            {isLaunching ? 'Launching…' : 'Launch workflow'}
          </button>
        </div>
        <div className="card">
          <h4>Dry Run Preview</h4>
          <pre>{JSON.stringify(preview, null, 2)}</pre>
        </div>
      </article>
    </section>
  );
}
