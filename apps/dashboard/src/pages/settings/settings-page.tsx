import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Settings2 } from 'lucide-react';
import { dashboardApi, type DashboardGovernanceRetentionPolicy } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { Card, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '../../components/ui/select.js';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

const LOG_LEVEL_DESCRIPTIONS: Record<LogLevel, string> = {
  debug: 'All events including operational telemetry (docker events, image pulls, network changes)',
  info: 'Standard operational events (task lifecycle, API calls, container actions)',
  warn: 'Warnings and errors only (unhealthy containers, unexpected exits, OOM)',
  error: 'Errors only (OOM kills, critical failures)',
};

function isPositiveInteger(value: string): boolean {
  const parsed = parseInt(value, 10);
  return !isNaN(parsed) && parsed > 0;
}

export function SettingsPage(): JSX.Element {
  const queryClient = useQueryClient();

  const loggingQuery = useQuery({
    queryKey: ['governance-logging-config'],
    queryFn: () => dashboardApi.getLoggingConfig(),
  });
  const retentionQuery = useQuery({
    queryKey: ['retention-policy'],
    queryFn: () => dashboardApi.getRetentionPolicy(),
  });

  const [level, setLevel] = useState<LogLevel>('debug');
  const [taskPruneDays, setTaskPruneDays] = useState('');
  const [workflowDeleteDays, setWorkflowDeleteDays] = useState('');
  const [logRetentionDays, setLogRetentionDays] = useState('');

  useEffect(() => {
    if (loggingQuery.data?.level) {
      setLevel(loggingQuery.data.level);
    }
  }, [loggingQuery.data]);
  useEffect(() => {
    if (!retentionQuery.data) {
      return;
    }
    setTaskPruneDays(String(retentionQuery.data.task_prune_after_days));
    setWorkflowDeleteDays(String(retentionQuery.data.workflow_delete_after_days));
    setLogRetentionDays(String(retentionQuery.data.execution_log_retention_days));
  }, [retentionQuery.data]);

  const hasLoggingChanges = loggingQuery.data && level !== loggingQuery.data.level;
  const hasRetentionChanges =
    retentionQuery.data &&
    (taskPruneDays !== String(retentionQuery.data.task_prune_after_days) ||
      workflowDeleteDays !== String(retentionQuery.data.workflow_delete_after_days) ||
      logRetentionDays !== String(retentionQuery.data.execution_log_retention_days));
  const isDirty = Boolean(hasLoggingChanges || hasRetentionChanges);
  const hasRetentionValidationErrors =
    !isPositiveInteger(taskPruneDays) ||
    !isPositiveInteger(workflowDeleteDays) ||
    !isPositiveInteger(logRetentionDays);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const operations: Promise<unknown>[] = [];

      if (hasLoggingChanges) {
        operations.push(dashboardApi.updateLoggingConfig({ level }));
      }

      if (hasRetentionChanges) {
        operations.push(
          dashboardApi.updateRetentionPolicy({
            task_prune_after_days: parseInt(taskPruneDays, 10),
            workflow_delete_after_days: parseInt(workflowDeleteDays, 10),
            execution_log_retention_days: parseInt(logRetentionDays, 10),
          } satisfies Partial<DashboardGovernanceRetentionPolicy>),
        );
      }

      await Promise.all(operations);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['governance-logging-config'] }),
        queryClient.invalidateQueries({ queryKey: ['retention-policy'] }),
      ]);
      toast.success('Settings saved.');
    },
    onError: () => {
      toast.error('Failed to save settings.');
    },
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!isDirty || hasRetentionValidationErrors) {
      return;
    }
    saveMutation.mutate();
  }
  const isSaving = saveMutation.isPending;

  if (loggingQuery.isLoading || retentionQuery.isLoading) {
    return <div className="p-6 text-muted-foreground">Loading settings...</div>;
  }

  if (loggingQuery.error || retentionQuery.error) {
    return <div className="p-6 text-red-600">Failed to load settings.</div>;
  }

  return (
    <form className="space-y-6 p-6" onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-muted" />
                <CardTitle className="text-2xl">Settings</CardTitle>
              </div>
              <CardDescription className="text-sm leading-6">
                Configure general operational settings in one place.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!isDirty || isSaving || hasRetentionValidationErrors}>
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">Logging</h2>
          <p className="text-sm leading-6 text-muted">
            Control the minimum log level stored for your tenant. Entries below this level are
            discarded at ingest time.
          </p>
        </div>
        <div className="grid gap-4">
          <div className="space-y-2">
            <label htmlFor="log-level" className="text-sm font-medium">
              Minimum Log Level
            </label>
            <Select value={level} onValueChange={(v) => setLevel(v as LogLevel)}>
              <SelectTrigger id="log-level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOG_LEVELS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l.charAt(0).toUpperCase() + l.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{LOG_LEVEL_DESCRIPTIONS[level]}</p>
          </div>
        </div>
      </section>

      <section className="space-y-4 border-t border-border/70 pt-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">Retention</h2>
          <p className="text-sm leading-6 text-muted">
            Set clear retention rules for ongoing workflow task pruning, terminal workflow cleanup,
            and logs.
          </p>
        </div>
        <div className="grid gap-4">
          <div className="space-y-3 rounded-lg border border-border/70 bg-card/60 p-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">Task Pruning</h3>
              <p className="text-sm leading-6 text-muted">
                Prune terminal tasks from ongoing workflows after the configured window.
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="task-prune" className="text-sm font-medium">
                Task Pruning Retention (days)
              </label>
              <Input
                id="task-prune"
                type="number"
                min={1}
                value={taskPruneDays}
                onChange={(e) => setTaskPruneDays(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Ongoing workflows are not automatically deleted.
              </p>
            </div>
          </div>
          <div className="space-y-3 rounded-lg border border-border/70 bg-card/60 p-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">Workflow Retention</h3>
              <p className="text-sm leading-6 text-muted">
                Delete terminal workflows after the configured window.
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="workflow-delete" className="text-sm font-medium">
                Delete terminal workflows after (days)
              </label>
              <Input
                id="workflow-delete"
                type="number"
                min={1}
                value={workflowDeleteDays}
                onChange={(e) => setWorkflowDeleteDays(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Deleting a workflow also removes its workflow-owned records.
              </p>
            </div>
          </div>
          <div className="space-y-3 rounded-lg border border-border/70 bg-card/60 p-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">Log Retention</h3>
              <p className="text-sm leading-6 text-muted">
                Keep logs on their own retention window, separate from workflow data.
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="log-retention" className="text-sm font-medium">
                Log Retention (days)
              </label>
              <Input
                id="log-retention"
                type="number"
                min={1}
                value={logRetentionDays}
                onChange={(e) => setLogRetentionDays(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Log partitions older than this window are dropped.
              </p>
            </div>
          </div>
          {hasRetentionValidationErrors ? (
            <p className="text-sm text-red-600">
              Enter positive whole-number retention values before saving.
            </p>
          ) : null}
          {saveMutation.isError ? (
            <p className="text-sm text-red-600">Failed to save settings.</p>
          ) : null}
        </div>
      </section>
    </form>
  );
}
