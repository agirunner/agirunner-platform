import { Plus, Trash2 } from 'lucide-react';

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
import { createStructuredEntryDraft, type StructuredEntryDraft } from '../workspaces/workspace-detail-support.js';
import {
  type StructuredEntryValidationResult,
} from './workflow-work-item-form-support.js';

export function WorkItemMetadataEditor(props: {
  title: string;
  description: string;
  drafts: StructuredEntryDraft[];
  validation: StructuredEntryValidationResult;
  addLabel: string;
  onChange(drafts: StructuredEntryDraft[]): void;
  lockedDraftIds?: string[];
  emptyMessage?: string;
}): JSX.Element {
  const lockedDraftIds = new Set(props.lockedDraftIds ?? []);

  return (
    <section className="space-y-3 rounded-md border border-dashed border-border p-3">
      <header className="space-y-1">
        <div className="text-sm font-medium">{props.title}</div>
        <p className="text-xs leading-5 text-muted">{props.description}</p>
      </header>
      {props.validation.blockingIssues.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50/80 px-3 py-2 text-sm text-amber-950">
          Resolve the highlighted metadata rows before saving.
        </div>
      ) : null}
      {props.drafts.length === 0 ? (
        <p className="text-sm text-muted">
          {props.emptyMessage ?? 'No metadata entries added yet.'}
        </p>
      ) : (
        props.drafts.map((draft, index) => (
          <MetadataEntryRow
            key={draft.id}
            draft={draft}
            index={index}
            validation={props.validation}
            isLocked={lockedDraftIds.has(draft.id)}
            onUpdate={(patch) =>
              props.onChange(updateStructuredDraft(props.drafts, draft.id, patch))
            }
            onRemove={() =>
              props.onChange(props.drafts.filter((entry) => entry.id !== draft.id))
            }
          />
        ))
      )}
      <Button
        type="button"
        variant="outline"
        onClick={() => props.onChange([...props.drafts, createStructuredEntryDraft()])}
      >
        <Plus className="h-4 w-4" />
        {props.addLabel}
      </Button>
    </section>
  );
}

function MetadataEntryRow(props: {
  draft: StructuredEntryDraft;
  index: number;
  validation: StructuredEntryValidationResult;
  isLocked: boolean;
  onUpdate(patch: Partial<StructuredEntryDraft>): void;
  onRemove(): void;
}): JSX.Element {
  const errors = props.validation.entryErrors[props.index];

  return (
    <article className="grid gap-3 rounded-md border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.1fr),minmax(0,0.7fr),minmax(0,1.2fr),auto]">
        <label className="grid gap-1 text-xs">
          <span className="font-medium">Key</span>
          <Input
            value={props.draft.key}
            aria-invalid={errors?.key ? true : undefined}
            className={
              errors?.key ? 'border-red-300 focus-visible:ring-red-500' : undefined
            }
            onChange={(event) => props.onUpdate({ key: event.target.value })}
          />
          {errors?.key ? (
            <span className="text-xs text-red-600">{errors.key}</span>
          ) : (
            <span className="text-xs text-muted">
              Use a stable key so work-item packets stay readable in the operator flow.
            </span>
          )}
        </label>
        <label className="grid gap-1 text-xs">
          <span className="font-medium">Type</span>
          <Select
            value={props.draft.valueType}
            onValueChange={(value) =>
              props.onUpdate({ valueType: value as StructuredEntryDraft['valueType'] })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="string">String</SelectItem>
              <SelectItem value="number">Number</SelectItem>
              <SelectItem value="boolean">Boolean</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <div className="grid gap-1 text-xs">
          <span className="font-medium">Value</span>
          <WorkItemMetadataValueInput
            valueType={props.draft.valueType}
            value={props.draft.value}
            hasError={Boolean(errors?.value)}
            onChange={(value) => props.onUpdate({ value })}
          />
          {errors?.value ? (
            <span className="text-xs text-red-600">{errors.value}</span>
          ) : (
            <span className="text-xs text-muted">
              Enter the typed value exactly as it should be stored on the work item.
            </span>
          )}
        </div>
        <div className="flex items-end sm:col-span-2 lg:col-span-1">
          {props.isLocked ? (
            <span className="text-xs text-muted">
              Existing key. Removal is not supported in this flow.
            </span>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full lg:w-auto"
              onClick={props.onRemove}
            >
              <Trash2 className="h-4 w-4" />
              Remove Entry
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

function WorkItemMetadataValueInput(props: {
  valueType: StructuredEntryDraft['valueType'];
  value: string;
  hasError: boolean;
  onChange(value: string): void;
}): JSX.Element {
  if (props.valueType === 'boolean') {
    return (
      <Select
        value={props.value || '__empty__'}
        onValueChange={(value) => props.onChange(value === '__empty__' ? '' : value)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Unset" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__empty__">Unset</SelectItem>
          <SelectItem value="true">True</SelectItem>
          <SelectItem value="false">False</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (props.valueType === 'json') {
    return (
      <Textarea
        value={props.value}
        aria-invalid={props.hasError ? true : undefined}
        className="min-h-[96px] font-mono text-xs"
        onChange={(event) => props.onChange(event.target.value)}
      />
    );
  }

  return (
    <Input
      type={props.valueType === 'number' ? 'number' : 'text'}
      value={props.value}
      aria-invalid={props.hasError ? true : undefined}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

function updateStructuredDraft(
  drafts: StructuredEntryDraft[],
  draftId: string,
  patch: Partial<StructuredEntryDraft>,
): StructuredEntryDraft[] {
  return drafts.map((draft) =>
    draft.id === draftId ? { ...draft, ...patch } : draft,
  );
}
