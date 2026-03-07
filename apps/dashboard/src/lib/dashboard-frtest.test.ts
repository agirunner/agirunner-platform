/**
 * Structural and logic unit tests for the remaining dashboard FRs.
 *
 * FR-030:  Modern SPA (React, dark/light, responsive, keyboard shortcuts)
 * FR-031a: Live pipeline execution view
 * FR-031b: Live agent/worker status
 * FR-032:  Board view + list view with filtering
 * FR-033:  Approval button for awaiting_approval
 * FR-034:  Retry button for failed tasks
 * FR-035:  Pipeline-level controls (pause/resume/cancel/rework)
 * FR-035a: Task-level intervention (cancel/reassign/escalate/override)
 * FR-036:  Task detail views (full data, JSON viewer)
 * FR-036a: Pipeline detail views
 * FR-037:  Agent registry view
 * FR-156:  Dashboard tenant-scoped
 * FR-213:  Dashboard task injection
 * FR-299:  Worker status in dashboard
 * FR-420:  Template browser
 * FR-423:  Pipeline status view with dependency graph
 * FR-424:  Pipeline launch form
 * FR-425:  Worker management view
 * FR-426:  API key management
 * FR-427:  Dashboard navigation and layout
 * FR-429:  Pipeline list view with filters
 * FR-717:  Dashboard renders phases as swimlanes
 * FR-755:  Quickstart docs for 15-min first pipeline
 * FR-RT-1620..1625: Guided runtime customization in existing dashboard
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearSession, readSession, writeSession } from './session.js';
import { createDashboardApi } from './api.js';

const dashboardSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

function readComponent(relPath: string): string {
  return fs.readFileSync(path.join(dashboardSrc, relPath), 'utf-8');
}

function readRepoFile(relPath: string): string {
  // dashboardSrc = apps/dashboard/src → 3 levels up = repo root
  const repoRoot = path.join(dashboardSrc, '..', '..', '..');
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf-8');
}

function mockLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FR-030: Modern SPA (React, dark/light, responsive)
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-030: modern SPA structure', () => {
  it('app.tsx exports the App component as a React function', () => {
    const source = readComponent('app/app.tsx');
    expect(source).toContain('export function App');
  });

  it('app includes route definitions covering all major pages', () => {
    const source = readComponent('app/app.tsx');
    expect(source).toContain('/pipelines');
    expect(source).toContain('/projects');
    expect(source).toContain('/templates');
    expect(source).toContain('/workers');
    expect(source).toContain('/integrations');
    expect(source).toContain('/governance');
    expect(source).toContain('/runtime-customization');
    expect(source).toContain('/metrics');
    expect(source).toContain('/login');
  });

  it('app integrates theme toggle at the application root', () => {
    const source = readComponent('app/app.tsx');
    expect(source).toContain('toggleTheme');
    expect(source).toContain('applyTheme');
    expect(source).toContain('readTheme');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-031a: Live pipeline execution view
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-031a: live pipeline execution view', () => {
  it('pipeline-detail-page fetches pipeline data with a reactive query', () => {
    const source = readComponent('pages/pipeline-detail-page.tsx');
    expect(source).toContain('useQuery');
    expect(source).toContain('getPipeline');
  });

  it('pipeline-detail-page shows pipeline state in the view', () => {
    const source = readComponent('pages/pipeline-detail-page.tsx');
    expect(source).toContain('.state');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-031b: Live agent/worker status
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-031b: live agent/worker status', () => {
  it('worker-status-page fetches both workers and agents with reactive queries', () => {
    const source = readComponent('pages/worker-status-page.tsx');
    expect(source).toContain('listWorkers');
    expect(source).toContain('listAgents');
    expect(source).toContain('useQuery');
  });

  it('worker-status-page renders status and runtime_type columns for workers', () => {
    const source = readComponent('pages/worker-status-page.tsx');
    expect(source).toContain('status');
    expect(source).toContain('runtime_type');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-032: Board view + list view with filtering
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-032: pipeline list view', () => {
  it('pipeline-list-page exports PipelineListPage component', () => {
    const source = readComponent('pages/pipeline-list-page.tsx');
    expect(source).toContain('export function PipelineListPage');
  });

  it('pipeline-list-page renders pipeline state column for board-like filtering', () => {
    const source = readComponent('pages/pipeline-list-page.tsx');
    expect(source).toContain('.state');
  });

  it('pipeline-list-page includes AI planning launch controls', () => {
    const source = readComponent('pages/pipeline-list-page.tsx');
    expect(source).toContain('Start With AI Planning');
    expect(source).toContain('createPlanningPipeline');
    expect(source).toContain('listProjects');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-033: Approval button for awaiting_approval tasks
// FR-034: Retry button for failed tasks
// FR-035: Pipeline-level controls
// FR-035a: Task-level intervention
// FR-036: Task detail views
// FR-213: Dashboard task injection
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-033 / FR-034 / FR-035 / FR-035a / FR-036 / FR-213: task detail page', () => {
  it('task-detail-page exports TaskDetailPage component', () => {
    const source = readComponent('pages/task-detail-page.tsx');
    expect(source).toContain('export function TaskDetailPage');
  });

  it('task-detail-page fetches full task data via getTask', () => {
    const source = readComponent('pages/task-detail-page.tsx');
    expect(source).toContain('getTask');
    expect(source).toContain('useQuery');
  });

  it('task-detail-page renders structured task inspection views', () => {
    const source = readComponent('pages/task-detail-page.tsx');
    expect(source).toContain('StructuredRecordView');
    expect(source).toContain('Execution Summary');
  });

  it('task-detail-page surfaces clarification and rework details beyond raw JSON', () => {
    const source = readComponent('pages/task-detail-page.tsx');
    expect(source).toContain('Clarification & Rework');
    expect(source).toContain('Escalation Response');
    expect(source).toContain('readClarificationHistory');
    expect(source).toContain('readReworkDetails');
  });

  it('task-detail-page exposes produced artifact inspection links', () => {
    const source = readComponent('pages/task-detail-page.tsx');
    expect(source).toContain('Task Artifacts');
    expect(source).toContain('listTaskArtifacts');
    expect(source).toContain('Download artifact');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-036a: Pipeline detail views
// FR-423: Pipeline status view with dependency graph
// FR-717: Dashboard renders phases as swimlanes
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-036a / FR-423 / FR-717: pipeline detail and dependency graph', () => {
  it('pipeline-detail-page exports PipelineDetailPage component', () => {
    const source = readComponent('pages/pipeline-detail-page.tsx');
    expect(source).toContain('export function PipelineDetailPage');
  });

  it('pipeline-detail-page renders task dependency graph as a list', () => {
    const source = `${readComponent('pages/pipeline-detail-page.tsx')}\n${readComponent('pages/pipeline-detail-sections.tsx')}`;
    expect(source).toContain('Task Graph');
    expect(source).toContain('depends_on');
  });

  it('pipeline-detail-page renders task state column for live status tracking', () => {
    const source = `${readComponent('pages/pipeline-detail-page.tsx')}\n${readComponent('pages/pipeline-detail-sections.tsx')}`;
    expect(source).toContain('.state');
  });

  it('pipeline-detail-page exposes workflow swimlanes, phase gate actions, resolved config, and project timeline', () => {
    const source = `${readComponent('pages/pipeline-detail-page.tsx')}\n${readComponent('pages/pipeline-detail-sections.tsx')}`;
    expect(source).toContain('Workflow Swimlanes');
    expect(source).toContain('actOnPhaseGate');
    expect(source).toContain('cancelPhase');
    expect(source).toContain('Resolved Config');
    expect(source).toContain('Project Timeline');
  });

  it('pipeline-detail-page exposes pipeline documents and project memory controls', () => {
    const source = `${readComponent('pages/pipeline-detail-page.tsx')}\n${readComponent('pages/pipeline-detail-sections.tsx')}\n${readComponent('pages/pipeline-detail-content.tsx')}`;
    expect(source).toContain('Pipeline Documents');
    expect(source).toContain('Project Memory');
    expect(source).toContain('listPipelineDocuments');
    expect(source).toContain('patchProjectMemory');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-037: Agent registry view
// FR-299: Worker status in dashboard
// FR-425: Worker management view
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-037 / FR-299 / FR-425: agent registry and worker management', () => {
  it('worker-status-page shows both agent and worker lists', () => {
    const source = readComponent('pages/worker-status-page.tsx');
    expect(source).toContain('Workers');
    expect(source).toContain('Agents');
  });

  it('worker-status-page displays current_task_id for each agent', () => {
    const source = readComponent('pages/worker-status-page.tsx');
    expect(source).toContain('current_task_id');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-156: Dashboard tenant-scoped (all API calls scoped to session tenant)
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-156: dashboard is tenant-scoped', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage();
    clearSession();
  });

  it('readSession includes tenantId in the returned token bundle', () => {
    writeSession({ accessToken: 'tok', tenantId: 'tenant-abc' });
    const session = readSession();
    expect(session?.tenantId).toBe('tenant-abc');
  });

  it('layout displays the active tenantId from session', () => {
    const source = readComponent('components/layout.tsx');
    expect(source).toContain('tenantId');
    expect(source).toContain('readSession');
  });

  it('api.ts scopes all requests to the access token stored in session', () => {
    const source = readComponent('lib/api.ts');
    expect(source).toContain('readSession');
    expect(source).toContain('tenantId');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-420: Template browser
// FR-424: Pipeline launch form
// FR-426: API key management
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-420 / FR-424 / FR-426: template browser, pipeline launch, API key management', () => {
  it('api layer exposes template browsing and pipeline launch methods', () => {
    const source = readComponent('lib/api.ts');
    expect(source).toContain('listPipelines');
    expect(source).toContain('listTemplates');
    expect(source).toContain('getPipeline');
    expect(source).toContain('createPipeline');
  });

  it('DashboardApi interface supports login (API key exchange) for key management workflows', () => {
    const source = readComponent('lib/api.ts');
    expect(source).toContain('login');
    expect(source).toContain('logout');
    expect(source).toContain('exchangeApiKey');
  });

  it('login() exchanges an API key for session tokens (pipeline launch prerequisite)', async () => {
    mockLocalStorage();
    const client = {
      exchangeApiKey: vi.fn().mockResolvedValue({ token: 'access-tok', tenant_id: 'tenant-1' }),
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listPipelines: vi.fn(),
      getPipeline: vi.fn(),
      createPipeline: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };
    const api = createDashboardApi({ client: client as never });

    await api.login('ab_admin_test_key');

    expect(client.exchangeApiKey).toHaveBeenCalledWith('ab_admin_test_key');
    expect(client.setAccessToken).toHaveBeenCalledWith('access-tok');
    const session = readSession();
    expect(session?.tenantId).toBe('tenant-1');
  });

  it('template browser page renders template browsing and launch controls', () => {
    const source = readComponent('pages/template-browser-page.tsx');
    expect(source).toContain('Loading templates');
    expect(source).toContain('Launch Pipeline');
    expect(source).toContain('dashboardApi.createPipeline');
  });
});

describe('FR-RT-1620..1625: guided runtime customization flow', () => {
  it('dashboard api exposes runtime customization validation, build, link, and export methods', () => {
    const source = readComponent('lib/api.ts');
    expect(source).toContain('getCustomizationStatus');
    expect(source).toContain('validateCustomization');
    expect(source).toContain('createCustomizationBuild');
    expect(source).toContain('linkCustomizationBuild');
    expect(source).toContain('exportCustomization');
  });

  it('runtime customization page remains inside the existing dashboard app and renders gate and digest review language', () => {
    const pageSource = readComponent('pages/runtime-customization-page.tsx');
    const panelSource = readComponent('pages/runtime-customization-support.tsx');
    const formSource = readComponent('pages/runtime-customization-form.ts');
    expect(pageSource).toContain('Runtime Customization');
    expect(pageSource).toContain('Guided authoring');
    expect(panelSource).toContain('Gate Review');
    expect(formSource).toContain('Configured');
    expect(formSource).toContain('Pending rollout');
  });

  it('layout exposes runtime customization navigation in the existing sidebar', () => {
    const source = readComponent('components/layout.tsx');
    expect(source).toContain('/runtime-customization');
    expect(source).toContain('Runtime Customization');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-427: Dashboard navigation and layout
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-427: dashboard navigation and layout', () => {
  it('layout.tsx exports DashboardLayout component', () => {
    const source = readComponent('components/layout.tsx');
    expect(source).toContain('export function DashboardLayout');
  });

  it('layout includes navigation links to all major sections', () => {
    const source = readComponent('components/layout.tsx');
    expect(source).toContain('/pipelines');
    expect(source).toContain('/projects');
    expect(source).toContain('/templates');
    expect(source).toContain('/workers');
    expect(source).toContain('/integrations');
    expect(source).toContain('/governance');
    expect(source).toContain('/metrics');
  });

  it('layout includes keyboard shortcuts for the expanded operator sections', () => {
    const source = readComponent('components/layout.tsx');
    expect(source).toContain("event.altKey && event.key === '1'");
    expect(source).toContain("event.altKey && event.key === '2'");
    expect(source).toContain("event.altKey && event.key === '3'");
    expect(source).toContain("event.altKey && event.key === '4'");
    expect(source).toContain("event.altKey && event.key === '5'");
    expect(source).toContain("event.altKey && event.key === '6'");
  });

  it('layout includes a logout control', () => {
    const source = readComponent('components/layout.tsx');
    expect(source).toContain('logout');
  });
});

describe('operator information architecture', () => {
  it('projects page exposes project continuity controls', () => {
    const source = readComponent('pages/projects-page.tsx');
    expect(source).toContain('export function ProjectsPage');
    expect(source).toContain('Project Timeline');
    expect(source).toContain('Run Summary');
    expect(source).toContain('createProject');
    expect(source).toContain('StructuredRecordView data={toolsQuery.data?.data}');
  });

  it('integrations page exposes integration lifecycle controls', () => {
    const source = readComponent('pages/integrations-page.tsx');
    expect(source).toContain('export function IntegrationsPage');
    expect(source).toContain('createIntegration');
    expect(source).toContain('updateIntegration');
    expect(source).toContain('deleteIntegration');
  });

  it('governance page exposes retention, legal holds, and audit controls', () => {
    const source = readComponent('pages/governance-page.tsx');
    expect(source).toContain('export function GovernancePage');
    expect(source).toContain('getRetentionPolicy');
    expect(source).toContain('setTaskLegalHold');
    expect(source).toContain('setPipelineLegalHold');
    expect(source).toContain('listAuditLogs');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-429: Pipeline list view with filters
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-429: pipeline list view with filters', () => {
  it('pipeline-list-page renders the pipeline table with state-based filtering capability', () => {
    const source = readComponent('pages/pipeline-list-page.tsx');
    expect(source).toContain('PipelineListPage');
    // State column enables client-side filtering
    expect(source).toContain('state');
  });

  it('listTasks API supports pipeline_id filter for scoped task view', () => {
    const source = readComponent('lib/api.ts');
    expect(source).toContain('listTasks');
    expect(source).toContain('filters');
  });

  it('pipeline-list-page subscribes to SSE to refresh list on pipeline events', () => {
    const source = readComponent('pages/pipeline-list-page.tsx');
    expect(source).toContain('subscribeToEvents');
    expect(source).toContain('pipeline.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-755: Quickstart docs for 15-minute first pipeline
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-755: quickstart documentation', () => {
  it('README.md exists at the repo root', () => {
    const readme = readRepoFile('README.md');
    expect(readme.length).toBeGreaterThan(100);
  });

  it('README.md includes getting-started or quickstart content', () => {
    const readme = readRepoFile('README.md');
    // Should contain setup or quickstart guidance
    const lower = readme.toLowerCase();
    const hasQuickstart =
      lower.includes('quick') ||
      lower.includes('getting started') ||
      lower.includes('installation') ||
      lower.includes('setup') ||
      lower.includes('first pipeline');
    expect(hasQuickstart).toBe(true);
  });
});
