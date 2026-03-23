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
import type { StructuredEntryValidationResult } from './playbook-launch-entry-validation.js';
import {
  createStructuredEntryDraft,
  type StructuredEntryDraft,
  type StructuredValueType,
} from './playbook-launch-support.js';
import { ValueInput } from './playbook-launch-parameters.js';

export function StructuredEntryEditor(props: {
  title: string;
  description?: string;
  drafts: StructuredEntryDraft[];
  validation: StructuredEntryValidationResult;
  onChange(drafts: StructuredEntryDraft[]): void;
  addLabel: string;
}): JSX.Element {
  return (
    <section className="space-y-3 rounded-md border border-dashed border-border p-3">
      <header className="space-y-1">
        <div className="text-sm font-medium">{props.title}</div>
        {props.description ? <p className="text-xs text-muted">{props.description}</p> : null}
      </header>
      {props.validation.blockingIssues.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50/80 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          Resolve the highlighted entry rows before launch.
        </div>
      ) : null}
      {props.drafts.length === 0 ? (
        <p className="text-sm text-muted">No entries added yet.</p>
      ) : (
        props.drafts.map((draft, index) => (
          <StructuredEntryRow
            key={draft.id}
            draft={draft}
            index={index}
            validation={props.validation}
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

function StructuredEntryRow(props: {
  draft: StructuredEntryDraft;
  index: number;
  validation: StructuredEntryValidationResult;
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
            <span className="text-xs text-red-600 dark:text-red-400">{errors.key}</span>
          ) : (
            <span className="text-xs text-muted">
              Use a stable key so launch metadata and override packets stay readable.
            </span>
          )}
        </label>
        <label className="grid gap-1 text-xs">
          <span className="font-medium">Type</span>
          <Select
            value={props.draft.valueType}
            onValueChange={(value) =>
              props.onUpdate({ valueType: value as StructuredValueType })
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
          <ValueInput
            valueType={props.draft.valueType}
            value={props.draft.value}
            hasError={Boolean(errors?.value)}
            onChange={(value) => props.onUpdate({ value })}
          />
          {errors?.value ? (
            <span className="text-xs text-red-600 dark:text-red-400">{errors.value}</span>
          ) : (
            <span className="text-xs text-muted">
              Pick the value type first, then enter only the value that should be sent at launch.
            </span>
          )}
        </div>
        <div className="flex items-end sm:col-span-2 lg:col-span-1">
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
        </div>
      </div>
    </article>
  );
}

function updateStructuredDraft(
  drafts: StructuredEntryDraft[],
  draftId: string,
  patch: Partial<StructuredEntryDraft>,
): StructuredEntryDraft[] {
  return drafts.map((draft) => (draft.id === draftId ? { ...draft, ...patch } : draft));
}
