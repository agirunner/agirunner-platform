import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';

import { DashboardLayout } from '../components/layout.js';
import { clearSession, readSession, writeSession } from '../lib/session.js';

import { applyTheme, readTheme } from './theme.js';

const LoginPage = lazy(() => import('../pages/login-page.js').then((m) => ({ default: m.LoginPage })));

const LiveBoardPage = lazy(() => import('../pages/mission-control/live-board-page.js').then((m) => ({ default: m.LiveBoardPage })));
const ActivityFeedPage = lazy(() => import('../pages/mission-control/activity-feed-page.js').then((m) => ({ default: m.ActivityFeedPage })));
const AlertsApprovalsPage = lazy(() => import('../pages/mission-control/alerts-approvals-page.js').then((m) => ({ default: m.AlertsApprovalsPage })));
const CostDashboardPage = lazy(() => import('../pages/mission-control/cost-dashboard-page.js').then((m) => ({ default: m.CostDashboardPage })));

const WorkflowListPage = lazy(() => import('../pages/work/workflow-list-page.js').then((m) => ({ default: m.WorkflowListPage })));
const WorkflowDetailPage = lazy(() => import('../pages/work/workflow-detail-page.js').then((m) => ({ default: m.WorkflowDetailPage })));
const TaskListPage = lazy(() => import('../pages/work/task-list-page.js').then((m) => ({ default: m.TaskListPage })));
const TaskDetailPage = lazy(() => import('../pages/work/task-detail-page.js').then((m) => ({ default: m.TaskDetailPage })));
const ApprovalQueuePage = lazy(() => import('../pages/work/approval-queue-page.js').then((m) => ({ default: m.ApprovalQueuePage })));

const ProjectListPage = lazy(() => import('../pages/projects/project-list-page.js').then((m) => ({ default: m.ProjectListPage })));
const ProjectDetailPage = lazy(() => import('../pages/projects/project-detail-page.js').then((m) => ({ default: m.ProjectDetailPage })));
const MemoryBrowserPage = lazy(() => import('../pages/projects/memory-browser-page.js').then((m) => ({ default: m.MemoryBrowserPage })));
const ContentBrowserPage = lazy(() => import('../pages/projects/content-browser-page.js').then((m) => ({ default: m.ContentBrowserPage })));

const TemplateListPage = lazy(() => import('../pages/config/template-list-page.js').then((m) => ({ default: m.TemplateListPage })));
const RoleDefinitionsPage = lazy(() => import('../pages/config/role-definitions-page.js').then((m) => ({ default: m.RoleDefinitionsPage })));
const LlmProvidersPage = lazy(() => import('../pages/config/llm-providers-page.js').then((m) => ({ default: m.LlmProvidersPage })));
const RuntimesPage = lazy(() => import('../pages/config/runtimes-page.js').then((m) => ({ default: m.RuntimesPage })));
const IntegrationsPage = lazy(() => import('../pages/config/integrations-page.js').then((m) => ({ default: m.IntegrationsPage })));
const PlatformInstructionsPage = lazy(() => import('../pages/config/platform-instructions-page.js').then((m) => ({ default: m.PlatformInstructionsPage })));
const AiConfigAssistantPage = lazy(() => import('../pages/config/ai-config-assistant-page.js').then((m) => ({ default: m.AiConfigAssistantPage })));
const TemplateEditorPage = lazy(() => import('../pages/config/template-editor-page.js').then((m) => ({ default: m.TemplateEditorPage })));

const WorkerListPage = lazy(() => import('../pages/fleet/worker-list-page.js').then((m) => ({ default: m.WorkerListPage })));
const AgentListPage = lazy(() => import('../pages/fleet/agent-list-page.js').then((m) => ({ default: m.AgentListPage })));
const DockerPage = lazy(() => import('../pages/fleet/docker-page.js').then((m) => ({ default: m.DockerPage })));
const WarmPoolsPage = lazy(() => import('../pages/fleet/warm-pools-page.js').then((m) => ({ default: m.WarmPoolsPage })));

const AuditLogPage = lazy(() => import('../pages/governance/audit-log-page.js').then((m) => ({ default: m.AuditLogPage })));
const ApiKeyPage = lazy(() => import('../pages/governance/api-key-page.js').then((m) => ({ default: m.ApiKeyPage })));
const UserManagementPage = lazy(() => import('../pages/governance/user-management-page.js').then((m) => ({ default: m.UserManagementPage })));
const RetentionPolicyPage = lazy(() => import('../pages/governance/retention-policy-page.js').then((m) => ({ default: m.RetentionPolicyPage })));
const LegalHoldsPage = lazy(() => import('../pages/governance/legal-holds-page.js').then((m) => ({ default: m.LegalHoldsPage })));
const OrchestratorGrantsPage = lazy(() => import('../pages/governance/orchestrator-grants-page.js').then((m) => ({ default: m.OrchestratorGrantsPage })));

function PageFallback(): JSX.Element {
  return (
    <div className="flex items-center justify-center p-12 text-muted">
      Loading...
    </div>
  );
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
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<SSOCallbackPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<DashboardLayout onToggleTheme={toggleTheme} />}>
            <Route path="/" element={<Navigate to="/mission-control" replace />} />

            {/* Mission Control */}
            <Route path="/mission-control" element={<LiveBoardPage />} />
            <Route path="/mission-control/activity" element={<ActivityFeedPage />} />
            <Route path="/mission-control/alerts" element={<AlertsApprovalsPage />} />
            <Route path="/mission-control/costs" element={<CostDashboardPage />} />

            {/* Work */}
            <Route path="/work/workflows" element={<WorkflowListPage />} />
            <Route path="/work/workflows/:id" element={<WorkflowDetailPage />} />
            <Route path="/work/tasks" element={<TaskListPage />} />
            <Route path="/work/tasks/:id" element={<TaskDetailPage />} />
            <Route path="/work/approvals" element={<ApprovalQueuePage />} />

            {/* Projects */}
            <Route path="/projects" element={<ProjectListPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/projects/memory" element={<MemoryBrowserPage />} />
            <Route path="/projects/content" element={<ContentBrowserPage />} />

            {/* Configuration */}
            <Route path="/config/templates" element={<TemplateListPage />} />
            <Route path="/config/templates/:id/edit" element={<TemplateEditorPage />} />
            <Route path="/config/roles" element={<RoleDefinitionsPage />} />
            <Route path="/config/llm" element={<LlmProvidersPage />} />
            <Route path="/config/runtimes" element={<RuntimesPage />} />
            <Route path="/config/integrations" element={<IntegrationsPage />} />
            <Route path="/config/instructions" element={<PlatformInstructionsPage />} />
            <Route path="/config/assistant" element={<AiConfigAssistantPage />} />

            {/* Fleet */}
            <Route path="/fleet/workers" element={<WorkerListPage />} />
            <Route path="/fleet/agents" element={<AgentListPage />} />
            <Route path="/fleet/docker" element={<DockerPage />} />
            <Route path="/fleet/warm-pools" element={<WarmPoolsPage />} />

            {/* Governance */}
            <Route path="/governance/audit" element={<AuditLogPage />} />
            <Route path="/governance/api-keys" element={<ApiKeyPage />} />
            <Route path="/governance/users" element={<UserManagementPage />} />
            <Route path="/governance/retention" element={<RetentionPolicyPage />} />
            <Route path="/governance/legal-holds" element={<LegalHoldsPage />} />
            <Route path="/governance/grants" element={<OrchestratorGrantsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/mission-control" replace />} />
      </Routes>
    </Suspense>
  );
}

function RequireAuth(): JSX.Element {
  const navigate = useNavigate();
  const session = readSession();

  useEffect(() => {
    if (!session) {
      clearSession();
      navigate('/login', { replace: true });
    }
  }, [navigate, session]);

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

function SSOCallbackPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const accessToken = searchParams.get('access_token');
    const refreshToken = searchParams.get('refresh_token');

    if (accessToken) {
      writeSession({ accessToken, tenantId: 'default' });
      if (refreshToken) {
        localStorage.setItem('refresh_token', refreshToken);
      }
      navigate('/', { replace: true });
    } else {
      navigate('/login', { replace: true });
    }
  }, [navigate, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted">Completing sign in...</p>
    </div>
  );
}
