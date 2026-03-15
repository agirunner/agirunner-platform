import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { dashboardApi } from '../../lib/api.js';
import type {
  DashboardProjectRecord,
  DashboardScheduledWorkItemTriggerRecord,
  DashboardWebhookWorkItemTriggerRecord,
} from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { ScheduledTriggersCard } from './project-scheduled-triggers-card.js';
import { WebhookTriggersCard } from './project-webhook-triggers-card.js';

interface AutomationHeaderSignal {
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'secondary';
}

interface AutomationHeaderState {
  statusLabel: string;
  badgeVariant: 'success' | 'warning' | 'secondary';
  summary: string;
  nextAction: string;
  signals: AutomationHeaderSignal[];
}

export function ProjectAutomationTab({ project }: { project: DashboardProjectRecord }): JSX.Element {
  const scheduledTriggersQuery = useQuery({
    queryKey: ['scheduled-work-item-triggers', project.id],
    queryFn: () => dashboardApi.listScheduledWorkItemTriggers(),
  });
  const webhookTriggersQuery = useQuery({
    queryKey: ['webhook-work-item-triggers', project.id],
    queryFn: () => dashboardApi.listWebhookWorkItemTriggers(),
  });

  const scheduledTriggers = useMemo(
    () =>
      ((scheduledTriggersQuery.data?.data ?? []) as DashboardScheduledWorkItemTriggerRecord[]).filter(
        (trigger) => trigger.project_id === project.id,
      ),
    [project.id, scheduledTriggersQuery.data],
  );
  const webhookTriggers = useMemo(
    () =>
      ((webhookTriggersQuery.data?.data ?? []) as DashboardWebhookWorkItemTriggerRecord[]).filter(
        (trigger) => trigger.project_id === project.id,
      ),
    [project.id, webhookTriggersQuery.data],
  );
  const headerState = buildAutomationHeaderState(project, scheduledTriggers, webhookTriggers);
  const isOverviewLoading = scheduledTriggersQuery.isLoading || webhookTriggersQuery.isLoading;
  const overviewError = scheduledTriggersQuery.error || webhookTriggersQuery.error;

  return (
    <div className="space-y-3">
      <Card className="border-border/70 shadow-none">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-base font-semibold text-foreground">Automation</div>
                <Badge variant={headerState.badgeVariant}>{headerState.statusLabel}</Badge>
              </div>
              <p className="text-sm leading-6 text-muted">{headerState.summary}</p>
            </div>
            {isOverviewLoading ? (
              <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-medium text-muted">
                Refreshing posture
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {headerState.signals.map((signal) => (
              <AutomationSignalPill key={signal.label} signal={signal} />
            ))}
          </div>

          <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-3 text-sm leading-6 text-muted">
            <span className="font-medium text-foreground">Next move:</span> {headerState.nextAction}
          </div>

          {overviewError ? (
            <SurfaceStatusMessage tone="warning" title="Automation status is partial">
              Schedule and inbound-hook cards below still render their live data and save paths.
            </SurfaceStatusMessage>
          ) : null}
        </CardContent>
      </Card>

      <section className="scroll-mt-24">
        <ScheduledTriggersCard project={project} />
      </section>
      <section className="scroll-mt-24">
        <WebhookTriggersCard project={project} />
      </section>
    </div>
  );
}

function AutomationSignalPill(props: { signal: AutomationHeaderSignal }): JSX.Element {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs',
        automationSignalClassName(props.signal.tone),
      )}
    >
      <span className="font-medium uppercase tracking-[0.16em] text-muted">
        {props.signal.label}
      </span>
      <span className="font-semibold text-foreground">{props.signal.value}</span>
    </div>
  );
}

function SurfaceStatusMessage(props: {
  tone: 'success' | 'warning';
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={props.tone}>{props.tone === 'success' ? 'Saved' : 'Attention'}</Badge>
        <p className="text-sm font-medium text-foreground">{props.title}</p>
      </div>
      <p className="mt-1 text-sm leading-6 text-muted">{props.children}</p>
    </div>
  );
}

function buildAutomationHeaderState(
  project: DashboardProjectRecord,
  scheduledTriggers: DashboardScheduledWorkItemTriggerRecord[],
  webhookTriggers: DashboardWebhookWorkItemTriggerRecord[],
  now: Date = new Date(),
): AutomationHeaderState {
  const hasRepository = Boolean(project.repository_url);
  const hasGitInboundHooks = webhookTriggers.some((trigger) =>
    isGitProviderSource(trigger.source),
  );
  const activeSchedules = scheduledTriggers.filter((trigger) => trigger.is_active);
  const pausedSchedules = scheduledTriggers.filter((trigger) => !trigger.is_active);
  const activeWebhookTriggers = webhookTriggers.filter((trigger) => trigger.is_active);
  const pausedWebhookTriggers = webhookTriggers.filter((trigger) => !trigger.is_active);
  const overdueSchedules = activeSchedules.filter(
    (trigger) => Date.parse(trigger.next_fire_at) <= now.getTime(),
  );
  const webhookSecretsMissing = activeWebhookTriggers.filter((trigger) => !trigger.secret_configured);
  const liveLaneCount = activeSchedules.length + activeWebhookTriggers.length;
  const pausedLaneCount = pausedSchedules.length + pausedWebhookTriggers.length;
  const issueCount = overdueSchedules.length + webhookSecretsMissing.length + pausedLaneCount;

  if (issueCount > 0) {
    return {
      statusLabel: 'Automation needs attention',
      badgeVariant: 'warning',
      summary: buildAutomationIssueSummary(
        overdueSchedules.length,
        webhookSecretsMissing.length,
        pausedSchedules.length,
        pausedWebhookTriggers.length,
      ),
      nextAction:
        overdueSchedules.length > 0
          ? 'Start with the overdue schedule, then confirm inbound hooks still route to the intended workflow.'
          : webhookSecretsMissing.length > 0
            ? 'Set the missing inbound-hook secret before the next external event arrives.'
            : 'Review the paused automation lane before re-enabling it or leaving it dormant.',
      signals: [
        {
          label: 'Live',
          value: liveLaneCount > 0 ? `${liveLaneCount} live` : 'No live lanes',
          tone: liveLaneCount > 0 ? 'success' : 'secondary',
        },
        {
          label: 'Attention',
          value: `${issueCount} ${issueCount === 1 ? 'issue' : 'issues'}`,
          tone: 'warning',
        },
        {
          label: 'Repository',
          value: hasRepository ? 'Linked' : 'Optional',
          tone: hasRepository ? 'success' : 'secondary',
        },
      ],
    };
  }

  if (liveLaneCount > 0) {
    return {
      statusLabel: 'Automation live',
      badgeVariant: 'success',
      summary: hasRepository
        ? `${formatCount(activeSchedules.length, 'schedule')} and ${formatCount(activeWebhookTriggers.length, 'inbound hook')} are currently feeding this project.`
        : `${formatCount(activeSchedules.length, 'schedule')} and ${formatCount(activeWebhookTriggers.length, 'inbound hook')} are live. Repository webhook signatures stay optional until this project accepts git-provider inbound hooks.`,
      nextAction: hasRepository
        ? 'Adjust cadence, hook routes, or repository trust only when the project workflow changes.'
        : 'Keep schedules and inbound hooks aligned. Link a repository only when this project should accept git-provider inbound hooks.',
      signals: [
        { label: 'Live', value: `${liveLaneCount} live`, tone: 'success' },
        { label: 'Attention', value: 'Clear', tone: 'success' },
        {
          label: 'Repository',
          value: hasRepository ? 'Linked' : 'Optional',
          tone: hasRepository ? 'success' : 'secondary',
        },
      ],
    };
  }

  return {
    statusLabel: 'Automation ready',
    badgeVariant: 'secondary',
    summary: hasRepository && hasGitInboundHooks
      ? 'No schedules or inbound hooks are active yet. Open the lanes below when this project needs automation.'
      : 'No schedules or inbound hooks are active yet. Repository webhook signatures are optional unless this project should trust git-provider inbound hooks.',
    nextAction: hasRepository && hasGitInboundHooks
      ? 'Start with a schedule or inbound hook, then open signatures only if repository trust changes.'
      : 'Start with a schedule or inbound hook. Open repository signatures only when git-provider inbound hooks should be trusted.',
    signals: [
      { label: 'Live', value: 'No live lanes', tone: 'secondary' },
      { label: 'Attention', value: 'Clear', tone: 'success' },
      {
        label: 'Repository',
        value: hasRepository ? 'Linked' : 'Optional',
        tone: hasRepository ? 'success' : 'secondary',
      },
    ],
  };
}

function buildAutomationIssueSummary(
  overdueScheduleCount: number,
  missingWebhookSecretCount: number,
  pausedScheduleCount: number,
  pausedWebhookCount: number,
): string {
  const parts = [
    overdueScheduleCount > 0
      ? `${formatCount(overdueScheduleCount, 'overdue schedule')}`
      : null,
    missingWebhookSecretCount > 0
      ? `${formatCount(missingWebhookSecretCount, 'active inbound hook')} missing secrets`
      : null,
    pausedScheduleCount > 0 ? `${formatCount(pausedScheduleCount, 'paused schedule')}` : null,
    pausedWebhookCount > 0 ? `${formatCount(pausedWebhookCount, 'paused inbound hook')}` : null,
  ].filter((value): value is string => value !== null);

  const verb = parts.length === 1 && parts[0]?.startsWith('1 ') ? 'needs' : 'need';
  return `${parts.join(' and ')} ${verb} operator repair.`;
}

function isGitProviderSource(source: string | null | undefined): boolean {
  return source === 'github' || source === 'gitea' || source === 'gitlab';
}

function automationSignalClassName(
  tone: AutomationHeaderSignal['tone'],
): string {
  switch (tone) {
    case 'success':
      return 'border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-900/70 dark:bg-emerald-950/20';
    case 'warning':
      return 'border-amber-200/80 bg-amber-50/70 dark:border-amber-900/70 dark:bg-amber-950/20';
    default:
      return 'border-slate-300/70 bg-slate-100/70 dark:border-slate-800/80 dark:bg-slate-900/40';
  }
}
function formatCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}
