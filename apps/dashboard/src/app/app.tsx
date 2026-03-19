import { Component, lazy, Suspense, useEffect } from 'react';
import type { ComponentType, ErrorInfo, ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';

import { DashboardLayout } from '../components/layout.js';
import { resolveAuthCallbackSession } from '../lib/auth-callback.js';
import {
  completeSsoBrowserSession,
  hasDashboardSession,
  resolveAuthCallbackRedirect,
} from '../lib/auth-session.js';
import { clearSession, readSession } from '../lib/session.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

/* ── Chunk-resilient lazy loader ──────────────────────────────────────── */

/**
 * Wraps React.lazy with automatic retry on chunk load failures.
 * When Vite rebuilds, old chunk hashes become stale. This catches the
 * resulting import error and reloads the page once to pick up the new manifest.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyWithRetry<T extends ComponentType<any>>(
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

const ExecutionCanvas = lazyWithRetry(() => import('../pages/execution/execution-canvas.js'));

const ArtifactPreviewPage = lazyWithRetry(() => import('../components/artifact-preview-page.js').then((m) => ({ default: m.ArtifactPreviewPage })));

const WorkspaceListPage = lazyWithRetry(() => import('../pages/workspaces/workspace-list-page.js').then((m) => ({ default: m.WorkspaceListPage })));
const WorkspaceDetailPage = lazyWithRetry(() => import('../pages/workspaces/workspace-detail-page.js').then((m) => ({ default: m.WorkspaceDetailPage })));

const RoleDefinitionsPage = lazyWithRetry(() => import('../pages/config/role-definitions-page.js').then((m) => ({ default: m.RoleDefinitionsPage })));
const OrchestratorPage = lazyWithRetry(() => import('../pages/config/orchestrator-page.js').then((m) => ({ default: m.OrchestratorPage })));
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
  return (
    <AppErrorBoundary>
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<SSOCallbackPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<DashboardLayout />}>
            <Route path="/" element={<Navigate to="/execution" replace />} />

            {/* Execution Canvas */}
            <Route path="/execution" element={<Suspense fallback={<PageFallback />}><ExecutionCanvas /></Suspense>} />
            <Route path="/execution/launch" element={<Suspense fallback={<PageFallback />}><ExecutionCanvas initialAction="launch" /></Suspense>} />

            {/* Deprecated routes — redirect to Execution Canvas */}
            <Route path="/mission-control" element={<Navigate to="/execution" replace />} />
            <Route path="/mission-control/alerts" element={<Navigate to="/execution" replace />} />
            <Route path="/mission-control/costs" element={<Navigate to="/execution" replace />} />
            <Route path="/work/boards" element={<Navigate to="/execution" replace />} />
            <Route path="/work/boards/:id" element={<Navigate to="/execution" replace />} />
            <Route path="/work/boards/:id/inspector" element={<Navigate to="/execution" replace />} />
            <Route path="/work/tasks" element={<Navigate to="/execution" replace />} />
            <Route path="/work/tasks/:id" element={<Navigate to="/execution" replace />} />
            <Route path="/work/approvals" element={<Navigate to="/execution" replace />} />
            <Route path="/work/workflows/*" element={<Navigate to="/execution" replace />} />

            {/* Logs */}
            <Route path="/logs" element={<LogsPage />} />

            {/* Artifacts */}
            <Route path="/artifacts/tasks/:taskId/:artifactId" element={<ArtifactPreviewPage />} />

            {/* Workspaces */}
            <Route path="/workspaces" element={<WorkspaceListPage />} />
            <Route path="/workspaces/:id" element={<WorkspaceDetailPage />} />
            <Route path="/workspaces/:id/memory" element={<LegacyWorkspaceKnowledgeRedirect />} />
            <Route path="/workspaces/:id/content" element={<LegacyWorkspaceKnowledgeRedirect />} />
            <Route path="/workspaces/:id/artifacts" element={<LegacyWorkspaceKnowledgeRedirect />} />
            <Route path="/workspaces/memory" element={<Navigate to="/workspaces" replace />} />
            <Route path="/workspaces/content" element={<Navigate to="/workspaces" replace />} />

            {/* Configuration */}
            <Route path="/config/playbooks" element={<PlaybookListPage />} />
            <Route path="/config/playbooks/:id" element={<PlaybookDetailPage />} />
            <Route path="/config/playbooks/:id/launch" element={<PlaybookLaunchPage />} />
            <Route path="/config/playbooks/launch" element={<PlaybookLaunchPage />} />
            <Route path="/config/orchestrator" element={<OrchestratorPage />} />
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
        <Route path="*" element={<Navigate to="/execution" replace />} />
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

function LegacyWorkspaceKnowledgeRedirect(): JSX.Element {
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return <Navigate to="/workspaces" replace />;
  }
  const panel = location.pathname.endsWith('/memory')
    ? 'memory'
    : location.pathname.endsWith('/artifacts')
      ? 'artifacts'
      : 'artifacts';
  return <Navigate to={`/workspaces/${id}?tab=knowledge&panel=${panel}`} replace />;
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
