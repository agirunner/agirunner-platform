import { Loader2, Save } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import type { DashboardWorkflowBoardColumn, DashboardWorkflowRecord, DashboardWorkflowStageRecord } from '../../lib/api.js';
import { DEFAULT_SCHEDULED_TRIGGER_SOURCE, SCHEDULED_TRIGGER_PRIORITY_OPTIONS, validateScheduledTriggerForm, type ScheduledTriggerFormState } from './project-scheduled-trigger-support.js';

const EMPTY_SELECT_VALUE = '__empty__';
type RoleOption = { id: string; name: string; description: string | null; is_active: boolean };

export function ProjectScheduledTriggerForm({
  form,
  workflows,
  stages,
  columns,
  roles,
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
  roles: RoleOption[];
  isEditing: boolean;
  isPending: boolean;
  isLoadingWorkflowDetails: boolean;
  errorMessage?: string | null;
  onChange: (patch: Partial<ScheduledTriggerFormState>) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const validation = validateScheduledTriggerForm(form);
  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{isEditing ? 'Edit schedule' : 'Add schedule'}</h3>
          <p className="text-sm text-muted">
            Configure a recurring work-item creation rule for this project.
          </p>
        </div>
        {isEditing ? (
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel edit
          </Button>
        ) : null}
      </div>

      {workflows.length === 0 ? (
        <p className="text-sm text-muted">Create a project run before adding a scheduled trigger.</p>
      ) : (
        <>
          <section
            className={
              validation.isValid
                ? 'rounded-xl border border-emerald-300 bg-emerald-50/70 p-4'
                : 'rounded-xl border border-amber-300 bg-amber-50/80 p-4'
            }
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Save readiness</h4>
                <p className="text-sm text-muted">
                  {validation.isValid
                    ? 'This automation rule is ready to save.'
                    : 'Resolve the items below before saving this trigger.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-current/10 bg-background/70 px-3 py-1 text-xs font-medium">
                  {form.workflowId ? 'Run selected' : 'Choose a run'}
                </span>
                <span className="rounded-full border border-current/10 bg-background/70 px-3 py-1 text-xs font-medium">
                  {form.cadenceMinutes.trim() ? `Every ${form.cadenceMinutes.trim()} min` : 'Cadence missing'}
                </span>
              </div>
            </div>
            {!validation.isValid ? (
              <ul className="mt-3 space-y-1 text-sm text-amber-950">
                {validation.issues.map((issue) => (
                  <li key={issue}>• {issue}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <FormInput
              label="Name"
              value={form.name}
              placeholder="Daily triage"
              error={validation.fieldErrors.name}
              onChange={(value) => onChange({ name: value })}
            />
            <FormInput
              label="Source"
              value={form.source}
              placeholder={DEFAULT_SCHEDULED_TRIGGER_SOURCE}
              description="Defaults to the canonical project schedule source when left blank."
              onChange={(value) => onChange({ source: value })}
            />
            <SelectField
              label="Target run"
              value={form.workflowId}
              placeholder="Select run"
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
                })}
            />
            <FormInput
              label="Cadence (minutes)"
              type="number"
              value={form.cadenceMinutes}
              placeholder="60"
              description="Choose how often this project should create a new work item."
              error={validation.fieldErrors.cadenceMinutes}
              onChange={(value) => onChange({ cadenceMinutes: value })}
            />
            <FormInput
              label="Work item title"
              value={form.title}
              placeholder="Run daily inbox triage"
              error={validation.fieldErrors.title}
              onChange={(value) => onChange({ title: value })}
            />
            <FormInput
              label="First run (optional)"
              type="datetime-local"
              value={form.nextFireAt}
              onChange={(value) => onChange({ nextFireAt: value })}
            />
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
              placeholder={isLoadingWorkflowDetails ? 'Loading board columns' : 'Use board default'}
              options={columns.map((column) => ({ value: column.id, label: column.label }))}
              onChange={(value) => onChange({ columnId: value })}
              disabled={!form.workflowId || isLoadingWorkflowDetails}
            />
            <SelectField
              label="Owner role"
              value={form.ownerRole}
              placeholder={roles.length > 0 ? 'Use playbook default' : 'No roles available'}
              options={roles.map((role) => ({ value: role.name, label: role.name }))}
              onChange={(value) => onChange({ ownerRole: value })}
              disabled={roles.length === 0}
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
            <div className="md:col-span-2">
              <FormTextarea
                label="Notes"
                value={form.notes}
                placeholder="Optional operator notes for the generated work item."
                onChange={(value) => onChange({ notes: value })}
              />
            </div>
          </div>

          {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
          <div className="flex justify-end">
            <Button disabled={isPending || !validation.isValid} onClick={onSubmit}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isEditing ? 'Save schedule' : 'Add schedule'}
            </Button>
          </div>
        </>
      )}
    </div>
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
