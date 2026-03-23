import { useEffect, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import type { DashboardWorkspaceRecord } from '../../lib/api.js';
import { rememberWorkspaceBreadcrumbLabel } from '../../components/layout-breadcrumbs.js';
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
  WORKSPACE_DETAIL_TAB_OPTIONS,
  readWorkspaceStorageLabel,
  type WorkspaceDetailHeaderState,
  type WorkspaceDetailTabValue,
} from './workspace-detail-support.js';

interface WorkspaceDetailShellProps {
  workspace: DashboardWorkspaceRecord;
  activeTab: WorkspaceDetailTabValue;
  headerState: WorkspaceDetailHeaderState;
  onTabChange(nextTab: WorkspaceDetailTabValue): void;
  overviewContent: ReactNode;
  settingsContent: ReactNode;
  knowledgeContent: ReactNode;
}

export function WorkspaceDetailShell(props: WorkspaceDetailShellProps): JSX.Element {
  useWorkspaceBreadcrumbIdentity(props.workspace);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <WorkspaceDetailHeader workspace={props.workspace} headerState={props.headerState} />

      <Tabs
        value={props.activeTab}
        onValueChange={(value) => props.onTabChange(value as WorkspaceDetailTabValue)}
      >
        <WorkspaceDetailTabBar activeTab={props.activeTab} onTabChange={props.onTabChange} />

        <TabsContent value="overview">{props.overviewContent}</TabsContent>
        <TabsContent value="settings">{props.settingsContent}</TabsContent>
        <TabsContent value="knowledge">{props.knowledgeContent}</TabsContent>
      </Tabs>
    </div>
  );
}

function WorkspaceDetailHeader(props: {
  workspace: DashboardWorkspaceRecord;
  headerState: WorkspaceDetailHeaderState;
}): JSX.Element {
  const { workspace, headerState } = props;
  const isExpanded = headerState.mode === 'expanded';
  const workspaceLinkState = { workspaceLabel: workspace.name };

  return (
    <Card className="border-border/70 shadow-none">
      <CardHeader className={isExpanded ? 'space-y-4' : 'space-y-2 py-3'}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div
            className={
              isExpanded ? 'max-w-3xl space-y-3' : 'min-w-0 flex-1 space-y-1.5'
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={workspace.is_active ? 'success' : 'secondary'}>
                {workspace.is_active ? 'Active' : 'Inactive'}
              </Badge>
              {isExpanded ? <Badge variant="outline">{workspace.slug}</Badge> : null}
              {isExpanded ? <Badge variant="outline">{readWorkspaceStorageLabel(workspace)}</Badge> : null}
              {!isExpanded ? <Badge variant="outline">{headerState.activeTab.label}</Badge> : null}
            </div>
            <div className="space-y-1">
              <h1 className="text-lg font-semibold tracking-tight">
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
                  <Link to={action.href} state={workspaceLinkState}>
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

function WorkspaceDetailTabBar(props: {
  activeTab: WorkspaceDetailTabValue;
  onTabChange(nextTab: WorkspaceDetailTabValue): void;
}): JSX.Element {
  return (
    <div className="sticky top-0 z-10 space-y-2 rounded-2xl bg-background/95 pb-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="sm:hidden">
        <Select
          value={props.activeTab}
          onValueChange={(value) => props.onTabChange(value as WorkspaceDetailTabValue)}
        >
          <SelectTrigger aria-label="Select workspace workspace tab">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WORKSPACE_DETAIL_TAB_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <TabsList className="hidden h-auto w-full grid-cols-3 gap-1 rounded-xl bg-border/30 p-1 sm:grid">
        {WORKSPACE_DETAIL_TAB_OPTIONS.map((option) => (
          <TabsTrigger key={option.value} value={option.value} className="min-w-0">
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );
}

function useWorkspaceBreadcrumbIdentity(workspace: DashboardWorkspaceRecord): void {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    rememberWorkspaceBreadcrumbLabel(workspace.id, workspace.name);
  }, [workspace.id, workspace.name]);

  useEffect(() => {
    const currentState = location.state && typeof location.state === 'object'
      ? location.state as Record<string, unknown>
      : {};
    if (currentState.workspaceLabel === workspace.name) {
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
        state: { ...currentState, workspaceLabel: workspace.name },
      },
    );
  }, [
    location.hash,
    location.pathname,
    location.search,
    location.state,
    navigate,
    workspace.name,
  ]);
}
