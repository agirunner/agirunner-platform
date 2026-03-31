import { Component, Suspense, useEffect } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';

import { DashboardLayout } from '../components/layout/layout.js';
import { resolveAuthCallbackSession } from '../lib/auth-callback.js';
import {
  completeSsoBrowserSession,
  hasDashboardSession,
  resolveAuthCallbackRedirect,
} from '../lib/auth-session.js';
import { clearSession, readSession } from '../lib/session.js';
import {
  buildWorkflowDiagnosticsHref,
  buildWorkflowsLaunchHref,
  buildWorkflowsPageHref,
} from '../pages/workflows/workflows-page.support.js';
import { buildWorkflowDetailPermalink } from '../pages/workflow-detail/workflow-detail-permalinks.js';

import {
  AgenticSettingsPage,
  ApiKeyPage,
  ArtifactPreviewPage,
  ExecutionEnvironmentsPage,
  isChunkLoadError,
  LiveContainersPage,
  LoginPage,
  LogsPage,
  McpPage,
  ModelsPage,
  OrchestratorPage,
  PageFallback,
  PlatformInstructionsPage,
  PlatformSettingsPage,
  PlaybookDetailPage,
  PlaybookListPage,
  SettingsPage,
  SpecialistsPage,
  SkillsPage,
  TaskDetailPage,
  ToolsPage,
  WebhooksPage,
  WorkflowsPage,
  WorkItemTriggersPage,
  WorkspaceDetailPage,
  WorkspaceListPage,
} from './app-page-loaders.js';
import { applyTheme, readTheme } from './theme.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

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
              <Route path="/" element={<Navigate to="/workflows" replace />} />

              {/* Workflows */}
              <Route path="/workflows" element={<WorkflowsPage />} />
              <Route path="/workflows/:workflowId" element={<WorkflowsPage />} />
              <Route path="/work/boards/*" element={<LegacyWorkflowBoardRedirect />} />
              <Route path="/work/workflows/*" element={<LegacyWorkflowBoardRedirect />} />
              <Route
                path="/work/tasks"
                element={<Navigate to={buildWorkflowsPageHref({ mode: 'recent', tab: 'live_console' })} replace />}
              />
              <Route path="/work/tasks/:id" element={<TaskDetailPage />} />
              <Route
                path="/work/approvals"
                element={<Navigate to={buildWorkflowsPageHref({ tab: 'needs_action' })} replace />}
              />

              {/* Work Design */}
              <Route
                path="/artifacts/tasks/:taskId/:artifactId"
                element={<ArtifactPreviewPage />}
              />
              <Route path="/design/workspaces" element={<WorkspaceListPage />} />
              <Route path="/design/workspaces/:id" element={<WorkspaceDetailPage />} />
              <Route
                path="/design/workspaces/:id/memory"
                element={<LegacyWorkspaceKnowledgeRedirect />}
              />
              <Route
                path="/design/workspaces/:id/content"
                element={<LegacyWorkspaceKnowledgeRedirect />}
              />
              <Route
                path="/design/workspaces/:id/artifacts"
                element={<LegacyWorkspaceKnowledgeRedirect />}
              />
              <Route path="/workspaces" element={<Navigate to="/design/workspaces" replace />} />
              <Route
                path="/workspaces/memory"
                element={<Navigate to="/design/workspaces" replace />}
              />
              <Route
                path="/workspaces/content"
                element={<Navigate to="/design/workspaces" replace />}
              />
              <Route path="/workspaces/*" element={<LegacyWorkspaceRouteRedirect />} />
              <Route path="/design/playbooks" element={<PlaybookListPage />} />
              <Route path="/design/playbooks/:id" element={<PlaybookDetailPage />} />
              <Route path="/design/playbooks/:id/launch" element={<LegacyPlaybookLaunchRedirect />} />
              <Route path="/design/playbooks/launch" element={<LegacyPlaybookLaunchRedirect />} />
              <Route path="/config/playbooks/*" element={<LegacyPlaybookRouteRedirect />} />
              <Route path="/design/specialists" element={<SpecialistsPage />} />
              <Route path="/design/specialists/skills" element={<SkillsPage />} />
              <Route path="/design/roles" element={<LegacySpecialistsRouteRedirect />} />
              <Route path="/config/roles" element={<Navigate to="/design/specialists" replace />} />

              {/* Platform */}
              <Route path="/platform/orchestrator" element={<OrchestratorPage />} />
              <Route path="/platform/models" element={<ModelsPage />} />
              <Route
                path="/platform/runtimes"
                element={<Navigate to="/admin/agentic-settings" replace />}
              />
              <Route path="/platform/environments" element={<ExecutionEnvironmentsPage />} />
              <Route
                path="/platform/operations"
                element={<Navigate to="/admin/platform-settings" replace />}
              />
              <Route path="/platform/instructions" element={<PlatformInstructionsPage />} />
              <Route path="/platform/tools" element={<ToolsPage />} />
              <Route
                path="/config/orchestrator"
                element={<Navigate to="/platform/orchestrator" replace />}
              />
              <Route path="/config/llm" element={<Navigate to="/platform/models" replace />} />
              <Route
                path="/config/runtimes"
                element={<Navigate to="/admin/agentic-settings" replace />}
              />
              <Route
                path="/config/instructions"
                element={<Navigate to="/platform/instructions" replace />}
              />
              <Route
                path="/config/runtime-defaults"
                element={<Navigate to="/admin/agentic-settings" replace />}
              />
              <Route path="/config/tools" element={<Navigate to="/platform/tools" replace />} />

              {/* Integrations */}
              <Route path="/integrations/webhooks" element={<WebhooksPage />} />
              <Route path="/integrations/triggers" element={<WorkItemTriggersPage />} />
              <Route path="/integrations/mcp-servers" element={<McpPage />} />
              <Route
                path="/integrations/mcp"
                element={<Navigate to="/integrations/mcp-servers" replace />}
              />
              <Route
                path="/integrations/agent-protocols"
                element={<Navigate to="/integrations/mcp-servers" replace />}
              />
              <Route
                path="/config/webhooks"
                element={<Navigate to="/integrations/webhooks" replace />}
              />
              <Route
                path="/config/triggers"
                element={<Navigate to="/integrations/triggers" replace />}
              />
              <Route
                path="/config/agent-protocols"
                element={<Navigate to="/integrations/mcp-servers" replace />}
              />
              <Route
                path="/config/work-item-triggers"
                element={<Navigate to="/integrations/triggers" replace />}
              />

              {/* Diagnostics */}
              <Route path="/diagnostics/live-logs" element={<LogsPage />} />
              <Route path="/diagnostics/live-containers" element={<LiveContainersPage />} />
              <Route path="/diagnostics/logs" element={<LegacyLiveLogsRedirect />} />
              <Route path="/diagnostics/containers" element={<LegacyLiveContainersRedirect />} />
              <Route path="/logs" element={<LegacyLiveLogsRedirect />} />
              <Route path="/fleet/containers" element={<LegacyLiveContainersRedirect />} />

              {/* Admin */}
              <Route path="/admin/general-settings" element={<SettingsPage />} />
              <Route
                path="/admin/settings"
                element={<Navigate to="/admin/general-settings" replace />}
              />
              <Route path="/admin/api-keys" element={<ApiKeyPage />} />
              <Route path="/admin/agentic-settings" element={<AgenticSettingsPage />} />
              <Route
                path="/admin/agent-settings"
                element={<Navigate to="/admin/agentic-settings" replace />}
              />
              <Route path="/admin/platform-settings" element={<PlatformSettingsPage />} />
              <Route
                path="/governance/settings"
                element={<Navigate to="/admin/general-settings" replace />}
              />
              <Route
                path="/governance/api-keys"
                element={<Navigate to="/admin/api-keys" replace />}
              />
              <Route
                path="/governance/retention"
                element={<Navigate to="/admin/general-settings" replace />}
              />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/workflows" replace />} />
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
  const routePrefix = location.pathname.startsWith('/work/workflows')
    ? '/work/workflows'
    : '/work/boards';
  const segments = location.pathname
    .slice(routePrefix.length)
    .split('/')
    .filter((segment) => segment.length > 0);
  const workflowId = segments[0] ?? null;
  const searchParams = new URLSearchParams(location.search);

  if (!workflowId) {
    return <Navigate to={`/workflows${location.search}${location.hash}`} replace />;
  }

  if (segments[1] === 'inspector') {
    const target = buildWorkflowDiagnosticsHref({
      workflowId,
      taskId: searchParams.get('task'),
      view: searchParams.get('view') === 'summary' ? 'summary' : 'raw',
    });
    return <Navigate to={target} replace />;
  }

  const target = buildWorkflowDetailPermalink(workflowId, {
    workItemId: searchParams.get('work_item'),
    activationId: searchParams.get('activation'),
    childWorkflowId: searchParams.get('child'),
    gateStageName: searchParams.get('gate'),
  });
  return <Navigate to={target} replace />;
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

function LegacyPlaybookLaunchRedirect(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={buildWorkflowsLaunchHref({ playbookId: id })} replace />;
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
          cookieHeader: typeof document === 'undefined' ? '' : document.cookie,
        });
        const completed = completeSsoBrowserSession(
          new URLSearchParams({ tenant_id: session.tenantId }),
          session.accessToken ? { accessToken: session.accessToken } : undefined,
        );
        if (!isActive) {
          return;
        }

        navigate(completed ? redirectTo : '/login', { replace: true });
      } catch {
        if (isActive) {
          if (existingSession) {
            navigate(redirectTo, { replace: true });
            return;
          }

          clearSession();
          navigate('/login', { replace: true });
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
