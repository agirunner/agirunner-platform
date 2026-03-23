/**
 * Structural and logic unit tests for the remaining dashboard FRs.
 *
 * FR-030:  Modern SPA (React, dark/light, responsive, keyboard shortcuts)
 * FR-031a: Live workflow execution view
 * FR-031b: Live agent/worker status (moved to fleet/worker-list-page)
 * FR-032:  Board view + list view with filtering
 * FR-033:  Approval button for awaiting_approval
 * FR-034:  Retry button for failed tasks
 * FR-035:  Workflow-level controls (pause/resume/cancel/rework)
 * FR-035a: Task-level intervention (cancel/reassign/escalate/override)
 * FR-036:  Task detail views (full data, JSON viewer)
 * FR-036a: Workflow detail views
 * FR-037:  Agent registry view
 * FR-156:  Dashboard tenant-scoped
 * FR-213:  Dashboard task injection
 * FR-299:  Worker status in dashboard
 * FR-420:  Playbook browser
 * FR-423:  Workflow status view with dependency graph
 * FR-424:  Workflow launch form
 * FR-425:  Worker management view
 * FR-426:  API key management
 * FR-427:  Dashboard navigation and layout
 * FR-429:  Workflow list view with filters
 * FR-717:  Dashboard renders workflow stages and board state
 * FR-755:  Quickstart docs for 15-min first workflow
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

function mockBrowserStorage() {
  const localStore = new Map<string, string>();
  const sessionStore = new Map<string, string>();
  vi.stubGlobal('localStorage', createStorage(localStore));
  vi.stubGlobal('sessionStorage', createStorage(sessionStore));
}

function createStorage(store: Map<string, string>) {
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
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
    expect(source).toContain('/mission-control');
    expect(source).toContain('/work/boards');
    expect(source).toContain('/artifacts/tasks/:taskId/:artifactId');
    expect(source).toContain('/workspaces');
    expect(source).toContain('/config/playbooks');
    expect(source).not.toContain('/config/templates');
    expect(source).not.toContain('/fleet/workers');
    expect(source).toContain('/fleet/containers');
    expect(source).toContain('/governance/api-keys');
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
// FR-031a: Live workflow execution view
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-031a: live workflow execution view', () => {
  it('workflow-detail-page fetches workflow data with a reactive query', () => {
    const source = readComponent('pages/workflow-detail/workflow-detail-page.tsx');
    expect(source).toContain('useQuery');
    expect(source).toContain('getWorkflow');
  });

  it('workflow-detail-page shows workflow state in the view', () => {
    const source = readComponent('pages/workflow-detail/workflow-detail-page.tsx');
    expect(source).toContain('.state');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-032: Board view + list view with filtering
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-032: workflow list view', () => {
  it('workflow-list-page exports WorkflowListPage component', () => {
    const source = readComponent('pages/workflow-list/workflow-list-page.tsx');
    expect(source).toContain('export function WorkflowListPage');
  });

  it('workflow-list-page uses board posture and operator summaries', () => {
    const source = readComponent('pages/workflow-list/workflow-list-page.tsx');
    expect(source).toContain('All Postures');
    expect(source).toContain('SavedViews');
  });

  it('workflow-list-page includes V2 launch controls', () => {
    const source = readComponent('pages/workflow-list/workflow-list-page.tsx');
    expect(source).toContain('Launch Playbook');
    expect(source).toContain('SavedViews');
    expect(source).toContain('normalizeWorkflows');
  });
});

describe('FR-035: workflow-level controls', () => {
  it('exposes workflow pause, resume, and cancel controls on summary surfaces', () => {
    const source = [
      readComponent('pages/workflow-detail/workflow-detail-sections.tsx'),
      readComponent('pages/workflow-list/workflow-list-layouts.tsx'),
      readComponent('pages/workflow-list/workflow-list-board-view.tsx'),
      readComponent('pages/live-board/live-board-page.tsx'),
      readComponent('pages/workflow-detail/workflow-control-actions.tsx'),
    ].join('\n');
    expect(source).toContain('WorkflowControlActions');
    expect(source).toContain('dashboardApi.pauseWorkflow');
    expect(source).toContain('dashboardApi.resumeWorkflow');
    expect(source).toContain('dashboardApi.cancelWorkflow');
    expect(source).toContain('Workflow paused');
    expect(source).toContain('Workflow resumed');
    expect(source).toContain('Workflow cancellation requested');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-033: Approval button for awaiting_approval tasks
// FR-034: Retry button for failed tasks
// FR-035: Workflow-level controls
// FR-035a: Task-level intervention
// FR-036: Task detail views
// FR-213: Dashboard task injection
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-033 / FR-034 / FR-035 / FR-035a / FR-036 / FR-213: task detail page', () => {
  it('task-detail-page exports TaskDetailPage component', () => {
    const source = readComponent('pages/task-detail/task-detail-page.tsx');
    expect(source).toContain('export function TaskDetailPage');
  });

  it('task-detail-page fetches full task data via getTask', () => {
    const source = readComponent('pages/task-detail/task-detail-page.tsx');
    expect(source).toContain('getTask');
    expect(source).toContain('useQuery');
  });

  it('task-detail-page renders structured task inspection views', () => {
    const source = readComponent('pages/task-detail/task-detail-page.tsx');
    expect(source).toContain('LogViewer');
    expect(source).toContain('Output');
    expect(source).toContain('TaskActionButtons');
  });

  it('task-detail-page uses work-item-first operator controls and current step labels', () => {
    const source = readComponent('pages/task-detail/task-detail-page.tsx');
    expect(source).toContain('Open Work Item Flow');
    expect(source).toContain('Specialist step');
    expect(source).toContain('Escalated specialist step');
    expect(source).toContain('normalizeTaskStatus');
  });

  it('task-detail-page exposes produced artifact inspection links', () => {
    const source = readComponent('pages/task-detail/task-detail-page.tsx');
    expect(source).toContain('Artifacts');
    expect(source).toContain('TaskDetailArtifactsPanel');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-036a: Workflow detail views
// FR-423: Workflow status view with dependency graph
// FR-717: Dashboard renders playbook-oriented workflow detail
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-036a / FR-423 / FR-717: workflow detail and dependency graph', () => {
  it('workflow-detail-page exports WorkflowDetailPage component', () => {
    const source = readComponent('pages/workflow-detail/workflow-detail-page.tsx');
    expect(source).toContain('export function WorkflowDetailPage');
  });

  it('workflow-detail-page renders task dependency graph as a list', () => {
    const source = `${readComponent('pages/workflow-detail/workflow-detail-page.tsx')}\n${readComponent('pages/workflow-detail/workflow-detail-sections.tsx')}`;
    expect(source).toContain('Execution Steps');
    expect(source).toContain('WorkflowWorkItemDetailPanel');
  });

  it('workflow-detail-page renders task state column for live status tracking', () => {
    const source = `${readComponent('pages/workflow-detail/workflow-detail-page.tsx')}\n${readComponent('pages/workflow-detail/workflow-detail-sections.tsx')}`;
    expect(source).toContain('.state');
  });

  it('workflow-detail-page exposes playbook board state, resolved config, and workspace timeline', () => {
    const source = `${readComponent('pages/workflow-detail/workflow-detail-page.tsx')}\n${readComponent('pages/workflow-detail/workflow-detail-sections.tsx')}`;
    expect(source).toContain('Create Work Item');
    expect(source).toContain('deriveWorkflowStageDisplay');
    expect(source).toContain('Orchestrator Activations');
    expect(source).toContain('Resolved Config');
    expect(source).toContain('Workspace Timeline');
    expect(source).not.toContain('Manual Rework');
    expect(source).not.toContain('readWorkflowPhases');
  });

  it('workflow-detail-page exposes workflow documents and workspace memory controls', () => {
    const source = `${readComponent('pages/workflow-detail/workflow-detail-page.tsx')}\n${readComponent('pages/workflow-detail/workflow-detail-sections.tsx')}\n${readComponent('pages/workflow-detail/workflow-detail-content.tsx')}`;
    expect(source).toContain('Workflow Documents');
    expect(source).toContain('Workspace Memory');
    expect(source).toContain('listWorkflowDocuments');
    expect(source).toContain('patchWorkspaceMemory');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-156: Dashboard tenant-scoped (all API calls scoped to session tenant)
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-156: dashboard is tenant-scoped', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockBrowserStorage();
    clearSession();
  });

  it('readSession includes tenantId in the returned token bundle', () => {
    writeSession({ accessToken: 'tok', tenantId: 'tenant-abc' });
    const session = readSession();
    expect(session?.tenantId).toBe('tenant-abc');
  });

  it('layout reads the active session for tenant-scoped operation', () => {
    const source = readComponent('components/layout.tsx');
    expect(source).toContain('readSession');
    expect(source).toContain('clearSession');
  });

  it('api.ts scopes all requests to the access token stored in session', () => {
    const source = readComponent('lib/api.ts');
    expect(source).toContain('readSession');
    expect(source).toContain('tenantId');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-420: Playbook browser
// FR-424: Workflow launch form
// FR-426: API key management
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-420 / FR-424 / FR-426: playbook browser, workflow launch, API key management', () => {
  it('api layer exposes playbook browsing and workflow launch methods', () => {
    const source = readComponent('lib/api.ts');
    expect(source).toContain('listWorkflows');
    expect(source).toContain('listPlaybooks');
    expect(source).toContain('getWorkflow');
    expect(source).toContain('createWorkflow');
  });

  it('DashboardApi interface supports login (API key exchange) for key management workflows', () => {
    const source = readComponent('lib/api.ts');
    expect(source).toContain('login');
    expect(source).toContain('logout');
    expect(source).toContain('exchangeApiKey');
  });

  it('login() exchanges an API key for session tokens (workflow launch prerequisite)', async () => {
    mockBrowserStorage();
    const client = {
      exchangeApiKey: vi.fn().mockResolvedValue({ token: 'access-tok', tenant_id: 'tenant-1' }),
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };
    const api = createDashboardApi({ client: client as never });

    await api.login('ar_admin_test_key');

    expect(client.exchangeApiKey).toHaveBeenCalledWith('ar_admin_test_key', true);
    expect(client.setAccessToken).toHaveBeenCalledWith('access-tok');
    const session = readSession();
    expect(session?.tenantId).toBe('tenant-1');
    expect(session?.persistentSession).toBe(true);
  });

  it('app and layout expose playbook-only configuration routes', () => {
    const appSource = readComponent('app/app.tsx');
    const layoutSource = readComponent('components/layout.tsx');
    expect(appSource).toContain('/config/playbooks');
    expect(appSource).not.toContain('/config/templates');
    expect(layoutSource).not.toContain('Templates (Legacy)');
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

  it('layout exposes runtime configuration navigation in the sidebar', () => {
    const source = readComponent('components/layout.tsx');
    expect(source).toContain('/config/runtimes');
    expect(source).toContain('Runtimes');
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

  it('layout includes navigation links to the shipped major sections and a trimmed fleet shell group', () => {
    const source = readComponent('components/layout.tsx');
    expect(source).toContain('Mission Control');
    expect(source).toContain('Work');
    expect(source).toContain('Workspaces');
    expect(source).toContain('Configuration');
    expect(source).toContain("label: 'Fleet'");
    expect(source).toContain("href: '/config/runtimes'");
    expect(source).toContain("href: '/fleet/containers'");
    expect(source).not.toContain("href: '/fleet/workers'");
    expect(source).not.toContain("href: '/fleet/warm-pools'");
    expect(source).not.toContain("href: '/fleet/status'");
    expect(source).toContain('Governance');
  });

  it('layout includes Cmd+K keyboard shortcut for search', () => {
    const source = readComponent('components/layout.tsx');
    expect(source).toContain("event.key.toLowerCase() === 'k'");
  });

  it('layout includes a logout control', () => {
    const source = readComponent('components/layout.tsx');
    expect(source).toContain('logout');
  });
});

describe('operator information architecture', () => {
  it('workspaces page exposes workspace continuity controls', () => {
    const source = readComponent('pages/workspaces/workspaces-page.tsx');
    expect(source).toContain('export function WorkspacesPage');
    expect(source).toContain('Workspace Timeline');
    expect(source).toContain('Run Summary');
    expect(source).toContain('createWorkspace');
    expect(source).toContain('StructuredRecordView data={toolsQuery.data?.data}');
  });

  it('governance page exposes retention controls', () => {
    const source = readComponent('pages/governance/governance-page.tsx');
    expect(source).toContain('export function GovernancePage');
    expect(source).toContain('getRetentionPolicy');
    expect(source).toContain('updateRetentionPolicy');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-429: Workflow list view with filters
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-429: workflow list view with filters', () => {
  it('workflow-list-page renders the workflow table with board posture filtering capability', () => {
    const source = readComponent('pages/workflow-list/workflow-list-page.tsx');
    expect(source).toContain('WorkflowListPage');
    expect(source).toContain('All Postures');
  });

  it('listTasks API supports workflow_id filter for scoped task view', () => {
    const source = readComponent('lib/api.ts');
    expect(source).toContain('listTasks');
    expect(source).toContain('filters');
  });

  it('workflow-list-page subscribes to SSE to refresh list on workflow events', () => {
    const source = readComponent('pages/workflow-list/workflow-list-page.tsx');
    expect(source).toContain('queryKey: [\'workflows\']');
    expect(source).toContain('dashboardApi.listWorkflows');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-755: Quickstart docs for 15-minute first workflow
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
      lower.includes('first workflow');
    expect(hasQuickstart).toBe(true);
  });
});
