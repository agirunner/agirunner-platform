import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { dashboardApi } from '../../lib/api.js';
import type { DashboardProjectRecord } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardHeader } from '../../components/ui/card.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import {
  buildProjectKnowledgeOverview,
  buildProjectSettingsOverview,
  buildProjectWorkspaceOverview,
  normalizeProjectDetailTab,
  PROJECT_DETAIL_TAB_OPTIONS,
  type ProjectDetailTabValue,
} from './project-detail-support.js';
import { ProjectArtifactExplorerPanel } from './project-artifact-explorer-panel.js';
import { ProjectAutomationTab } from './project-automation-tab.js';
import { ProjectDeliveryHistory } from './project-delivery-history.js';
import { ProjectDetailMemoryTab } from './project-detail-memory-tab.js';
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
    <div className="space-y-6 p-4 sm:p-6">
      <Card className="border-border/70 shadow-none">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl space-y-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                Project workspace
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={project.is_active ? 'success' : 'secondary'}>
                  {project.is_active ? 'Active' : 'Inactive'}
                </Badge>
                <Badge variant="outline">{project.slug}</Badge>
                {project.repository_url ? <Badge variant="outline">Repository linked</Badge> : null}
              </div>
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
                <p className="text-sm leading-6 text-muted">
                  {project.description ??
                    'Overview surfaces posture, Settings owns control-plane changes, Knowledge groups shared project context, Automation keeps triggers together, and Delivery tracks project runs.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted">
                <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1">
                  {project.repository_url
                    ? 'Repository linked for project-backed delivery'
                    : 'Add a repository before git-backed delivery'}
                </span>
                <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1">
                  {project.is_active
                    ? 'Operators can route new work here'
                    : 'Review-only until the project is reactivated'}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm" variant="secondary">
                <Link to={`/projects/${project.id}?tab=knowledge`}>Open knowledge base</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to={`/projects/${project.id}?tab=settings`}>Open settings</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to={`/projects/${project.id}?tab=automation`}>Open automation</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to={`/projects/${project.id}?tab=delivery`}>Open delivery</Link>
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Tabs
        value={activeTab}
        onValueChange={(value) => handleTabChange(value as ProjectDetailTabValue)}
      >
        <div className="sticky top-0 z-10 space-y-2 rounded-2xl bg-background/95 pb-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="sm:hidden">
            <Select
              value={activeTab}
              onValueChange={(value) => handleTabChange(value as ProjectDetailTabValue)}
            >
              <SelectTrigger aria-label="Select project workspace tab">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_DETAIL_TAB_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <TabsList className="hidden h-auto w-full flex-wrap gap-1 rounded-xl bg-border/30 p-1 sm:inline-flex">
            {PROJECT_DETAIL_TAB_OPTIONS.map((option) => (
              <TabsTrigger key={option.value} value={option.value} className="flex-1">
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="overview">
          <ProjectOverviewShell project={project} overview={projectOverview} />
        </TabsContent>

        <TabsContent value="settings">
          <ProjectSettingsShell project={project} overview={settingsOverview}>
            <ProjectSettingsTab project={project} />
          </ProjectSettingsShell>
        </TabsContent>

        <TabsContent value="knowledge">
          <ProjectKnowledgeShell
            projectId={project.id}
            overview={knowledgeOverview}
            workspaceContent={<ProjectSpecTab projectId={project.id} />}
            memoryContent={<ProjectDetailMemoryTab projectId={project.id} />}
            artifactsContent={<ProjectArtifactExplorerPanel projectId={project.id} />}
          />
        </TabsContent>

        <TabsContent value="automation">
          <ProjectAutomationTab project={project} />
        </TabsContent>

        <TabsContent value="delivery">
          <ProjectDeliveryHistory projectId={project.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
