import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Loader2, Webhook, Zap } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { dashboardApi } from '../../lib/api.js';
import type {
  DashboardProjectRecord,
  DashboardScheduledWorkItemTriggerRecord,
  DashboardWebhookWorkItemTriggerRecord,
  DashboardWorkflowRecord,
} from '../../lib/api.js';

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

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Trigger Overview</h1>
          <p className="text-sm text-muted">
            Scheduled work-item triggers now live with project settings. Use this page to review
            health, next runs, and legacy webhook coverage across projects.
          </p>
        </div>
        <Button asChild>
          <Link to="/projects">Open project settings</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Scheduled Triggers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scheduled.length === 0 ? (
            <p className="text-sm text-muted">No scheduled work-item triggers configured.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Cadence</TableHead>
                  <TableHead>Next Run</TableHead>
                  <TableHead>Health</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scheduled
                  .slice()
                  .sort((left, right) => left.next_fire_at.localeCompare(right.next_fire_at))
                  .map((trigger) => (
                    <TableRow key={trigger.id}>
                      <TableCell className="font-medium">
                        <div className="space-y-1">
                          <div>{trigger.name}</div>
                          <div className="text-xs text-muted">{trigger.source}</div>
                        </div>
                      </TableCell>
                      <TableCell>{renderProjectLink(projects, trigger.project_id)}</TableCell>
                      <TableCell>{renderWorkflowName(workflows, trigger.workflow_id)}</TableCell>
                      <TableCell>{formatCadence(trigger.cadence_minutes)}</TableCell>
                      <TableCell>{formatDateTime(trigger.next_fire_at)}</TableCell>
                      <TableCell>
                        <Badge variant={describeHealth(trigger).variant}>
                          {describeHealth(trigger).label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-4 w-4" />
            Webhook Triggers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {webhooks.length === 0 ? (
            <p className="text-sm text-muted">No webhook work-item triggers configured.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks
                  .slice()
                  .sort((left, right) => left.name.localeCompare(right.name))
                  .map((trigger) => (
                    <TableRow key={trigger.id}>
                      <TableCell className="font-medium">{trigger.name}</TableCell>
                      <TableCell>{renderProjectLink(projects, trigger.project_id)}</TableCell>
                      <TableCell>{renderWorkflowName(workflows, trigger.workflow_id)}</TableCell>
                      <TableCell>{trigger.source}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{trigger.signature_mode}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={trigger.is_active ? 'success' : 'secondary'}>
                          {trigger.is_active ? 'Active' : 'Disabled'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
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

function renderWorkflowName(workflows: DashboardWorkflowRecord[], workflowId: string): string {
  return workflows.find((entry) => entry.id === workflowId)?.name ?? workflowId;
}

function formatCadence(minutes: number): string {
  if (minutes < 60) return `Every ${minutes} min`;
  if (minutes % 60 === 0) return `Every ${minutes / 60} hr`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `Every ${hours} hr ${remainder} min`;
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toLocaleString();
}

function describeHealth(trigger: DashboardScheduledWorkItemTriggerRecord) {
  if (!trigger.is_active) {
    return { label: 'Disabled', variant: 'secondary' as const };
  }
  if (Date.parse(trigger.next_fire_at) <= Date.now()) {
    return { label: 'Due', variant: 'warning' as const };
  }
  return { label: 'Scheduled', variant: 'success' as const };
}
