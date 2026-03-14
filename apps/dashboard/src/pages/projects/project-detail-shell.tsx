import { useEffect, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import type { DashboardProjectRecord } from '../../lib/api.js';
import { rememberProjectBreadcrumbLabel } from '../../components/layout-breadcrumbs.js';
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
  PROJECT_DETAIL_TAB_OPTIONS,
  type ProjectDetailHeaderState,
  type ProjectDetailTabValue,
} from './project-detail-support.js';

interface ProjectDetailShellProps {
  project: DashboardProjectRecord;
  activeTab: ProjectDetailTabValue;
  headerState: ProjectDetailHeaderState;
  onTabChange(nextTab: ProjectDetailTabValue): void;
  overviewContent: ReactNode;
  settingsContent: ReactNode;
  knowledgeContent: ReactNode;
  automationContent: ReactNode;
  deliveryContent: ReactNode;
}

export function ProjectDetailShell(props: ProjectDetailShellProps): JSX.Element {
  useProjectBreadcrumbIdentity(props.project);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <ProjectDetailHeader project={props.project} headerState={props.headerState} />

      <Tabs
        value={props.activeTab}
        onValueChange={(value) => props.onTabChange(value as ProjectDetailTabValue)}
      >
        <ProjectDetailTabBar activeTab={props.activeTab} onTabChange={props.onTabChange} />

        <TabsContent value="overview">{props.overviewContent}</TabsContent>
        <TabsContent value="settings">{props.settingsContent}</TabsContent>
        <TabsContent value="knowledge">{props.knowledgeContent}</TabsContent>
        <TabsContent value="automation">{props.automationContent}</TabsContent>
        <TabsContent value="delivery">{props.deliveryContent}</TabsContent>
      </Tabs>
    </div>
  );
}

function ProjectDetailHeader(props: {
  project: DashboardProjectRecord;
  headerState: ProjectDetailHeaderState;
}): JSX.Element {
  const { project, headerState } = props;
  const isExpanded = headerState.mode === 'expanded';
  const projectLinkState = { projectLabel: project.name };

  return (
    <Card className="border-border/70 shadow-none">
      <CardHeader className={isExpanded ? 'space-y-4' : 'space-y-2 py-3'}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div
            className={
              isExpanded ? 'max-w-3xl space-y-3' : 'min-w-0 flex-1 space-y-1.5'
            }
          >
            {isExpanded ? (
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                Project workspace
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={project.is_active ? 'success' : 'secondary'}>
                {project.is_active ? 'Active' : 'Inactive'}
              </Badge>
              {isExpanded ? <Badge variant="outline">{project.slug}</Badge> : null}
              {isExpanded && project.repository_url ? (
                <Badge variant="outline">Repository linked</Badge>
              ) : null}
              {!isExpanded ? <Badge variant="outline">{headerState.activeTab.label}</Badge> : null}
            </div>
            <div className="space-y-1">
              <h1
                className={
                  isExpanded
                    ? 'text-2xl font-semibold tracking-tight'
                    : 'text-lg font-semibold tracking-tight'
                }
              >
                {headerState.title}
              </h1>
              <p className="text-sm leading-6 text-muted">{headerState.description}</p>
            </div>
            {headerState.contextPills.length > 0 ? (
              <div className="flex flex-wrap gap-2 text-xs text-muted">
                {headerState.contextPills.map((pill) => (
                  <span
                    key={pill}
                    className="rounded-full border border-border/70 bg-background/70 px-3 py-1"
                  >
                    {pill}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {headerState.quickActions.length > 0 ? (
            <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:justify-end">
              {headerState.quickActions.map((action) => (
                <Button key={action.label} asChild size="sm" variant={action.variant}>
                  <Link to={action.href} state={projectLinkState}>
                    {action.label}
                  </Link>
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </CardHeader>
    </Card>
  );
}

function ProjectDetailTabBar(props: {
  activeTab: ProjectDetailTabValue;
  onTabChange(nextTab: ProjectDetailTabValue): void;
}): JSX.Element {
  return (
    <div className="sticky top-0 z-10 space-y-2 rounded-2xl bg-background/95 pb-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="sm:hidden">
        <Select
          value={props.activeTab}
          onValueChange={(value) => props.onTabChange(value as ProjectDetailTabValue)}
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
  );
}

function useProjectBreadcrumbIdentity(project: DashboardProjectRecord): void {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    rememberProjectBreadcrumbLabel(project.id, project.name);
  }, [project.id, project.name]);

  useEffect(() => {
    const currentState = location.state && typeof location.state === 'object'
      ? location.state as Record<string, unknown>
      : {};
    if (currentState.projectLabel === project.name) {
      return;
    }
    navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      },
      {
        replace: true,
        state: { ...currentState, projectLabel: project.name },
      },
    );
  }, [
    location.hash,
    location.pathname,
    location.search,
    location.state,
    navigate,
    project.name,
  ]);
}
