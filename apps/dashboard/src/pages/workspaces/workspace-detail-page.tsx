import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';

import { dashboardApi } from '../../lib/api.js';
import type { DashboardWorkspaceRecord } from '../../lib/api.js';
import {
  buildWorkspaceDetailHeaderState,
  buildWorkspaceKnowledgeOverview,
  buildWorkspaceSettingsOverview,
  buildWorkspaceOverview,
  normalizeWorkspaceDetailTab,
  type WorkspaceDetailTabValue,
} from './workspace-detail-support.js';
import { WorkspaceAutomationTab } from './workspace-automation-tab.js';
import { WorkspaceDeliveryHistory } from './workspace-delivery-history.js';
import { WorkspaceDetailShell } from './workspace-detail-shell.js';
import { WorkspaceKnowledgeTab } from './workspace-knowledge-tab.js';
import { WorkspaceOverviewShell } from './workspace-overview-shell.js';
import { WorkspaceSettingsTab } from './workspace-settings-tab.js';

export function WorkspaceDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ['workspace', id],
    queryFn: () => dashboardApi.getWorkspace(id!),
    enabled: Boolean(id),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error) {
    return <div className="p-6 text-red-600">Failed to load workspace. Please try again later.</div>;
  }

  const workspace = data as DashboardWorkspaceRecord;
  const activeTab = normalizeWorkspaceDetailTab(searchParams.get('tab'));
  const workspaceOverview = buildWorkspaceOverview(workspace);
  const settingsOverview = buildWorkspaceSettingsOverview(workspace);
  const knowledgeOverview = buildWorkspaceKnowledgeOverview(workspace);
  const baseHeaderState = buildWorkspaceDetailHeaderState(workspace, activeTab);
  const headerState = activeTab === 'knowledge'
    ? { ...baseHeaderState, quickActions: [] }
    : baseHeaderState;

  function handleTabChange(nextTab: WorkspaceDetailTabValue): void {
    const nextSearchParams = new URLSearchParams(searchParams);
    if (nextTab === 'overview') {
      nextSearchParams.delete('tab');
    } else {
      nextSearchParams.set('tab', nextTab);
    }
    setSearchParams(nextSearchParams, { replace: true });
  }

  return (
    <WorkspaceDetailShell
      workspace={workspace}
      activeTab={activeTab}
      headerState={headerState}
      onTabChange={handleTabChange}
      overviewContent={<WorkspaceOverviewShell workspace={workspace} overview={workspaceOverview} />}
      settingsContent={
        <WorkspaceSettingsTab workspace={workspace} overview={settingsOverview} />
      }
      knowledgeContent={<WorkspaceKnowledgeTab workspaceId={workspace.id} overview={knowledgeOverview} />}
      automationContent={<WorkspaceAutomationTab workspace={workspace} />}
      deliveryContent={<WorkspaceDeliveryHistory workspaceId={workspace.id} />}
    />
  );
}
