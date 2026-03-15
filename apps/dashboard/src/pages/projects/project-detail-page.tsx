import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';

import { dashboardApi } from '../../lib/api.js';
import type { DashboardProjectRecord } from '../../lib/api.js';
import {
  buildProjectDetailHeaderState,
  buildProjectKnowledgeOverview,
  buildProjectSettingsOverview,
  buildProjectWorkspaceOverview,
  normalizeProjectDetailTab,
  type ProjectDetailTabValue,
} from './project-detail-support.js';
import { ProjectAutomationTab } from './project-automation-tab.js';
import { ProjectDeliveryHistory } from './project-delivery-history.js';
import { ProjectDetailShell } from './project-detail-shell.js';
import { ProjectKnowledgeTab } from './project-knowledge-tab.js';
import { ProjectOverviewShell } from './project-overview-shell.js';
import { ProjectSettingsTab } from './project-settings-tab.js';

export function ProjectDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ['project', id],
    queryFn: () => dashboardApi.getProject(id!),
    enabled: Boolean(id),
  });
  const projectSpecQuery = useQuery({
    queryKey: ['project-spec', id],
    queryFn: () => dashboardApi.getProjectSpec(id!),
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
    return <div className="p-6 text-red-600">Failed to load project. Please try again later.</div>;
  }

  const project = data as DashboardProjectRecord;
  const activeTab = normalizeProjectDetailTab(searchParams.get('tab'));
  const projectOverview = buildProjectWorkspaceOverview(project, projectSpecQuery.data);
  const settingsOverview = buildProjectSettingsOverview(project);
  const knowledgeOverview = buildProjectKnowledgeOverview(project, projectSpecQuery.data);
  const baseHeaderState = buildProjectDetailHeaderState(project, activeTab);
  const headerState = activeTab === 'knowledge'
    ? { ...baseHeaderState, quickActions: [] }
    : baseHeaderState;

  function handleTabChange(nextTab: ProjectDetailTabValue): void {
    const nextSearchParams = new URLSearchParams(searchParams);
    if (nextTab === 'overview') {
      nextSearchParams.delete('tab');
    } else {
      nextSearchParams.set('tab', nextTab);
    }
    setSearchParams(nextSearchParams, { replace: true });
  }

  return (
    <ProjectDetailShell
      project={project}
      activeTab={activeTab}
      headerState={headerState}
      onTabChange={handleTabChange}
      overviewContent={<ProjectOverviewShell project={project} overview={projectOverview} />}
      settingsContent={
        <ProjectSettingsTab project={project} overview={settingsOverview} />
      }
      knowledgeContent={<ProjectKnowledgeTab projectId={project.id} overview={knowledgeOverview} />}
      automationContent={<ProjectAutomationTab project={project} />}
      deliveryContent={<ProjectDeliveryHistory projectId={project.id} />}
    />
  );
}
