import { Component, lazy, Suspense, useEffect } from 'react';
import type { ComponentType, ErrorInfo, ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';

import { DashboardLayout } from '../components/layout/layout.js';
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

const LoginPage = lazyWithRetry(() => import('../pages/login/login-page.js').then((m) => ({ default: m.LoginPage })));

const LiveBoardPage = lazyWithRetry(() => import('../pages/live-board/live-board-page.js').then((m) => ({ default: m.LiveBoardPage })));
const AlertsApprovalsPage = lazyWithRetry(() => import('../pages/alerts-approvals/alerts-approvals-page.js').then((m) => ({ default: m.AlertsApprovalsPage })));
const CostDashboardPage = lazyWithRetry(() => import('../pages/cost-dashboard/cost-dashboard-page.js').then((m) => ({ default: m.CostDashboardPage })));

const WorkflowListPage = lazyWithRetry(() => import('../pages/workflow-list/workflow-list-page.js').then((m) => ({ default: m.WorkflowListPage })));
const WorkflowDetailPage = lazyWithRetry(() => import('../pages/workflow-detail/workflow-detail-page.js').then((m) => ({ default: m.WorkflowDetailPage })));
const WorkflowInspectorPage = lazyWithRetry(() => import('../pages/workflow-inspector/workflow-inspector-page.js').then((m) => ({ default: m.WorkflowInspectorPage })));
const TaskListPage = lazyWithRetry(() => import('../pages/task-list/task-list-page.js').then((m) => ({ default: m.TaskListPage })));
const TaskDetailPage = lazyWithRetry(() => import('../pages/task-detail/task-detail-page.js').then((m) => ({ default: m.TaskDetailPage })));
const ArtifactPreviewPage = lazyWithRetry(() => import('../components/artifact-preview/artifact-preview-page.js').then((m) => ({ default: m.ArtifactPreviewPage })));

const WorkspaceListPage = lazyWithRetry(() => import('../pages/workspace-list/workspace-list-page.js').then((m) => ({ default: m.WorkspaceListPage })));
const WorkspaceDetailPage = lazyWithRetry(() => import('../pages/workspace-detail/workspace-detail-page.js').then((m) => ({ default: m.WorkspaceDetailPage })));

const RoleDefinitionsPage = lazyWithRetry(() => import('../pages/role-definitions/role-definitions-page.js').then((m) => ({ default: m.RoleDefinitionsPage })));
const OrchestratorPage = lazyWithRetry(() => import('../pages/orchestrator/orchestrator-page.js').then((m) => ({ default: m.OrchestratorPage })));
const LlmProvidersPage = lazyWithRetry(() => import('../pages/llm-providers/llm-providers-page.js').then((m) => ({ default: m.LlmProvidersPage })));
const RuntimesPage = lazyWithRetry(() => import('../pages/runtimes/runtimes-page.js').then((m) => ({ default: m.RuntimesPage })));
const ExecutionEnvironmentsPage = lazyWithRetry(() => import('../pages/execution-environments/execution-environments-page.js').then((m) => ({ default: m.ExecutionEnvironmentsPage })));
const OperationsPage = lazyWithRetry(() => import('../pages/operations/operations-page.js').then((m) => ({ default: m.OperationsPage })));
const PlatformInstructionsPage = lazyWithRetry(() => import('../pages/platform-instructions/platform-instructions-page.js').then((m) => ({ default: m.PlatformInstructionsPage })));
const AiConfigAssistantPage = lazyWithRetry(() => import('../pages/ai-config-assistant/ai-config-assistant-page.js').then((m) => ({ default: m.AiConfigAssistantPage })));
const PlaybookListPage = lazyWithRetry(() => import('../pages/playbook-list/playbook-list-page.js').then((m) => ({ default: m.PlaybookListPage })));
const PlaybookDetailPage = lazyWithRetry(() => import('../pages/playbook-detail/playbook-detail-page.js').then((m) => ({ default: m.PlaybookDetailPage })));
const PlaybookLaunchPage = lazyWithRetry(() => import('../pages/playbook-launch/playbook-launch-page.js').then((m) => ({ default: m.PlaybookLaunchPage })));
const ToolsPage = lazyWithRetry(() => import('../pages/tools/tools-page.js').then((m) => ({ default: m.ToolsPage })));
const WebhooksPage = lazyWithRetry(() => import('../pages/webhooks/webhooks-page.js').then((m) => ({ default: m.WebhooksPage })));
const WorkItemTriggersPage = lazyWithRetry(() => import('../pages/work-item-triggers/work-item-triggers-page.js').then((m) => ({ default: m.WorkItemTriggersPage })));
const McpPage = lazyWithRetry(() => import('../pages/mcp/mcp-page.js').then((m) => ({ default: m.McpPage })));
const AcpPage = lazyWithRetry(() => import('../pages/acp/acp-page.js').then((m) => ({ default: m.AcpPage })));

const ContainersPage = lazyWithRetry(() => import('../pages/containers/containers-page.js').then((m) => ({ default: m.ContainersPage })));

const ApiKeyPage = lazyWithRetry(() => import('../pages/api-key/api-key-page.js').then((m) => ({ default: m.ApiKeyPage })));
const UserManagementPage = lazyWithRetry(() => import('../pages/user-management/user-management-page.js').then((m) => ({ default: m.UserManagementPage })));
const SettingsPage = lazyWithRetry(() => import('../pages/settings/settings-page.js').then((m) => ({ default: m.SettingsPage })));
const LogsPage = lazyWithRetry(() => import('../pages/logs/logs-page.js').then((m) => ({ default: m.LogsPage })));

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
            <Route path="/mission-control/workflows" element={<WorkflowListPage />} />
            <Route path="/mission-control/workflows/:id" element={<WorkflowDetailPage />} />
            <Route path="/mission-control/workflows/:id/inspector" element={<WorkflowInspectorPage />} />
            <Route path="/mission-control/tasks" element={<TaskListPage />} />
            <Route path="/mission-control/tasks/:id" element={<TaskDetailPage />} />
            <Route path="/mission-control/action-queue" element={<AlertsApprovalsPage />} />
            <Route path="/mission-control/costs" element={<CostDashboardPage />} />
            <Route path="/mission-control/alerts" element={<Navigate to="/mission-control/action-queue" replace />} />
            <Route path="/work/boards/*" element={<LegacyWorkflowBoardRedirect />} />
            <Route path="/work/workflows/*" element={<LegacyWorkflowBoardRedirect />} />
            <Route path="/work/tasks" element={<Navigate to="/mission-control/tasks" replace />} />
            <Route path="/work/tasks/:id" element={<LegacyTaskRedirect />} />
            <Route path="/work/approvals" element={<Navigate to="/mission-control/action-queue" replace />} />

            {/* Work Design */}
            <Route path="/artifacts/tasks/:taskId/:artifactId" element={<ArtifactPreviewPage />} />
            <Route path="/design/workspaces" element={<WorkspaceListPage />} />
            <Route path="/design/workspaces/:id" element={<WorkspaceDetailPage />} />
            <Route path="/design/workspaces/:id/memory" element={<LegacyWorkspaceKnowledgeRedirect />} />
            <Route path="/design/workspaces/:id/content" element={<LegacyWorkspaceKnowledgeRedirect />} />
            <Route path="/design/workspaces/:id/artifacts" element={<LegacyWorkspaceKnowledgeRedirect />} />
            <Route path="/workspaces" element={<Navigate to="/design/workspaces" replace />} />
            <Route path="/workspaces/memory" element={<Navigate to="/design/workspaces" replace />} />
            <Route path="/workspaces/content" element={<Navigate to="/design/workspaces" replace />} />
            <Route path="/workspaces/*" element={<LegacyWorkspaceRouteRedirect />} />
            <Route path="/design/playbooks" element={<PlaybookListPage />} />
            <Route path="/design/playbooks/:id" element={<PlaybookDetailPage />} />
            <Route path="/design/playbooks/:id/launch" element={<PlaybookLaunchPage />} />
            <Route path="/design/playbooks/launch" element={<PlaybookLaunchPage />} />
            <Route path="/config/playbooks/*" element={<LegacyPlaybookRouteRedirect />} />
            <Route path="/design/specialists" element={<RoleDefinitionsPage />} />
            <Route path="/design/roles" element={<LegacySpecialistsRouteRedirect />} />
            <Route path="/config/roles" element={<Navigate to="/design/specialists" replace />} />

            {/* Platform */}
            <Route path="/platform/orchestrator" element={<OrchestratorPage />} />
            <Route path="/platform/models" element={<LlmProvidersPage />} />
            <Route path="/platform/runtimes" element={<Navigate to="/admin/agentic-settings" replace />} />
            <Route path="/platform/environments" element={<ExecutionEnvironmentsPage />} />
            <Route path="/platform/operations" element={<Navigate to="/admin/platform-settings" replace />} />
            <Route path="/platform/instructions" element={<PlatformInstructionsPage />} />
            <Route path="/platform/tools" element={<ToolsPage />} />
            <Route path="/config/orchestrator" element={<Navigate to="/platform/orchestrator" replace />} />
            <Route path="/config/llm" element={<Navigate to="/platform/models" replace />} />
            <Route path="/config/runtimes" element={<Navigate to="/admin/agentic-settings" replace />} />
            <Route path="/config/instructions" element={<Navigate to="/platform/instructions" replace />} />
            <Route path="/config/runtime-defaults" element={<Navigate to="/admin/agentic-settings" replace />} />
            <Route path="/config/tools" element={<Navigate to="/platform/tools" replace />} />
            <Route path="/config/assistant" element={<AiConfigAssistantPage />} />

            {/* Integrations */}
            <Route path="/integrations/webhooks" element={<WebhooksPage />} />
            <Route path="/integrations/triggers" element={<WorkItemTriggersPage />} />
            <Route path="/integrations/mcp" element={<McpPage />} />
            <Route path="/integrations/acp" element={<AcpPage />} />
            <Route path="/integrations/agent-protocols" element={<Navigate to="/integrations/mcp" replace />} />
            <Route path="/config/webhooks" element={<Navigate to="/integrations/webhooks" replace />} />
            <Route path="/config/triggers" element={<Navigate to="/integrations/triggers" replace />} />
            <Route path="/config/agent-protocols" element={<Navigate to="/integrations/mcp" replace />} />
            <Route path="/config/work-item-triggers" element={<Navigate to="/integrations/triggers" replace />} />

            {/* Diagnostics */}
            <Route path="/diagnostics/live-logs" element={<LogsPage />} />
            <Route path="/diagnostics/live-containers" element={<ContainersPage />} />
            <Route path="/diagnostics/logs" element={<LegacyLiveLogsRedirect />} />
            <Route path="/diagnostics/containers" element={<LegacyLiveContainersRedirect />} />
            <Route path="/logs" element={<LegacyLiveLogsRedirect />} />
            <Route path="/fleet/containers" element={<LegacyLiveContainersRedirect />} />

            {/* Admin */}
            <Route path="/admin/general-settings" element={<SettingsPage />} />
            <Route path="/admin/settings" element={<Navigate to="/admin/general-settings" replace />} />
            <Route path="/admin/api-keys" element={<ApiKeyPage />} />
            <Route path="/admin/agentic-settings" element={<RuntimesPage />} />
            <Route path="/admin/agent-settings" element={<Navigate to="/admin/agentic-settings" replace />} />
            <Route path="/admin/platform-settings" element={<OperationsPage />} />
            <Route path="/governance/settings" element={<Navigate to="/admin/general-settings" replace />} />
            <Route path="/governance/api-keys" element={<Navigate to="/admin/api-keys" replace />} />
            <Route path="/governance/users" element={<UserManagementPage />} />
            <Route path="/governance/retention" element={<Navigate to="/admin/general-settings" replace />} />
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

function LegacyWorkflowBoardRedirect(): JSX.Element {
  const location = useLocation();
  const nextPath = location.pathname.startsWith('/work/workflows')
    ? location.pathname.replace('/work/workflows', '/mission-control/workflows')
    : location.pathname.replace('/work/boards', '/mission-control/workflows');
  return (
    <Navigate
      to={`${nextPath}${location.search}${location.hash}`}
      replace
    />
  );
}

function LegacyTaskRedirect(): JSX.Element {
  const location = useLocation();
  return (
    <Navigate
      to={`${location.pathname.replace('/work/tasks', '/mission-control/tasks')}${location.search}${location.hash}`}
      replace
    />
  );
}

function LegacyWorkspaceKnowledgeRedirect(): JSX.Element {
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return <Navigate to="/design/workspaces" replace />;
  }
  const panel = location.pathname.endsWith('/memory')
    ? 'memory'
    : location.pathname.endsWith('/artifacts')
      ? 'artifacts'
      : 'artifacts';
  return <Navigate to={`/design/workspaces/${id}?tab=knowledge&panel=${panel}`} replace />;
}

function LegacyWorkspaceRouteRedirect(): JSX.Element {
  const location = useLocation();
  return (
    <Navigate
      to={`${location.pathname.replace('/workspaces', '/design/workspaces')}${location.search}${location.hash}`}
      replace
    />
  );
}

function LegacyPlaybookRouteRedirect(): JSX.Element {
  const location = useLocation();
  return (
    <Navigate
      to={`${location.pathname.replace('/config/playbooks', '/design/playbooks')}${location.search}${location.hash}`}
      replace
    />
  );
}

function LegacySpecialistsRouteRedirect(): JSX.Element {
  const location = useLocation();
  return (
    <Navigate
      to={`${location.pathname.replace('/design/roles', '/design/specialists')}${location.search}${location.hash}`}
      replace
    />
  );
}

function LegacyLiveLogsRedirect(): JSX.Element {
  const location = useLocation();
  return <Navigate to={`/diagnostics/live-logs${location.search}${location.hash}`} replace />;
}

function LegacyLiveContainersRedirect(): JSX.Element {
  const location = useLocation();
  return <Navigate to={`/diagnostics/live-containers${location.search}${location.hash}`} replace />;
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
