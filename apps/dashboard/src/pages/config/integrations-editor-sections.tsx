import { Plus, Trash2 } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import type { IntegrationHeaderValidation } from './integrations-editor-validation.js';
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
    <label className="space-y-1">
      <span className="text-xs font-medium">{props.label}</span>
      <Select value={props.value} disabled={props.disabled} onValueChange={props.onValueChange}>
        <SelectTrigger className={props.error ? 'border-red-300 focus:ring-red-500' : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {props.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {props.description ? <p className="text-xs text-muted">{props.description}</p> : null}
      {props.error ? <p className="text-xs text-red-600">{props.error}</p> : null}
    </label>
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
              <div className="space-y-1">
                <Input
                  value={header.key}
                  placeholder="Authorization"
                  className={rowErrors?.key ? 'border-red-300 focus-visible:ring-red-500' : undefined}
                  aria-invalid={rowErrors?.key ? true : undefined}
                  onChange={(event) => props.onUpdateHeader(header.id, { key: event.target.value })}
                />
                {rowErrors?.key ? <p className="text-xs text-red-600">{rowErrors.key}</p> : null}
              </div>
              <div className="space-y-1">
                <Input
                  value={header.value}
                  placeholder={header.hasStoredSecret ? 'Stored secret preserved until replaced' : 'Header value'}
                  className={rowErrors?.value ? 'border-red-300 focus-visible:ring-red-500' : undefined}
                  aria-invalid={rowErrors?.value ? true : undefined}
                  onChange={(event) =>
                    props.onUpdateHeader(header.id, {
                      value: event.target.value,
                      hasStoredSecret: header.hasStoredSecret && event.target.value.trim().length === 0,
                    })}
                />
                {header.hasStoredSecret ? (
                  <p className="text-xs text-muted">Leave blank to keep the stored secret value for this header.</p>
                ) : null}
                {rowErrors?.value ? <p className="text-xs text-red-600">{rowErrors.value}</p> : null}
              </div>
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
            <button type="button" className="text-xs text-muted" onClick={() => props.onRemoveLabel(label)}>
              Remove
            </button>
          </Badge>
        ))}
        {props.labels.length === 0 ? <p className="text-sm text-muted">No default labels configured.</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          value={props.labelDraft}
          placeholder="bug"
          onChange={(event) => props.onLabelDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              props.onAddLabel();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={props.onAddLabel}>
          Add label
        </Button>
      </div>
    </section>
  );
}

export function renderIntegrationFieldHint(
  form: IntegrationFormState,
  key: string,
  isCreate: boolean,
) {
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
