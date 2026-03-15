import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import type { DashboardProjectRecord } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';

const GIT_PROVIDERS = ['github', 'gitea', 'gitlab'] as const;

export function ProjectGitWebhookSignaturesCard({
  project,
  compact = false,
}: {
  project: DashboardProjectRecord;
  compact?: boolean;
}): JSX.Element {
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
      <CardContent className={compact ? 'space-y-3 p-4 pt-0' : 'space-y-3 p-4'}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Webhook className="h-4 w-4" />
              Git repository signatures
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
          <SignalPill
            label="Provider"
            value={hasRepository ? currentProvider : 'Optional'}
            variant={hasRepository && project.git_webhook_provider ? 'success' : 'secondary'}
          />
          <SignalPill
            label="Secret"
            value={
              hasRepository
                ? project.git_webhook_secret_configured
                  ? 'Configured'
                  : 'Missing'
                : 'Not in use'
            }
            variant={
              hasRepository
                ? project.git_webhook_secret_configured
                  ? 'success'
                  : 'warning'
                : 'secondary'
            }
          />
          <SignalPill
            label="Repository"
            value={hasRepository ? 'Linked' : 'Optional'}
            variant={hasRepository ? 'success' : 'secondary'}
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
                  Only use this for GitHub, Gitea, or GitLab inbound repository hooks. Leave it
                  alone for non-git triggers.
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
                variant="outline"
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
          <StatusMessage tone="warning" title="Could not save signatures">
            Failed to save webhook configuration.
          </StatusMessage>
        ) : null}
        {mutation.isSuccess ? (
          <StatusMessage tone="success" title="Signatures updated">
            Webhook configuration saved.
          </StatusMessage>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SignalPill(props: {
  label: string;
  value: string;
  variant: 'success' | 'warning' | 'secondary';
}) {
  const className =
    props.variant === 'success'
      ? 'border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-900/70 dark:bg-emerald-950/20'
      : props.variant === 'warning'
        ? 'border-amber-200/80 bg-amber-50/70 dark:border-amber-900/70 dark:bg-amber-950/20'
        : 'border-slate-300/70 bg-slate-100/70 dark:border-slate-800/80 dark:bg-slate-900/40';
  return (
    <div className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs', className)}>
      <span className="font-medium uppercase tracking-[0.16em] text-muted">{props.label}</span>
      <span className="font-semibold text-foreground">{props.value}</span>
    </div>
  );
}

function StatusMessage(props: {
  tone: 'success' | 'warning';
  title: string;
  children: string;
}) {
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

function buildGitSignatureSummary(
  project: DashboardProjectRecord,
  hasRepository: boolean,
): string {
  if (!hasRepository) {
    return 'Optional. Use this only when GitHub, Gitea, or GitLab should be allowed to deliver signed inbound repository events for this project.';
  }
  if (project.git_webhook_secret_configured) {
    return 'Repository trust is configured for git-provider inbound hooks. This is only for GitHub, Gitea, or GitLab repository events, and it stays optional for non-git triggers.';
  }
  return 'Repository is linked. Configure signatures only if this project should trust GitHub, Gitea, or GitLab inbound hooks.';
}

function buildGitSignatureNextAction(
  project: DashboardProjectRecord,
  hasRepository: boolean,
): string {
  if (!hasRepository) {
    return 'Leave this collapsed unless GitHub, Gitea, or GitLab inbound hooks should be trusted for this project.';
  }
  if (!project.git_webhook_provider || !project.git_webhook_secret_configured) {
    return 'Open signatures to finish provider and secret setup before trusting GitHub, Gitea, or GitLab inbound hooks.';
  }
  return 'Leave this collapsed unless the git provider changes or the secret rotates.';
}

function formatProviderName(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
