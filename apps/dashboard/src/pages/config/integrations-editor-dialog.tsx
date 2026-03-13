import { useEffect, useState } from 'react';
import { Loader2, Plus, Save } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { ToggleCard } from '../../components/ui/toggle-card.js';
import { dashboardApi, type DashboardIntegrationRecord } from '../../lib/api.js';
import {
  INTEGRATION_EVENT_OPTIONS,
  KIND_LABELS,
  buildCreateIntegrationPayload,
  buildUpdateIntegrationPayload,
  createHeaderDraft,
  createIntegrationFormState,
  fieldsForIntegrationKind,
  hydrateIntegrationForm,
  supportsHeaderEditor,
  supportsLabelEditor,
  type IntegrationFormState,
  type IntegrationHeaderDraft,
} from './integrations-page.support.js';
import { validateIntegrationForm } from './integrations-editor-validation.js';
import { ConfigInputField } from './config-form-controls.js';
import {
  IntegrationHeaderEditor,
  IntegrationLabelsEditor,
  IntegrationSelectField,
  renderIntegrationFieldHint,
} from './integrations-editor-sections.js';

export function IntegrationEditorDialog({
  mode,
  integration,
  open,
  workflows,
  isPending,
  errorMessage,
  onOpenChange,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  integration?: DashboardIntegrationRecord | null;
  open: boolean;
  workflows: Awaited<ReturnType<typeof dashboardApi.listWorkflows>>['data'];
  isPending: boolean;
  errorMessage?: string | null;
  onOpenChange(open: boolean): void;
  onSubmit(payload: ReturnType<typeof buildCreateIntegrationPayload> | ReturnType<typeof buildUpdateIntegrationPayload>): void;
}) {
  const [form, setForm] = useState<IntegrationFormState>(createIntegrationFormState());
  const [labelDraft, setLabelDraft] = useState('');

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm(integration ? hydrateIntegrationForm(integration) : createIntegrationFormState());
    setLabelDraft('');
  }, [integration, open]);

  const fields = fieldsForIntegrationKind(form.kind);
  const isCreate = mode === 'create';
  const validation = validateIntegrationForm(form, mode);

  function updateConfig(key: string, value: string): void {
    setForm((current) => ({
      ...current,
      config: { ...current.config, [key]: value },
    }));
  }

  function updateHeader(id: string, patch: Partial<IntegrationHeaderDraft>): void {
    setForm((current) => ({
      ...current,
      headers: current.headers.map((header) => (header.id === id ? { ...header, ...patch } : header)),
    }));
  }

  function addHeader(): void {
    setForm((current) => ({
      ...current,
      headers: [...current.headers, createHeaderDraft()],
    }));
  }

  function removeHeader(id: string): void {
    setForm((current) => ({
      ...current,
      headers: current.headers.filter((header) => header.id !== id),
    }));
  }

  function toggleSubscription(eventType: string): void {
    setForm((current) => ({
      ...current,
      subscriptions: current.subscriptions.includes(eventType)
        ? current.subscriptions.filter((value) => value !== eventType)
        : [...current.subscriptions, eventType],
    }));
  }

  function addLabel(): void {
    const normalized = labelDraft.trim();
    if (!normalized || form.labels.includes(normalized)) {
      return;
    }
    setForm((current) => ({ ...current, labels: [...current.labels, normalized] }));
    setLabelDraft('');
  }

  function removeLabel(label: string): void {
    setForm((current) => ({
      ...current,
      labels: current.labels.filter((item) => item !== label),
    }));
  }

  function handleKindChange(nextKind: IntegrationFormState['kind']): void {
    setForm((current) => ({
      ...createIntegrationFormState(nextKind),
      workflowId: current.workflowId,
      subscriptions: current.subscriptions,
    }));
    setLabelDraft('');
  }

  function submit(): void {
    onSubmit(isCreate ? buildCreateIntegrationPayload(form) : buildUpdateIntegrationPayload(form));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isCreate ? 'Add integration' : 'Edit integration'}</DialogTitle>
          <DialogDescription>
            Configure event delivery, workflow scope, and provider-specific settings with structured controls.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <IntegrationSelectField
              label="Integration kind"
              description={isCreate ? 'Choose the supported delivery type. The kind stays fixed after creation.' : 'Integration kind is fixed after creation.'}
              value={form.kind}
              disabled={!isCreate}
              onValueChange={(value) => handleKindChange(value as IntegrationFormState['kind'])}
              options={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))}
            />
            <IntegrationSelectField
              label="Workflow scope"
              description="Global integrations receive subscribed events from every workflow. Pick a workflow to limit delivery."
              value={form.workflowId || '__global__'}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  workflowId: value === '__global__' ? '' : value,
                }))}
              options={[
                { value: '__global__', label: 'Global integration' },
                ...workflows.map((workflow) => ({ value: workflow.id, label: workflow.name })),
              ]}
            />
          </div>

          <section
            className={
              validation.isValid
                ? 'rounded-xl border border-emerald-300 bg-emerald-50/70 p-4'
                : 'rounded-xl border border-amber-300 bg-amber-50/80 p-4'
            }
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">Save readiness</h3>
                <p className="text-sm text-muted">
                  {validation.isValid
                    ? 'This integration is ready to save with the current delivery settings.'
                    : 'Resolve the items below before saving this integration.'}
                </p>
              </div>
              <span className="rounded-full border border-current/10 bg-background/70 px-3 py-1 text-xs font-medium">
                {validation.isValid
                  ? 'Ready to save'
                  : `${validation.issues.length} item${validation.issues.length === 1 ? '' : 's'} to fix`}
              </span>
            </div>
            {!validation.isValid ? (
              <ul className="mt-3 space-y-1 text-sm text-amber-950">
                {validation.issues.map((issue) => (
                  <li key={issue}>• {issue}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">Subscribed events</h3>
              <p className="text-sm text-muted">
                Select the events this integration should receive. Leave everything unselected to
                follow the default delivery policy for this destination.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {INTEGRATION_EVENT_OPTIONS.map((eventOption) => {
                const selected = form.subscriptions.includes(eventOption.value);
                return (
                  <ToggleCard
                    key={eventOption.value}
                    label={eventOption.value}
                    description={eventOption.description}
                    checked={selected}
                    onCheckedChange={() => toggleSubscription(eventOption.value)}
                  />
                );
              })}
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">Delivery settings</h3>
              <p className="text-sm text-muted">
                Fill the supported settings for this integration kind. Secret values can be left blank during edits to keep the current stored value.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {fields.map((field) => {
                const fieldError = validation.fieldErrors[field.key];
                return (
                  <ConfigInputField
                    key={field.key}
                    fieldId={`integration-${field.key}`}
                    label={field.label}
                    description={renderIntegrationFieldHint(form, field.key, isCreate)}
                    error={fieldError}
                    inputProps={{
                      type: field.type,
                      value: form.config[field.key] ?? '',
                      placeholder: field.placeholder,
                      onChange: (event) => updateConfig(field.key, event.target.value),
                    }}
                  />
                );
              })}
            </div>
          </section>

          {supportsHeaderEditor(form.kind) ? (
            <IntegrationHeaderEditor
              headers={form.headers}
              errorsByHeaderId={validation.headerErrors}
              onAddHeader={addHeader}
              onUpdateHeader={updateHeader}
              onRemoveHeader={removeHeader}
            />
          ) : null}

          {supportsLabelEditor(form.kind) ? (
            <IntegrationLabelsEditor
              labels={form.labels}
              labelDraft={labelDraft}
              onLabelDraftChange={setLabelDraft}
              onAddLabel={addLabel}
              onRemoveLabel={removeLabel}
            />
          ) : null}

          {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={isPending || !validation.isValid} onClick={submit}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : isCreate ? <Plus className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {isCreate ? 'Create integration' : 'Save integration'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
