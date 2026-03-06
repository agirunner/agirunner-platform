import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';

import { DashboardLayout } from '../components/layout.js';
import { clearSession, readSession } from '../lib/session.js';
import { ActivityFeedPage } from '../pages/activity-feed-page.js';
import { ApiKeyManagementPage } from '../pages/api-key-management-page.js';
import { LoginPage } from '../pages/login-page.js';
import { PipelineDetailPage } from '../pages/pipeline-detail-page.js';
import { PipelineListPage } from '../pages/pipeline-list-page.js';
import { RuntimeCustomizationPage } from '../pages/runtime-customization-page.js';
import { SystemMetricsPage } from '../pages/system-metrics-page.js';
import { TaskDetailPage } from '../pages/task-detail-page.js';
import { TemplateBrowserPage } from '../pages/template-browser-page.js';
import { WorkerStatusPage } from '../pages/worker-status-page.js';
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
      <Route element={<RequireAuth />}>
        <Route element={<DashboardLayout onToggleTheme={toggleTheme} />}>
          <Route path="/" element={<Navigate to="/pipelines" replace />} />
          <Route path="/pipelines" element={<PipelineListPage />} />
          <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
          <Route path="/templates" element={<TemplateBrowserPage />} />
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
          <Route path="/workers" element={<WorkerStatusPage />} />
          <Route path="/runtime-customization" element={<RuntimeCustomizationPage />} />
          <Route path="/activity" element={<ActivityFeedPage />} />
          <Route path="/api-keys" element={<ApiKeyManagementPage />} />
          <Route path="/metrics" element={<SystemMetricsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/pipelines" replace />} />
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
