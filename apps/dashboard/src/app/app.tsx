import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';

import { DashboardLayout } from '../components/layout.js';
import { clearSession, readSession, writeSession } from '../lib/session.js';
import { LoginPage } from '../pages/login-page.js';

import { LiveBoardPage } from '../pages/mission-control/live-board-page.js';
import { ActivityFeedPage } from '../pages/mission-control/activity-feed-page.js';
import { AlertsApprovalsPage } from '../pages/mission-control/alerts-approvals-page.js';

import { WorkflowListPage } from '../pages/work/workflow-list-page.js';
import { WorkflowDetailPage } from '../pages/work/workflow-detail-page.js';
import { TaskListPage } from '../pages/work/task-list-page.js';
import { TaskDetailPage } from '../pages/work/task-detail-page.js';
import { ApprovalQueuePage } from '../pages/work/approval-queue-page.js';

import { ProjectListPage } from '../pages/projects/project-list-page.js';
import { MemoryBrowserPage } from '../pages/projects/memory-browser-page.js';
import { ContentBrowserPage } from '../pages/projects/content-browser-page.js';

import { TemplateListPage } from '../pages/config/template-list-page.js';
import { RoleDefinitionsPage } from '../pages/config/role-definitions-page.js';
import { LlmProvidersPage } from '../pages/config/llm-providers-page.js';
import { RuntimesPage } from '../pages/config/runtimes-page.js';
import { IntegrationsPage } from '../pages/config/integrations-page.js';
import { PlatformInstructionsPage } from '../pages/config/platform-instructions-page.js';

import { WorkerListPage } from '../pages/fleet/worker-list-page.js';
import { AgentListPage } from '../pages/fleet/agent-list-page.js';
import { DockerPage } from '../pages/fleet/docker-page.js';
import { WarmPoolsPage } from '../pages/fleet/warm-pools-page.js';

import { AuditLogPage } from '../pages/governance/audit-log-page.js';
import { ApiKeyPage } from '../pages/governance/api-key-page.js';
import { UserManagementPage } from '../pages/governance/user-management-page.js';
import { RetentionPolicyPage } from '../pages/governance/retention-policy-page.js';
import { LegalHoldsPage } from '../pages/governance/legal-holds-page.js';
import { OrchestratorGrantsPage } from '../pages/governance/orchestrator-grants-page.js';

import { applyTheme, readTheme } from './theme.js';

export function App(): JSX.Element {
  useEffect(() => {
    applyTheme(readTheme());
  }, []);

  const toggleTheme = (): void => {
    const next = readTheme() === 'light' ? 'dark' : 'light';
    applyTheme(next);
  };

  return (
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

          {/* Work */}
          <Route path="/work/workflows" element={<WorkflowListPage />} />
          <Route path="/work/workflows/:id" element={<WorkflowDetailPage />} />
          <Route path="/work/tasks" element={<TaskListPage />} />
          <Route path="/work/tasks/:id" element={<TaskDetailPage />} />
          <Route path="/work/approvals" element={<ApprovalQueuePage />} />

          {/* Projects */}
          <Route path="/projects" element={<ProjectListPage />} />
          <Route path="/projects/memory" element={<MemoryBrowserPage />} />
          <Route path="/projects/content" element={<ContentBrowserPage />} />

          {/* Configuration */}
          <Route path="/config/templates" element={<TemplateListPage />} />
          <Route path="/config/roles" element={<RoleDefinitionsPage />} />
          <Route path="/config/llm" element={<LlmProvidersPage />} />
          <Route path="/config/runtimes" element={<RuntimesPage />} />
          <Route path="/config/integrations" element={<IntegrationsPage />} />
          <Route path="/config/instructions" element={<PlatformInstructionsPage />} />

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
