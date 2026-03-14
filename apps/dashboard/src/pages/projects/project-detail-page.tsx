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
import { ContentBrowserSurface } from './content-browser-page.js';
import { ProjectDeliveryHistory } from './project-delivery-history.js';
import { ProjectDetailMemoryTab } from './project-detail-memory-tab.js';
import { ProjectDetailShell } from './project-detail-shell.js';
import { ProjectKnowledgeShell } from './project-knowledge-shell.js';
import { ProjectOverviewShell } from './project-overview-shell.js';
import { ProjectSettingsShell } from './project-settings-shell.js';
import { ProjectSettingsTab } from './project-settings-tab.js';
import { ProjectSpecTab } from './project-spec-tab.js';

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
        <ProjectSettingsShell project={project} overview={settingsOverview}>
          <ProjectSettingsTab project={project} />
        </ProjectSettingsShell>
      }
      knowledgeContent={
        <ProjectKnowledgeShell
          projectId={project.id}
          overview={knowledgeOverview}
          referenceContent={<ProjectSpecTab projectId={project.id} />}
          memoryContent={<ProjectDetailMemoryTab projectId={project.id} />}
          runContentContent={<ContentBrowserSurface scopedProjectId={project.id} preferredTab="documents" showHeader={false} />}
        />
      }
      automationContent={<ProjectAutomationTab project={project} />}
      deliveryContent={<ProjectDeliveryHistory projectId={project.id} />}
    />
  );
}
