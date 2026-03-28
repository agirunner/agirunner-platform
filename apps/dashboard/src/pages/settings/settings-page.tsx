import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { dashboardApi, type DashboardGovernanceRetentionPolicy } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';
import { Button } from '../../components/ui/button.js';
import {
  DEFAULT_FORM_VALIDATION_MESSAGE,
  FieldErrorText,
  FormFeedbackMessage,
  resolveFormFeedbackMessage,
} from '../../components/forms/form-feedback.js';
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
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

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
  const fieldErrors = {
    taskPruneDays: !isPositiveInteger(taskPruneDays)
      ? 'Enter a positive whole number of days.'
      : undefined,
    workflowDeleteDays: !isPositiveInteger(workflowDeleteDays)
      ? 'Enter a positive whole number of days.'
      : undefined,
    logRetentionDays: !isPositiveInteger(logRetentionDays)
      ? 'Enter a positive whole number of days.'
      : undefined,
  };

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
      toast.success('General Settings saved.');
    },
    onError: () => {
      toast.error('Failed to save general settings.');
    },
  });
  const formFeedbackMessage = resolveFormFeedbackMessage({
    serverError: saveMutation.isError ? 'Failed to save settings.' : null,
    showValidation: hasAttemptedSubmit,
    isValid: !hasRetentionValidationErrors,
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!isDirty) {
      return;
    }
    if (hasRetentionValidationErrors) {
      setHasAttemptedSubmit(true);
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
      <DashboardPageHeader
        navHref="/admin/general-settings"
        description="Configure general operational settings in one place."
        actions={
          <Button type="submit" disabled={!isDirty || isSaving}>
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </Button>
        }
      />

      <DashboardSectionCard
        title="Logging"
        description="Control the minimum log level stored for your tenant. Entries below this level are discarded at ingest time."
        bodyClassName="grid gap-4"
      >
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
      </DashboardSectionCard>

      <DashboardSectionCard
        title="Retention"
        description="Set clear retention rules for ongoing workflow task pruning, terminal workflow cleanup, and logs."
        bodyClassName="grid gap-4"
      >
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
              aria-invalid={Boolean(hasAttemptedSubmit && fieldErrors.taskPruneDays)}
            />
            <FieldErrorText
              message={hasAttemptedSubmit ? fieldErrors.taskPruneDays : undefined}
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
                aria-invalid={Boolean(hasAttemptedSubmit && fieldErrors.workflowDeleteDays)}
              />
              <FieldErrorText
                message={hasAttemptedSubmit ? fieldErrors.workflowDeleteDays : undefined}
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
                aria-invalid={Boolean(hasAttemptedSubmit && fieldErrors.logRetentionDays)}
              />
              <FieldErrorText
                message={hasAttemptedSubmit ? fieldErrors.logRetentionDays : undefined}
              />
              <p className="text-xs text-muted-foreground">
                Log partitions older than this window are dropped.
              </p>
            </div>
          </div>
          <FormFeedbackMessage message={formFeedbackMessage} />
      </DashboardSectionCard>
    </form>
  );
}
