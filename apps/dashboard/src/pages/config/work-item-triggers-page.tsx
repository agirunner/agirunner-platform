import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Card, CardHeader, CardTitle } from '../../components/ui/card.js';
import { dashboardApi } from '../../lib/api.js';
import type { DashboardProjectRecord, DashboardScheduledWorkItemTriggerRecord, DashboardWebhookWorkItemTriggerRecord, DashboardWorkflowRecord } from '../../lib/api.js';
import { buildTriggerOperatorFocus, summarizeTriggerOverview } from './work-item-triggers-page.support.js';
import {
  ScheduledTriggerSection,
  TriggerSummarySection,
  WebhookTriggerSection,
} from './work-item-triggers-page.sections.js';

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
  const operatorFocus = buildTriggerOperatorFocus(scheduled, webhooks);

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

      <TriggerSummarySection focus={operatorFocus} summaries={summaryCards} />
      <ScheduledTriggerSection
        projects={projects}
        workflows={workflows}
        triggers={scheduled.slice().sort((left, right) => left.next_fire_at.localeCompare(right.next_fire_at))}
      />
      <WebhookTriggerSection
        projects={projects}
        workflows={workflows}
        triggers={webhooks.slice().sort((left, right) => left.name.localeCompare(right.name))}
      />
    </div>
  );
}
