import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Webhook } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { dashboardApi } from '../../lib/api.js';
import type {
  DashboardProjectRecord,
  DashboardScheduledWorkItemTriggerRecord,
  DashboardWebhookWorkItemTriggerRecord,
} from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { ScheduledTriggersCard } from './project-scheduled-triggers-card.js';
import { WebhookTriggersCard } from './project-webhook-triggers-card.js';

const GIT_PROVIDERS = ['github', 'gitea', 'gitlab'] as const;
type GitProvider = (typeof GIT_PROVIDERS)[number];

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
      <section className="scroll-mt-24">
        <GitWebhookTab project={project} />
      </section>
    </div>
  );
}

function GitWebhookTab({ project }: { project: DashboardProjectRecord }): JSX.Element {
  const queryClient = useQueryClient();
  const hasRepository = Boolean(project.repository_url);
  const [provider, setProvider] = useState(project.git_webhook_provider ?? 'github');
  const [secret, setSecret] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const trimmedSecret = secret.trim();
  const secretError =
    trimmedSecret.length > 0 && trimmedSecret.length < 8
      ? 'Use at least 8 characters before saving.'
      : null;
  const currentProvider = project.git_webhook_provider
    ? formatProviderName(project.git_webhook_provider)
    : 'Not set';

  const mutation = useMutation({
    mutationFn: (payload: { provider: string; secret: string }) =>
      dashboardApi.configureGitWebhook(project.id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      setSecret('');
      setShowEditor(false);
    },
  });

  function handleSave() {
    if (!trimmedSecret || secretError) return;
    mutation.mutate({ provider, secret: trimmedSecret });
  }

  return (
    <Card className="border-border/70 shadow-none">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Webhook className="h-4 w-4" />
              Repository webhook signatures
            </div>
            <p className="text-sm leading-6 text-muted">
              {buildGitSignatureSummary(project, hasRepository)}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowEditor((current) => !current)}
          >
            {showEditor ? 'Hide signatures' : 'Open signatures'}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <AutomationSignalPill
            signal={{
              label: 'Provider',
              value: hasRepository ? currentProvider : 'Optional',
              tone: hasRepository && project.git_webhook_provider ? 'success' : 'secondary',
            }}
          />
          <AutomationSignalPill
            signal={{
              label: 'Secret',
              value: hasRepository
                ? project.git_webhook_secret_configured
                  ? 'Configured'
                  : 'Missing'
                : 'Not in use',
              tone: hasRepository
                ? project.git_webhook_secret_configured
                  ? 'success'
                  : 'warning'
                : 'secondary',
            }}
          />
          <AutomationSignalPill
            signal={{
              label: 'Repository',
              value: hasRepository ? 'Linked' : 'Optional',
              tone: hasRepository ? 'success' : 'secondary',
            }}
          />
        </div>

        {hasRepository ? (
          <p className="break-all text-xs leading-5 text-muted">
            <span className="font-medium text-foreground">Repository:</span> {project.repository_url}
          </p>
        ) : null}

        <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-3 text-sm leading-6 text-muted">
          <span className="font-medium text-foreground">Next move:</span>{' '}
          {buildGitSignatureNextAction(project, hasRepository)}
        </div>

        {showEditor ? (
          <section className="space-y-4 rounded-xl border border-border/70 bg-background/70 p-4">
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-foreground">Configure signatures</h4>
              <p className="text-sm text-muted">
                Save only when the provider changes or the secret rotates.
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
              <label className="space-y-1">
                <span className="text-xs font-medium">Provider</span>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GIT_PROVIDERS.map((providerOption) => (
                      <SelectItem key={providerOption} value={providerOption}>
                        {formatProviderName(providerOption)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted">
                  Match the repository provider for the expected signature header.
                </p>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-medium">Webhook secret</span>
                <Input
                  type="password"
                  placeholder="Enter webhook secret"
                  value={secret}
                  className={cn(
                    secretError ? 'border-amber-300 focus-visible:ring-amber-500' : undefined,
                  )}
                  aria-invalid={secretError ? true : undefined}
                  onChange={(event) => setSecret(event.target.value)}
                />
                {secretError ? (
                  <p className="text-xs text-amber-900 dark:text-amber-100">{secretError}</p>
                ) : (
                  <p className="text-xs text-muted">
                    Enter a new secret only when you are configuring or rotating credentials.
                  </p>
                )}
              </label>
            </div>

            <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-muted">
                The backend stores this secret. This surface only confirms that signature
                verification is configured and reachable.
              </p>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={mutation.isPending || !trimmedSecret || Boolean(secretError)}
              >
                <Save className="h-4 w-4" />
                {project.git_webhook_secret_configured ? 'Update secret' : 'Configure secret'}
              </Button>
            </div>
          </section>
        ) : null}

        {mutation.isError ? (
          <SurfaceStatusMessage tone="warning" title="Could not save signatures">
            Failed to save webhook configuration.
          </SurfaceStatusMessage>
        ) : null}
        {mutation.isSuccess ? (
          <SurfaceStatusMessage tone="success" title="Signatures updated">
            Webhook configuration saved.
          </SurfaceStatusMessage>
        ) : null}
      </CardContent>
    </Card>
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
  const activeWebhookTriggers = webhookTriggers.filter((trigger) => trigger.is_active);
  const overdueSchedules = activeSchedules.filter(
    (trigger) => Date.parse(trigger.next_fire_at) <= now.getTime(),
  );
  const webhookSecretsMissing = activeWebhookTriggers.filter((trigger) => !trigger.secret_configured);
  const liveLaneCount = activeSchedules.length + activeWebhookTriggers.length;
  const issueCount = overdueSchedules.length + webhookSecretsMissing.length;

  if (issueCount > 0) {
    return {
      statusLabel: 'Automation needs attention',
      badgeVariant: 'warning',
      summary: buildAutomationIssueSummary(overdueSchedules.length, webhookSecretsMissing.length),
      nextAction:
        overdueSchedules.length > 0
          ? 'Start with the overdue schedule, then confirm inbound hooks still route to the intended workflow.'
          : 'Set the missing inbound-hook secret before the next external event arrives.',
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
): string {
  const parts = [
    overdueScheduleCount > 0
      ? `${formatCount(overdueScheduleCount, 'overdue schedule')}`
      : null,
    missingWebhookSecretCount > 0
      ? `${formatCount(missingWebhookSecretCount, 'active inbound hook')} missing secrets`
      : null,
  ].filter((value): value is string => value !== null);

  return `${parts.join(' and ')} need operator repair.`;
}

function buildGitSignatureSummary(
  project: DashboardProjectRecord,
  hasRepository: boolean,
): string {
  if (!hasRepository) {
    return 'Repository webhook signatures are optional unless this project should trust git-provider inbound hooks.';
  }
  if (project.git_webhook_secret_configured) {
    return 'Repository trust is configured for git-provider inbound hooks. Open signatures only when the provider changes or credentials rotate.';
  }
  return 'Repository is linked. Configure signatures only if this project should trust git-provider inbound hooks.';
}

function buildGitSignatureNextAction(
  project: DashboardProjectRecord,
  hasRepository: boolean,
): string {
  if (!hasRepository) {
    return 'Leave this collapsed unless this project should trust git-provider inbound hooks.';
  }
  if (!project.git_webhook_provider || !project.git_webhook_secret_configured) {
    return 'Open signatures to finish provider and secret setup before trusting git-provider inbound hooks.';
  }
  return 'Leave this collapsed unless the repository provider changes or the secret rotates.';
}

function isGitProviderSource(source: string | null | undefined): source is GitProvider {
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

function formatProviderName(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}
