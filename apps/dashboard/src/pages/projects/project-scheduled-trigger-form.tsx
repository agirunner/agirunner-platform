import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import type {
  DashboardWorkflowBoardColumn,
  DashboardWorkflowRecord,
  DashboardWorkflowStageRecord,
} from '../../lib/api.js';
import {
  SCHEDULED_TRIGGER_PRIORITY_OPTIONS,
  SCHEDULED_TRIGGER_TIMEZONE_OPTIONS,
  validateScheduledTriggerForm,
  type ScheduledTriggerFormState,
} from './project-scheduled-trigger-support.js';

const EMPTY_SELECT_VALUE = '__empty__';

export function ProjectScheduledTriggerForm({
  form,
  workflows,
  stages,
  columns,
  isEditing,
  isPending,
  isLoadingWorkflowDetails,
  errorMessage,
  onChange,
  onSubmit,
  onCancel,
}: {
  form: ScheduledTriggerFormState;
  workflows: DashboardWorkflowRecord[];
  stages: DashboardWorkflowStageRecord[];
  columns: DashboardWorkflowBoardColumn[];
  isEditing: boolean;
  isPending: boolean;
  isLoadingWorkflowDetails: boolean;
  errorMessage?: string | null;
  onChange: (patch: Partial<ScheduledTriggerFormState>) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const [showRoutingOverrides, setShowRoutingOverrides] = useState(hasRoutingOverrides(form));
  const validation = validateScheduledTriggerForm(form);

  useEffect(() => {
    if (hasRoutingOverrides(form)) {
      setShowRoutingOverrides(true);
    }
  }, [form]);

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{isEditing ? 'Edit schedule' : 'Add schedule'}</h3>
          <p className="text-sm text-muted">
            Configure a recurring work-item creation rule for this project.
          </p>
        </div>
        <Button variant="outline" onClick={onCancel} disabled={isPending}>
          {isEditing ? 'Cancel edit' : 'Close composer'}
        </Button>
      </div>

      {workflows.length === 0 ? (
        <p className="text-sm text-muted">
          Create a target workflow before adding a scheduled trigger.
        </p>
      ) : (
        <>
          <section className="space-y-4 rounded-xl border border-border/70 bg-background/70 p-4">
            <div className="space-y-1">
              <h4 className="text-sm font-semibold">Workflow target and timing</h4>
              <p className="text-sm text-muted">
                Choose the workflow this schedule should target, then choose whether it runs on an
                interval or at a daily wall-clock time.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <FormInput
                label="Name"
                value={form.name}
                placeholder="Daily triage"
                error={validation.fieldErrors.name}
                onChange={(value) => onChange({ name: value })}
              />
              <SelectField
                label="Target workflow"
                value={form.workflowId}
                placeholder="Select workflow"
                error={validation.fieldErrors.workflowId}
                options={workflows.map((workflow) => ({
                  value: workflow.id,
                  label: workflow.name,
                }))}
                onChange={(value) =>
                  onChange({
                    workflowId: value,
                    stageName: '',
                    columnId: '',
                  })
                }
              />
              <SelectField
                label="Schedule type"
                value={form.scheduleType}
                placeholder="Select schedule type"
                options={[
                  { value: 'interval', label: 'Recurring interval' },
                  { value: 'daily_time', label: 'Daily time' },
                ]}
                onChange={(value) =>
                  onChange({
                    scheduleType: (value === 'daily_time' ? 'daily_time' : 'interval') as ScheduledTriggerFormState['scheduleType'],
                  })
                }
              />
              {form.scheduleType === 'interval' ? (
                <FormInput
                  label="Every (minutes)"
                  type="number"
                  value={form.cadenceMinutes}
                  placeholder="60"
                  description="Choose how often this project should create a new work item."
                  error={validation.fieldErrors.cadenceMinutes}
                  onChange={(value) => onChange({ cadenceMinutes: value })}
                />
              ) : (
                <>
                  <FormInput
                    label="Time of day"
                    value={form.dailyTime}
                    placeholder="09:00"
                    description="Use 24-hour HH:MM format."
                    error={validation.fieldErrors.dailyTime}
                    onChange={(value) => onChange({ dailyTime: value })}
                  />
                  <SelectField
                    label="Timezone"
                    value={form.timezone}
                    placeholder="Choose timezone"
                    error={validation.fieldErrors.timezone}
                    options={SCHEDULED_TRIGGER_TIMEZONE_OPTIONS.map((timezone) => ({
                      value: timezone,
                      label: timezone,
                    }))}
                    onChange={(value) => onChange({ timezone: value })}
                  />
                </>
              )}
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-border/70 bg-background/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Routing overrides</h4>
                <p className="text-sm text-muted">
                  Leave these blank to use the workflow&apos;s default intake stage, board column,
                  and normal priority.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRoutingOverrides((current) => !current)}
                disabled={!form.workflowId && !showRoutingOverrides}
              >
                {showRoutingOverrides ? 'Hide routing overrides' : 'Open routing overrides'}
              </Button>
            </div>
            {showRoutingOverrides ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <SelectField
                  label="Stage"
                  value={form.stageName}
                  placeholder={isLoadingWorkflowDetails ? 'Loading stages' : 'Use workflow default'}
                  options={stages.map((stage) => ({ value: stage.name, label: stage.name }))}
                  onChange={(value) => onChange({ stageName: value })}
                  disabled={!form.workflowId || isLoadingWorkflowDetails}
                />
                <SelectField
                  label="Target board column"
                  value={form.columnId}
                  placeholder={
                    isLoadingWorkflowDetails ? 'Loading board columns' : 'Use board default'
                  }
                  options={columns.map((column) => ({ value: column.id, label: column.label }))}
                  onChange={(value) => onChange({ columnId: value })}
                  disabled={!form.workflowId || isLoadingWorkflowDetails}
                />
                <SelectField
                  label="Priority"
                  value={form.priority}
                  placeholder="Normal work item priority"
                  options={SCHEDULED_TRIGGER_PRIORITY_OPTIONS.map((priority) => ({
                    value: priority,
                    label: priority.charAt(0).toUpperCase() + priority.slice(1),
                  }))}
                  onChange={(value) => onChange({ priority: value })}
                />
              </div>
            ) : null}
          </section>

          <section className="space-y-4 rounded-xl border border-border/70 bg-background/70 p-4">
            <div className="space-y-1">
              <h4 className="text-sm font-semibold">Work item template</h4>
              <p className="text-sm text-muted">
                Define the work item the orchestrator will receive each time this schedule fires.
              </p>
            </div>
            <div className="space-y-4">
              <FormInput
                label="Work item title"
                value={form.title}
                placeholder="Run daily inbox triage"
                error={validation.fieldErrors.title}
                onChange={(value) => onChange({ title: value })}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <FormTextarea
                  label="Goal"
                  value={form.goal}
                  placeholder="Check open work, route urgent items, and summarize the queue."
                  onChange={(value) => onChange({ goal: value })}
                />
                <FormTextarea
                  label="Acceptance criteria"
                  value={form.acceptanceCriteria}
                  placeholder="Summarize queue health, route urgent work, and record blockers."
                  onChange={(value) => onChange({ acceptanceCriteria: value })}
                />
              </div>
            </div>
          </section>

          {validation.issues.length > 0 ? (
            <div className="rounded-xl border border-amber-300/80 bg-background/70 p-3 text-sm dark:border-amber-800/70">
              <p className="font-medium text-foreground">Finish these items before saving:</p>
              <ul className="mt-2 space-y-1 text-amber-900 dark:text-amber-100">
                {validation.issues.map((issue) => (
                  <li key={issue}>• {issue}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/90">
            <p className="text-sm text-muted">
              Save once the target workflow, schedule, and work-item template all look correct.
            </p>
            <Button disabled={isPending || !validation.isValid} onClick={onSubmit}>
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {isEditing ? 'Save schedule' : 'Add schedule'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function hasRoutingOverrides(form: ScheduledTriggerFormState): boolean {
  return (
    form.stageName.trim().length > 0 ||
    form.columnId.trim().length > 0 ||
    form.priority.trim().length > 0
  );
}

function FormInput(props: {
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  description?: string;
  error?: string;
  onChange(value: string): void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium">{props.label}</span>
      <Input
        type={props.type}
        value={props.value}
        placeholder={props.placeholder}
        className={props.error ? 'border-red-300 focus-visible:ring-red-500' : undefined}
        aria-invalid={props.error ? true : undefined}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.description ? <p className="text-xs text-muted">{props.description}</p> : null}
      {props.error ? <p className="text-xs text-red-600">{props.error}</p> : null}
    </label>
  );
}

function FormTextarea(props: {
  label: string;
  value: string;
  placeholder?: string;
  onChange(value: string): void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium">{props.label}</span>
      <Textarea
        rows={4}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField(props: {
  label: string;
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  error?: string;
  onChange(value: string): void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium">{props.label}</span>
      <Select
        value={props.value || EMPTY_SELECT_VALUE}
        disabled={props.disabled}
        onValueChange={(value) => props.onChange(value === EMPTY_SELECT_VALUE ? '' : value)}
      >
        <SelectTrigger className={props.error ? 'border-red-300 focus:ring-red-500' : undefined}>
          <SelectValue placeholder={props.placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={EMPTY_SELECT_VALUE}>{props.placeholder}</SelectItem>
          {props.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {props.error ? <p className="text-xs text-red-600">{props.error}</p> : null}
    </label>
  );
}
