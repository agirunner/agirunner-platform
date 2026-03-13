import { Component, lazy, Suspense, useEffect } from 'react';
import type { ComponentType, ErrorInfo, ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { DashboardLayout } from '../components/layout.js';
import { resolveAuthCallbackSession } from '../lib/auth-callback.js';
import {
  completeSsoBrowserSession,
  hasDashboardSession,
  resolveAuthCallbackRedirect,
} from '../lib/auth-session.js';
import { clearSession, readSession } from '../lib/session.js';

import { applyTheme, readTheme } from './theme.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

/* ── Chunk-resilient lazy loader ──────────────────────────────────────── */

/**
 * Wraps React.lazy with automatic retry on chunk load failures.
 * When Vite rebuilds, old chunk hashes become stale. This catches the
 * resulting import error and reloads the page once to pick up the new manifest.
 */
function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(() =>
    factory().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!isChunkLoadError(message)) throw error;

      const reloadKey = 'chunk_reload_ts';
      const lastReload = Number(sessionStorage.getItem(reloadKey) ?? '0');
      if (Date.now() - lastReload < 10_000) throw error;

      sessionStorage.setItem(reloadKey, String(Date.now()));
      window.location.reload();
      return new Promise<never>(() => {});
    }),
  );
}

function isChunkLoadError(message: string): boolean {
  return (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Loading chunk') ||
    message.includes('Loading CSS chunk') ||
    message.includes('error loading dynamically imported module')
  );
}

/* ── Lazy page imports ────────────────────────────────────────────────── */

const LoginPage = lazyWithRetry(() => import('../pages/login-page.js').then((m) => ({ default: m.LoginPage })));

const LiveBoardPage = lazyWithRetry(() => import('../pages/mission-control/live-board-page.js').then((m) => ({ default: m.LiveBoardPage })));
const AlertsApprovalsPage = lazyWithRetry(() => import('../pages/mission-control/alerts-approvals-page.js').then((m) => ({ default: m.AlertsApprovalsPage })));
const CostDashboardPage = lazyWithRetry(() => import('../pages/mission-control/cost-dashboard-page.js').then((m) => ({ default: m.CostDashboardPage })));

const WorkflowListPage = lazyWithRetry(() => import('../pages/work/workflow-list-page.js').then((m) => ({ default: m.WorkflowListPage })));
const WorkflowDetailPage = lazyWithRetry(() => import('../pages/workflow-detail-page.js').then((m) => ({ default: m.WorkflowDetailPage })));
const WorkflowInspectorPage = lazyWithRetry(() => import('../pages/work/workflow-inspector-page.js').then((m) => ({ default: m.WorkflowInspectorPage })));
const TaskListPage = lazyWithRetry(() => import('../pages/work/task-list-page.js').then((m) => ({ default: m.TaskListPage })));
const TaskDetailPage = lazyWithRetry(() => import('../pages/work/task-detail-page.js').then((m) => ({ default: m.TaskDetailPage })));
const ArtifactPreviewPage = lazyWithRetry(() => import('../components/artifact-preview-page.js').then((m) => ({ default: m.ArtifactPreviewPage })));
const ApprovalQueuePage = lazyWithRetry(() => import('../pages/work/approval-queue-page.js').then((m) => ({ default: m.ApprovalQueuePage })));

const ProjectListPage = lazyWithRetry(() => import('../pages/projects/project-list-page.js').then((m) => ({ default: m.ProjectListPage })));
const ProjectDetailPage = lazyWithRetry(() => import('../pages/projects/project-detail-page.js').then((m) => ({ default: m.ProjectDetailPage })));
const MemoryBrowserPage = lazyWithRetry(() => import('../pages/projects/memory-browser-page.js').then((m) => ({ default: m.MemoryBrowserPage })));
const ContentBrowserPage = lazyWithRetry(() => import('../pages/projects/content-browser-page.js').then((m) => ({ default: m.ContentBrowserPage })));
const ProjectMemoryBrowserPage = lazyWithRetry(() => import('../pages/projects/project-memory-browser-page.js').then((m) => ({ default: m.ProjectMemoryBrowserPage })));
const ProjectContentBrowserPage = lazyWithRetry(() => import('../pages/projects/project-content-browser-page.js').then((m) => ({ default: m.ProjectContentBrowserPage })));
const ProjectArtifactBrowserPage = lazyWithRetry(() => import('../pages/projects/project-artifact-browser-page.js').then((m) => ({ default: m.ProjectArtifactBrowserPage })));

const RoleDefinitionsPage = lazyWithRetry(() => import('../pages/config/role-definitions-page.js').then((m) => ({ default: m.RoleDefinitionsPage })));
const LlmProvidersPage = lazyWithRetry(() => import('../pages/config/llm-providers-page.js').then((m) => ({ default: m.LlmProvidersPage })));
const RuntimesPage = lazyWithRetry(() => import('../pages/config/runtimes-page.js').then((m) => ({ default: m.RuntimesPage })));
const IntegrationsPage = lazyWithRetry(() => import('../pages/config/integrations-page.js').then((m) => ({ default: m.IntegrationsPage })));
const PlatformInstructionsPage = lazyWithRetry(() => import('../pages/config/platform-instructions-page.js').then((m) => ({ default: m.PlatformInstructionsPage })));
const AiConfigAssistantPage = lazyWithRetry(() => import('../pages/config/ai-config-assistant-page.js').then((m) => ({ default: m.AiConfigAssistantPage })));
const PlaybookListPage = lazyWithRetry(() => import('../pages/config/playbook-list-page.js').then((m) => ({ default: m.PlaybookListPage })));
const PlaybookDetailPage = lazyWithRetry(() => import('../pages/config/playbook-detail-page.js').then((m) => ({ default: m.PlaybookDetailPage })));
const PlaybookLaunchPage = lazyWithRetry(() => import('../pages/config/playbook-launch-page.js').then((m) => ({ default: m.PlaybookLaunchPage })));
const ToolsPage = lazyWithRetry(() => import('../pages/config/tools-page.js').then((m) => ({ default: m.ToolsPage })));
const WebhooksPage = lazyWithRetry(() => import('../pages/config/webhooks-page.js').then((m) => ({ default: m.WebhooksPage })));
const WorkItemTriggersPage = lazyWithRetry(() => import('../pages/config/work-item-triggers-page.js').then((m) => ({ default: m.WorkItemTriggersPage })));

const WorkerListPage = lazyWithRetry(() => import('../pages/fleet/worker-list-page.js').then((m) => ({ default: m.WorkerListPage })));
const AgentListPage = lazyWithRetry(() => import('../pages/fleet/agent-list-page.js').then((m) => ({ default: m.AgentListPage })));
const DockerPage = lazyWithRetry(() => import('../pages/fleet/docker-page.js').then((m) => ({ default: m.DockerPage })));
const WarmPoolsPage = lazyWithRetry(() => import('../pages/fleet/warm-pools-page.js').then((m) => ({ default: m.WarmPoolsPage })));
const FleetStatusPage = lazyWithRetry(() => import('../pages/fleet/fleet-status-page.js').then((m) => ({ default: m.FleetStatusPage })));

const ApiKeyPage = lazyWithRetry(() => import('../pages/governance/api-key-page.js').then((m) => ({ default: m.ApiKeyPage })));
const UserManagementPage = lazyWithRetry(() => import('../pages/governance/user-management-page.js').then((m) => ({ default: m.UserManagementPage })));
const RetentionPolicyPage = lazyWithRetry(() => import('../pages/governance/retention-policy-page.js').then((m) => ({ default: m.RetentionPolicyPage })));
const OrchestratorGrantsPage = lazyWithRetry(() => import('../pages/governance/orchestrator-grants-page.js').then((m) => ({ default: m.OrchestratorGrantsPage })));
const SettingsPage = lazyWithRetry(() => import('../pages/governance/settings-page.js').then((m) => ({ default: m.SettingsPage })));
const LogsPage = lazyWithRetry(() => import('../pages/mission-control/logs-page.js').then((m) => ({ default: m.LogsPage })));

function PageFallback(): JSX.Element {
  return (
    <div className="flex items-center justify-center p-12 text-muted">
      Loading...
    </div>
  );
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AppErrorBoundary]', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const message = this.state.error?.message ?? '';

    const isAuthError = message.includes('401') || message.includes('Unauthorized');
    if (isAuthError) {
      clearSession();
      window.location.assign('/login');
      return null;
    }

    if (isChunkLoadError(message)) {
      const reloadKey = 'chunk_reload_ts';
      const lastReload = Number(sessionStorage.getItem(reloadKey) ?? '0');
      if (Date.now() - lastReload > 10_000) {
        sessionStorage.setItem(reloadKey, String(Date.now()));
        window.location.reload();
        return null;
      }
    }

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted max-w-md text-center">
          {message || 'An unexpected error occurred.'}
        </p>
        <button
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          onClick={() => {
            this.setState({ hasError: false, error: null });
            window.location.reload();
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}

export function App(): JSX.Element {
  useEffect(() => {
    applyTheme(readTheme());
  }, []);

  const toggleTheme = (): void => {
    const next = readTheme() === 'light' ? 'dark' : 'light';
    applyTheme(next);
  };

  return (
    <AppErrorBoundary>
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<SSOCallbackPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<DashboardLayout onToggleTheme={toggleTheme} />}>
            <Route path="/" element={<Navigate to="/mission-control" replace />} />

            {/* Mission Control */}
            <Route path="/mission-control" element={<LiveBoardPage />} />
            <Route path="/mission-control/alerts" element={<AlertsApprovalsPage />} />
            <Route path="/mission-control/costs" element={<CostDashboardPage />} />
            <Route path="/logs" element={<LogsPage />} />

            {/* Work */}
            <Route path="/work/workflows" element={<WorkflowListPage />} />
            <Route path="/work/workflows/:id" element={<WorkflowDetailPage />} />
            <Route path="/work/workflows/:id/inspector" element={<WorkflowInspectorPage />} />
            <Route path="/work/tasks" element={<TaskListPage />} />
            <Route path="/work/tasks/:id" element={<TaskDetailPage />} />
            <Route path="/artifacts/tasks/:taskId/:artifactId" element={<ArtifactPreviewPage />} />
            <Route path="/work/approvals" element={<ApprovalQueuePage />} />

            {/* Projects */}
            <Route path="/projects" element={<ProjectListPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/projects/:id/memory" element={<ProjectMemoryBrowserPage />} />
            <Route path="/projects/:id/content" element={<ProjectContentBrowserPage />} />
            <Route path="/projects/:id/artifacts" element={<ProjectArtifactBrowserPage />} />
            <Route path="/projects/memory" element={<MemoryBrowserPage />} />
            <Route path="/projects/content" element={<ContentBrowserPage />} />

            {/* Configuration */}
            <Route path="/config/playbooks" element={<PlaybookListPage />} />
            <Route path="/config/playbooks/:id" element={<PlaybookDetailPage />} />
            <Route path="/config/playbooks/:id/launch" element={<PlaybookLaunchPage />} />
            <Route path="/config/playbooks/launch" element={<PlaybookLaunchPage />} />
            <Route path="/config/roles" element={<RoleDefinitionsPage />} />
            <Route path="/config/llm" element={<LlmProvidersPage />} />
            <Route path="/config/runtimes" element={<RuntimesPage />} />
            <Route path="/config/integrations" element={<IntegrationsPage />} />
            <Route path="/config/instructions" element={<PlatformInstructionsPage />} />
            <Route path="/config/assistant" element={<AiConfigAssistantPage />} />
            <Route path="/config/runtime-defaults" element={<Navigate to="/config/runtimes" replace />} />
            <Route path="/config/tools" element={<ToolsPage />} />
            <Route path="/config/webhooks" element={<WebhooksPage />} />
            <Route path="/config/triggers" element={<WorkItemTriggersPage />} />
            <Route path="/config/work-item-triggers" element={<Navigate to="/config/triggers" replace />} />

            {/* Fleet */}
            <Route path="/fleet/workers" element={<WorkerListPage />} />
            <Route path="/fleet/agents" element={<AgentListPage />} />
            <Route path="/fleet/docker" element={<DockerPage />} />
            <Route path="/fleet/warm-pools" element={<WarmPoolsPage />} />
            <Route path="/fleet/status" element={<FleetStatusPage />} />

            {/* Governance */}
            <Route path="/governance/settings" element={<SettingsPage />} />
            <Route path="/governance/api-keys" element={<ApiKeyPage />} />
            <Route path="/governance/users" element={<UserManagementPage />} />
            <Route path="/governance/retention" element={<RetentionPolicyPage />} />
            <Route path="/governance/grants" element={<OrchestratorGrantsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/mission-control" replace />} />
      </Routes>
    </Suspense>
    </AppErrorBoundary>
  );
}

function RequireAuth(): JSX.Element {
  const navigate = useNavigate();
  const isAuthenticated = hasDashboardSession();

  useEffect(() => {
    if (!isAuthenticated) {
      clearSession();
      navigate('/login', { replace: true });
    }
  }, [navigate, isAuthenticated]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

function SSOCallbackPage(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let isActive = true;
    const searchParams = new URLSearchParams(location.search);
    const redirectTo = resolveAuthCallbackRedirect(searchParams);

    async function completeSignIn(): Promise<void> {
      const existingSession = readSession();

      try {
        const session = await resolveAuthCallbackSession({
          apiBaseUrl: API_BASE_URL,
          cookieHeader: typeof document === "undefined" ? "" : document.cookie,
        });
        const completed = completeSsoBrowserSession(
          new URLSearchParams({ tenant_id: session.tenantId }),
          session.accessToken ? { accessToken: session.accessToken } : undefined,
        );
        if (!isActive) {
          return;
        }

        navigate(completed ? redirectTo : "/login", { replace: true });
      } catch {
        if (isActive) {
          if (existingSession) {
            navigate(redirectTo, { replace: true });
            return;
          }

          clearSession();
          navigate("/login", { replace: true });
        }
      }
    }

    void completeSignIn();

    return () => {
      isActive = false;
    };
  }, [location.search, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted">Completing sign in...</p>
    </div>
  );
}
