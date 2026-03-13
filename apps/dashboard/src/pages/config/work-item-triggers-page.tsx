import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Loader2, Webhook, Zap } from 'lucide-react';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table.js';
import { dashboardApi } from '../../lib/api.js';
import type { DashboardProjectRecord, DashboardScheduledWorkItemTriggerRecord, DashboardWebhookWorkItemTriggerRecord, DashboardWorkflowRecord } from '../../lib/api.js';
import { describeScheduledTriggerHealth, describeScheduledTriggerPacket, describeWebhookTriggerPacket, summarizeTriggerOverview } from './work-item-triggers-page.support.js';

export function WorkItemTriggersPage(): JSX.Element {
  const projectsQuery = useQuery({
    queryKey: ['projects', 'trigger-overview'],
    queryFn: () => dashboardApi.listProjects(),
  });
  const workflowsQuery = useQuery({
    queryKey: ['workflows', 'trigger-overview'],
    queryFn: () => dashboardApi.listWorkflows({ per_page: '100' }),
  });
  const scheduledQuery = useQuery({
    queryKey: ['scheduled-work-item-triggers', 'overview'],
    queryFn: () => dashboardApi.listScheduledWorkItemTriggers(),
  });
  const webhookQuery = useQuery({
    queryKey: ['webhook-work-item-triggers', 'overview'],
    queryFn: () => dashboardApi.listWebhookWorkItemTriggers(),
  });

  if (projectsQuery.isLoading || workflowsQuery.isLoading || scheduledQuery.isLoading || webhookQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (projectsQuery.error || workflowsQuery.error || scheduledQuery.error || webhookQuery.error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load trigger overview.
        </div>
      </div>
    );
  }

  const projects = (projectsQuery.data?.data ?? []) as DashboardProjectRecord[];
  const workflows = (workflowsQuery.data?.data ?? []) as DashboardWorkflowRecord[];
  const scheduled = (scheduledQuery.data?.data ?? []) as DashboardScheduledWorkItemTriggerRecord[];
  const webhooks = (webhookQuery.data?.data ?? []) as DashboardWebhookWorkItemTriggerRecord[];
  const summaryCards = summarizeTriggerOverview(scheduled, webhooks);

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <CardTitle className="text-2xl">Trigger Overview</CardTitle>
            <p className="max-w-3xl text-sm text-muted">
              Scheduled work-item triggers live with project automation settings. Use this page to
              review recurring work creation, webhook intake coverage, and which rules need operator
              attention before opening the owning project.
            </p>
          </div>
          <Button asChild>
            <Link to="/projects">Open project settings</Link>
          </Button>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {summaryCards.map((summary) => (
          <Card key={summary.label}>
            <CardHeader className="space-y-1">
              <p className="text-sm font-medium text-muted">{summary.label}</p>
              <CardTitle className="text-2xl">{summary.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted">{summary.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Scheduled Triggers
          </CardTitle>
          <p className="text-sm text-muted">
            Review cadence, next-run posture, and owning project scope before editing the trigger in
            the project automation tab.
          </p>
        </CardHeader>
        <CardContent>
          {scheduled.length === 0 ? (
            <p className="text-sm text-muted">No scheduled work-item triggers configured.</p>
          ) : (
            <>
              <div className="space-y-4 lg:hidden">
                {scheduled
                  .slice()
                  .sort((left, right) => left.next_fire_at.localeCompare(right.next_fire_at))
                  .map((trigger) => {
                    const details = describeScheduledTriggerPacket(trigger);
                    const health = describeScheduledTriggerHealth(trigger);
                    return (
                      <Card key={trigger.id}>
                        <CardHeader className="gap-3">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <CardTitle className="text-base">{trigger.name}</CardTitle>
                              <Badge variant={health.variant}>{health.label}</Badge>
                              <Badge variant="outline">{details.source}</Badge>
                            </div>
                            <p className="text-sm text-muted">
                              {details.cadence} • Next run {details.nextRun}
                            </p>
                          </div>
                        </CardHeader>
                        <CardContent className="grid gap-2 text-sm">
                          <p>Project {renderProjectLabel(projects, trigger.project_id)}</p>
                          <p>Run {renderWorkflowName(workflows, trigger.workflow_id)}</p>
                        </CardContent>
                      </Card>
                    );
                  })}
              </div>
              <div className="hidden overflow-x-auto lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Run</TableHead>
                      <TableHead>Cadence</TableHead>
                      <TableHead>Next Run</TableHead>
                      <TableHead>Health</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scheduled
                      .slice()
                      .sort((left, right) => left.next_fire_at.localeCompare(right.next_fire_at))
                      .map((trigger) => {
                        const details = describeScheduledTriggerPacket(trigger);
                        const health = describeScheduledTriggerHealth(trigger);
                        return (
                          <TableRow key={trigger.id}>
                            <TableCell className="font-medium">
                              <div className="space-y-1">
                                <div>{trigger.name}</div>
                                <div className="text-xs text-muted">{details.source}</div>
                              </div>
                            </TableCell>
                            <TableCell>{renderProjectLink(projects, trigger.project_id)}</TableCell>
                            <TableCell>{renderWorkflowName(workflows, trigger.workflow_id)}</TableCell>
                            <TableCell>{details.cadence}</TableCell>
                            <TableCell>{details.nextRun}</TableCell>
                            <TableCell>
                              <Badge variant={health.variant}>{health.label}</Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-4 w-4" />
            Webhook Triggers
          </CardTitle>
          <p className="text-sm text-muted">
            Review inbound trigger coverage, signature mode, and owning scope before adjusting the
            source system or project wiring.
          </p>
        </CardHeader>
        <CardContent>
          {webhooks.length === 0 ? (
            <p className="text-sm text-muted">No webhook work-item triggers configured.</p>
          ) : (
            <>
              <div className="space-y-4 lg:hidden">
                {webhooks
                  .slice()
                  .sort((left, right) => left.name.localeCompare(right.name))
                  .map((trigger) => {
                    const details = describeWebhookTriggerPacket(trigger);
                    return (
                      <Card key={trigger.id}>
                        <CardHeader className="gap-3">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <CardTitle className="text-base">{trigger.name}</CardTitle>
                              <Badge variant={trigger.is_active ? 'success' : 'secondary'}>
                                {details.activity}
                              </Badge>
                              <Badge variant="outline">{details.mode}</Badge>
                            </div>
                            <p className="text-sm text-muted">{details.source}</p>
                          </div>
                        </CardHeader>
                        <CardContent className="grid gap-2 text-sm">
                          <p>Project {renderProjectLabel(projects, trigger.project_id)}</p>
                          <p>Run {renderWorkflowName(workflows, trigger.workflow_id)}</p>
                        </CardContent>
                      </Card>
                    );
                  })}
              </div>
              <div className="hidden overflow-x-auto lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Run</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Active</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {webhooks
                      .slice()
                      .sort((left, right) => left.name.localeCompare(right.name))
                      .map((trigger) => {
                        const details = describeWebhookTriggerPacket(trigger);
                        return (
                          <TableRow key={trigger.id}>
                            <TableCell className="font-medium">{trigger.name}</TableCell>
                            <TableCell>{renderProjectLink(projects, trigger.project_id)}</TableCell>
                            <TableCell>{renderWorkflowName(workflows, trigger.workflow_id)}</TableCell>
                            <TableCell>{details.source}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{details.mode}</Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={trigger.is_active ? 'success' : 'secondary'}>
                                {details.activity}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function renderProjectLink(
  projects: DashboardProjectRecord[],
  projectId: string | null | undefined,
): JSX.Element {
  if (!projectId) {
    return <span className="text-sm text-muted">Unscoped</span>;
  }
  const project = projects.find((entry) => entry.id === projectId);
  return (
    <Link to={`/projects/${projectId}`} className="text-sm text-accent hover:underline">
      {project?.name ?? projectId}
    </Link>
  );
}

function renderProjectLabel(
  projects: DashboardProjectRecord[],
  projectId: string | null | undefined,
): string {
  return projectId ? projects.find((entry) => entry.id === projectId)?.name ?? projectId : 'Unscoped';
}

function renderWorkflowName(workflows: DashboardWorkflowRecord[], workflowId: string): string {
  return workflows.find((entry) => entry.id === workflowId)?.name ?? workflowId;
}
