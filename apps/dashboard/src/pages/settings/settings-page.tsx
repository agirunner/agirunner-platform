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
  const [taskArchiveDays, setTaskArchiveDays] = useState('');
  const [taskDeleteDays, setTaskDeleteDays] = useState('');
  const [execLogDays, setExecLogDays] = useState('');

  useEffect(() => {
    if (loggingQuery.data?.level) {
      setLevel(loggingQuery.data.level);
    }
  }, [loggingQuery.data]);
  useEffect(() => {
    if (!retentionQuery.data) {
      return;
    }
    setTaskArchiveDays(String(retentionQuery.data.task_archive_after_days));
    setTaskDeleteDays(String(retentionQuery.data.task_delete_after_days));
    setExecLogDays(String(retentionQuery.data.execution_log_retention_days));
  }, [retentionQuery.data]);

  const hasLoggingChanges = loggingQuery.data && level !== loggingQuery.data.level;
  const hasRetentionChanges =
    retentionQuery.data &&
    (taskArchiveDays !== String(retentionQuery.data.task_archive_after_days) ||
      taskDeleteDays !== String(retentionQuery.data.task_delete_after_days) ||
      execLogDays !== String(retentionQuery.data.execution_log_retention_days));
  const isDirty = Boolean(hasLoggingChanges || hasRetentionChanges);
  const hasRetentionValidationErrors =
    !isPositiveInteger(taskArchiveDays) ||
    !isPositiveInteger(taskDeleteDays) ||
    !isPositiveInteger(execLogDays);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const operations: Promise<unknown>[] = [];

      if (hasLoggingChanges) {
        operations.push(dashboardApi.updateLoggingConfig({ level }));
      }

      if (hasRetentionChanges) {
        operations.push(
          dashboardApi.updateRetentionPolicy({
            task_archive_after_days: parseInt(taskArchiveDays, 10),
            task_delete_after_days: parseInt(taskDeleteDays, 10),
            execution_log_retention_days: parseInt(execLogDays, 10),
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
                Configure tenant-wide operational settings for logging and retention in one place.
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
            Control how long completed tasks and execution logs are kept before archival or deletion.
          </p>
        </div>
        <div className="grid gap-4">
          <div className="space-y-2">
            <label htmlFor="task-archive" className="text-sm font-medium">
              Task Archive After (days)
            </label>
            <Input
              id="task-archive"
              type="number"
              min={1}
              value={taskArchiveDays}
              onChange={(e) => setTaskArchiveDays(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Completed tasks older than this move into archive storage.
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor="task-delete" className="text-sm font-medium">
              Task Delete After (days)
            </label>
            <Input
              id="task-delete"
              type="number"
              min={1}
              value={taskDeleteDays}
              onChange={(e) => setTaskDeleteDays(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Archived tasks older than this are permanently deleted.
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor="exec-log" className="text-sm font-medium">
              Execution Log Retention (days)
            </label>
            <Input
              id="exec-log"
              type="number"
              min={1}
              value={execLogDays}
              onChange={(e) => setExecLogDays(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Execution log partitions older than this window are dropped.
            </p>
          </div>
          {hasRetentionValidationErrors ? (
            <p className="text-sm text-red-600">Enter positive whole-number retention values before saving.</p>
          ) : null}
          {saveMutation.isError ? <p className="text-sm text-red-600">Failed to save settings.</p> : null}
        </div>
      </section>
    </form>
  );
}
