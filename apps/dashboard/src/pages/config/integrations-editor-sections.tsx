import { Plus, Trash2 } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import type { IntegrationHeaderValidation } from './integrations-editor-validation.js';
import {
  ConfigField,
  ConfigInputField,
  ConfigSelectField,
} from './config-form-controls.js';
import type { IntegrationFormState, IntegrationHeaderDraft } from './integrations-page.support.js';

export function IntegrationSelectField(props: {
  label: string;
  value: string;
  disabled?: boolean;
  description?: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
  onValueChange(value: string): void;
}) {
  return (
    <ConfigSelectField
      fieldId={`integration-select-${props.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
      label={props.label}
      value={props.value}
      disabled={props.disabled}
      description={props.description}
      error={props.error}
      options={props.options}
      onValueChange={props.onValueChange}
    />
  );
}

export function IntegrationHeaderEditor(props: {
  headers: IntegrationHeaderDraft[];
  errorsByHeaderId?: Record<string, IntegrationHeaderValidation>;
  onAddHeader(): void;
  onUpdateHeader(id: string, patch: Partial<IntegrationHeaderDraft>): void;
  onRemoveHeader(id: string): void;
}) {
  return (
    <section className="space-y-3 rounded-md bg-border/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Headers</h3>
          <p className="text-sm text-muted">
            Add request headers as key/value pairs. Stored secret headers remain preserved until you replace them.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={props.onAddHeader}>
          <Plus className="h-4 w-4" />
          Add header
        </Button>
      </div>
      {props.headers.length === 0 ? <p className="text-sm text-muted">No custom headers configured.</p> : null}
      <div className="space-y-3">
        {props.headers.map((header) => {
          const rowErrors = props.errorsByHeaderId?.[header.id];
          return (
            <div key={header.id} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <ConfigInputField
                fieldId={`${header.id}-key`}
                label="Header name"
                error={rowErrors?.key}
                inputProps={{
                  value: header.key,
                  placeholder: 'Authorization',
                  onChange: (event) =>
                    props.onUpdateHeader(header.id, { key: event.target.value }),
                }}
              />
              <ConfigInputField
                fieldId={`${header.id}-value`}
                label="Header value"
                description={
                  header.hasStoredSecret
                    ? 'Leave blank to keep the stored secret value for this header.'
                    : undefined
                }
                error={rowErrors?.value}
                inputProps={{
                  value: header.value,
                  placeholder: header.hasStoredSecret
                    ? 'Stored secret preserved until replaced'
                    : 'Header value',
                  onChange: (event) =>
                    props.onUpdateHeader(header.id, {
                      value: event.target.value,
                      hasStoredSecret:
                        header.hasStoredSecret && event.target.value.trim().length === 0,
                    }),
                }}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => props.onRemoveHeader(header.id)}>
                <Trash2 className="h-4 w-4" />
                Remove
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function IntegrationLabelsEditor(props: {
  labels: string[];
  labelDraft: string;
  onLabelDraftChange(value: string): void;
  onAddLabel(): void;
  onRemoveLabel(label: string): void;
}) {
  return (
    <section className="space-y-3 rounded-md bg-border/10 p-4">
      <div>
        <h3 className="text-sm font-medium">Repository labels</h3>
        <p className="text-sm text-muted">
          Add default labels for created GitHub issues. Operators can remove or append labels individually.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {props.labels.map((label) => (
          <Badge key={label} variant="secondary" className="gap-2 px-3 py-1">
            {label}
            <button
              type="button"
              className="text-xs text-muted"
              aria-label={`Remove ${label} label`}
              onClick={() => props.onRemoveLabel(label)}
            >
              Remove
            </button>
          </Badge>
        ))}
        {props.labels.length === 0 ? <p className="text-sm text-muted">No default labels configured.</p> : null}
      </div>
      <ConfigField
        fieldId="integration-label-draft"
        label="Add label"
        description="Press Enter or use the action button to append another default label."
        action={
          <Button type="button" variant="outline" onClick={props.onAddLabel}>
            Add label
          </Button>
        }
      >
        {({ describedBy }) => (
          <Input
            id="integration-label-draft"
            value={props.labelDraft}
            placeholder="bug"
            aria-describedby={describedBy}
            onChange={(event) => props.onLabelDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                props.onAddLabel();
              }
            }}
          />
        )}
      </ConfigField>
    </section>
  );
}

export function renderIntegrationFieldHint(
  form: IntegrationFormState,
  key: string,
  isCreate: boolean,
) {
  if (form.kind === 'github_issues') {
    if (key === 'owner') {
      return (
        <p className="text-xs text-muted">
          GitHub owner or organization, for example <span className="font-mono">agirunner</span>.
        </p>
      );
    }
    if (key === 'repo') {
      return (
        <p className="text-xs text-muted">
          Repository name only, for example <span className="font-mono">agirunner</span>.
        </p>
      );
    }
    if (key === 'api_base_url') {
      return (
        <p className="text-xs text-muted">
          Leave the hosted GitHub API default unless you use GitHub Enterprise.
        </p>
      );
    }
  }
  if (isCreate) {
    return null;
  }
  if (key === 'secret' && form.configuredSecrets.secret) {
    return <p className="text-xs text-muted">A shared secret is already stored. Leave blank to keep it.</p>;
  }
  if (key === 'webhook_url' && form.configuredSecrets.webhook_url) {
    return <p className="text-xs text-muted">A webhook URL is already stored. Leave blank to keep it.</p>;
  }
  if (key === 'token' && form.configuredSecrets.token) {
    return <p className="text-xs text-muted">An access token is already stored. Leave blank to keep it.</p>;
  }
  return null;
}
