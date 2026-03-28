import { useState } from 'react';
import { Save, X } from 'lucide-react';

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
import { Textarea } from '../../components/ui/textarea.js';
import {
  inferMemoryEditorKind,
  isStructuredMemoryValue,
  parseMemoryEditorDraft,
  summarizeMemoryValue,
  type MemoryEditorDraft,
  type MemoryEditorKind,
} from './workspace-memory-table-support.js';

export function MemoryEditor(props: {
  draft: MemoryEditorDraft | null;
  valueTypeLabel: string;
  typeOptions: JSX.Element[];
  saveLabel: string;
  onChange(next: MemoryEditorDraft): void;
  onSave(): void;
  onCancel(): void;
  isSaving: boolean;
}): JSX.Element {
  const [hasAttemptedSave, setHasAttemptedSave] = useState(false);
  const validation = props.draft ? parseMemoryEditorDraft(props.draft) : null;
  const shouldShowValidationError = hasAttemptedSave && Boolean(validation?.error);
  return (
    <div className="space-y-3 rounded-xl bg-border/10 p-4">
      <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
        <label className="grid gap-2">
          <span className="text-sm font-medium">{props.valueTypeLabel}</span>
          <Select
            value={props.draft?.kind ?? 'string'}
            onValueChange={(value) =>
              props.onChange(buildMemoryDraftForKind(props.draft, value as MemoryEditorKind))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{props.typeOptions}</SelectContent>
          </Select>
        </label>
        <MemoryEditorField
          draft={props.draft}
          hasError={shouldShowValidationError}
          onChange={props.onChange}
        />
      </div>
      {shouldShowValidationError ? (
        <p className="text-sm text-red-600">{validation?.error}</p>
      ) : (
        <p className="text-sm text-muted">
          Edit memory inline with a typed control. Known value types should stay structured.
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={props.onCancel}>
          <X className="mr-1 h-4 w-4" />
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => {
            if (validation?.error) {
              setHasAttemptedSave(true);
              return;
            }
            props.onSave();
          }}
          disabled={props.isSaving}
        >
          <Save className="mr-1 h-4 w-4" />
          {props.saveLabel}
        </Button>
      </div>
    </div>
  );
}

export function MemoryValuePreview(props: {
  value: unknown;
  structuredDetailsLabel?: string;
  StructuredRenderer?: (props: {
    data: Record<string, unknown>;
    emptyMessage: string;
  }) => JSX.Element;
}): JSX.Element {
  const kind = inferMemoryEditorKind(props.value);
  if (!isStructuredMemoryValue(props.value)) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{kind}</Badge>
        <span className="text-sm text-muted">{summarizeMemoryValue(props.value)}</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{kind}</Badge>
        <span className="text-sm text-muted">{summarizeMemoryValue(props.value)}</span>
      </div>
      {isStructuredMemoryValue(props.value) ? (
        <details className="rounded-lg bg-border/10 p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {props.structuredDetailsLabel ?? 'Expand structured value'}
          </summary>
          <div className="mt-3">
            {Array.isArray(props.value) ? (
              <pre className="overflow-x-auto rounded-md bg-surface p-3 text-xs">
                {JSON.stringify(props.value, null, 2)}
              </pre>
            ) : (
              renderStructuredValue(props.StructuredRenderer, props.value)
            )}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function MemoryEditorField(props: {
  draft: MemoryEditorDraft | null;
  showLabel?: boolean;
  hasError?: boolean;
  onChange(next: MemoryEditorDraft): void;
}): JSX.Element {
  const label = props.showLabel === false ? null : <span className="text-sm font-medium">Value</span>;
  const draft = props.draft;
  if (!draft) {
    return <div className="text-sm text-muted">No memory value selected.</div>;
  }
  if (draft.kind === 'boolean') {
    return (
      <label className="grid gap-2">
        {label}
        <Select
          value={draft.booleanValue}
          onValueChange={(value) =>
            props.onChange({ kind: 'boolean', textValue: draft.textValue, booleanValue: value as 'true' | 'false' })
          }
        >
          <SelectTrigger aria-invalid={props.hasError ? true : undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">True</SelectItem>
            <SelectItem value="false">False</SelectItem>
          </SelectContent>
        </Select>
      </label>
    );
  }
  if (draft.kind === 'number') {
    return (
      <label className="grid gap-2">
        {label}
        <Input
          value={draft.textValue}
          onChange={(event) =>
            props.onChange({ kind: 'number', textValue: event.target.value, booleanValue: draft.booleanValue })
          }
          placeholder="Enter a numeric value"
          aria-invalid={props.hasError ? true : undefined}
        />
      </label>
    );
  }
  return (
    <label className="grid gap-2">
      {label}
      <Textarea
        value={draft.textValue}
        rows={draft.kind === 'json' ? 8 : 4}
        onChange={(event) =>
          props.onChange({
            kind: draft.kind === 'json' ? 'json' : 'string',
            textValue: event.target.value,
            booleanValue: draft.booleanValue,
          })
        }
        placeholder={draft.kind === 'json' ? 'Enter valid JSON' : 'Enter the memory value'}
        aria-invalid={props.hasError ? true : undefined}
      />
    </label>
  );
}

export function buildMemoryDraftForKind(
  currentDraft: MemoryEditorDraft | null,
  nextKind: MemoryEditorKind,
): MemoryEditorDraft {
  if (nextKind === 'boolean') {
    return {
      kind: 'boolean',
      textValue: currentDraft?.textValue ?? '',
      booleanValue: currentDraft?.booleanValue ?? 'false',
    };
  }
  return {
    kind: nextKind,
    textValue:
      nextKind === 'string' && currentDraft?.kind !== 'string'
        ? ''
        : currentDraft?.textValue ?? '',
    booleanValue: currentDraft?.booleanValue ?? 'false',
  };
}

function renderStructuredValue(
  StructuredRenderer:
    | ((props: { data: Record<string, unknown>; emptyMessage: string }) => JSX.Element)
    | undefined,
  value: unknown,
): JSX.Element {
  if (StructuredRenderer) {
    return StructuredRenderer({
      data: value as Record<string, unknown>,
      emptyMessage: 'No structured memory payload.',
    });
  }
  return (
    <pre className="overflow-x-auto rounded-md bg-surface p-3 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
