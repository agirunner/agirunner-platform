import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings2, Save } from 'lucide-react';
import { dashboardApi, type DashboardGovernanceRetentionPolicy } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../components/ui/card.js';
import { Button } from '../../components/ui/button.js';
import { Badge } from '../../components/ui/badge.js';
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

  const loggingMutation = useMutation({
    mutationFn: (newLevel: LogLevel) => dashboardApi.updateLoggingConfig({ level: newLevel }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-logging-config'] });
      toast.success('Settings saved');
    },
    onError: () => {
      toast.error('Failed to save settings');
    },
  });
  const retentionMutation = useMutation({
    mutationFn: (payload: Partial<DashboardGovernanceRetentionPolicy>) =>
      dashboardApi.updateRetentionPolicy(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['retention-policy'] });
      toast.success('Retention settings saved');
    },
    onError: () => {
      toast.error('Failed to save retention settings');
    },
  });

  function handleLoggingSubmit(e: React.FormEvent): void {
    e.preventDefault();
    loggingMutation.mutate(level);
  }
  function handleRetentionSubmit(e: React.FormEvent): void {
    e.preventDefault();
    const archive = parseInt(taskArchiveDays, 10);
    const del = parseInt(taskDeleteDays, 10);
    const exec = parseInt(execLogDays, 10);

    if (isNaN(archive) || isNaN(del) || isNaN(exec)) {
      return;
    }
    if (archive < 1 || del < 1 || exec < 1) {
      return;
    }

    retentionMutation.mutate({
      task_archive_after_days: archive,
      task_delete_after_days: del,
      execution_log_retention_days: exec,
    });
  }

  const hasLoggingChanges = loggingQuery.data && level !== loggingQuery.data.level;
  const hasRetentionChanges =
    retentionQuery.data &&
    (taskArchiveDays !== String(retentionQuery.data.task_archive_after_days) ||
      taskDeleteDays !== String(retentionQuery.data.task_delete_after_days) ||
      execLogDays !== String(retentionQuery.data.execution_log_retention_days));

  if (loggingQuery.isLoading || retentionQuery.isLoading) {
    return <div className="p-6 text-muted-foreground">Loading settings...</div>;
  }

  if (loggingQuery.error || retentionQuery.error) {
    return <div className="p-6 text-red-600">Failed to load settings.</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Settings2 className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Settings</h1>
      </div>

      <Card className="max-w-lg">
        <form onSubmit={handleLoggingSubmit}>
          <CardHeader>
            <CardTitle>Logging</CardTitle>
            <CardDescription>
              Control the minimum log level stored for your tenant. Entries below this level are
              discarded at ingest time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
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

            {loggingMutation.isError && <p className="text-sm text-red-600">Failed to save settings.</p>}
            {loggingMutation.isSuccess && <Badge variant="success">Saved successfully</Badge>}
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={loggingMutation.isPending || !hasLoggingChanges}>
              <Save className="h-4 w-4" />
              {loggingMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card className="max-w-lg">
        <form onSubmit={handleRetentionSubmit}>
          <CardHeader>
            <CardTitle>Retention</CardTitle>
            <CardDescription>
              Control how long completed tasks and execution logs are kept before archival or deletion.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
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

            {retentionMutation.isError && (
              <p className="text-sm text-red-600">Failed to save retention settings.</p>
            )}
            {retentionMutation.isSuccess && <Badge variant="success">Saved successfully</Badge>}
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={retentionMutation.isPending || !hasRetentionChanges}>
              <Save className="h-4 w-4" />
              {retentionMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
