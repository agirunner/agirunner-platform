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
import {
  createStructuredEntryDraft,
  type StructuredEntryDraft,
  type StructuredValueType,
} from './project-detail-support.js';

export function StructuredEntryEditor(props: {
  title: string;
  description?: string;
  drafts: StructuredEntryDraft[];
  onChange(drafts: StructuredEntryDraft[]): void;
  addLabel: string;
  allowedTypes?: StructuredValueType[];
  stringInputMode?: 'single-line' | 'multiline';
}): JSX.Element {
  const allowedTypes = props.allowedTypes ?? ['string', 'number', 'boolean', 'json'];
  const showTypeSelector = allowedTypes.length > 1;

  return (
    <div className="space-y-3 rounded-md border border-dashed border-border p-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">{props.title}</div>
        {props.description ? <p className="text-xs text-muted">{props.description}</p> : null}
      </div>
      {props.drafts.length === 0 ? (
        <p className="text-sm text-muted">No entries added yet.</p>
      ) : (
        props.drafts.map((draft) => (
          <div key={draft.id} className="grid gap-3 rounded-md border border-border p-3">
            <div
              className={
                showTypeSelector
                  ? 'grid gap-3 sm:flex sm:flex-nowrap sm:items-center'
                  : 'grid gap-3 sm:flex sm:flex-nowrap sm:items-center'
              }
            >
              <span className="text-xs font-medium text-muted sm:w-8 sm:shrink-0">Key</span>
              <Input
                className="sm:min-w-0 sm:flex-1"
                value={draft.key}
                onChange={(event) =>
                  props.onChange(updateStructuredDraft(props.drafts, draft.id, { key: event.target.value }))
                }
              />
              {showTypeSelector ? (
                <>
                  <span className="text-xs font-medium text-muted sm:w-9 sm:shrink-0">Type</span>
                  <Select
                    value={draft.valueType}
                    onValueChange={(value) =>
                      props.onChange(
                        updateStructuredDraft(props.drafts, draft.id, {
                          valueType: value as StructuredValueType,
                        }),
                      )
                    }
                  >
                    <SelectTrigger className="w-full sm:w-40 sm:shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {allowedTypes.map((type) => (
                        <SelectItem key={type} value={type}>
                          {formatStructuredTypeLabel(type)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full whitespace-nowrap sm:ml-auto sm:w-auto sm:self-center"
                onClick={() => props.onChange(props.drafts.filter((entry) => entry.id !== draft.id))}
              >
                <Trash2 className="h-4 w-4" />
                Remove entry
              </Button>
            </div>
            <div className="grid gap-3 sm:flex sm:items-start">
              <span className="pt-2 text-xs font-medium text-muted sm:w-10 sm:shrink-0">Value</span>
              <div className="sm:min-w-0 sm:flex-1">
                <StructuredValueInput
                  valueType={draft.valueType}
                  value={draft.value}
                  stringInputMode={props.stringInputMode ?? 'single-line'}
                  onChange={(value) =>
                    props.onChange(updateStructuredDraft(props.drafts, draft.id, { value }))
                  }
                />
              </div>
            </div>
          </div>
        ))
      )}
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          props.onChange([
            ...props.drafts,
            createStructuredEntryDraft(allowedTypes[0] ?? 'string'),
          ])
        }
      >
        <Plus className="h-4 w-4" />
        {props.addLabel}
      </Button>
    </div>
  );
}

function StructuredValueInput(props: {
  valueType: StructuredValueType;
  value: string;
  stringInputMode: 'single-line' | 'multiline';
  onChange(value: string): void;
}): JSX.Element {
  if (props.valueType === 'boolean') {
    return (
      <Select value={props.value} onValueChange={props.onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select boolean value" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">Unset</SelectItem>
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
        className="min-h-[100px] font-mono text-xs"
        onChange={(event) => props.onChange(event.target.value)}
      />
    );
  }
  if (props.stringInputMode === 'multiline') {
    return (
      <Textarea
        value={props.value}
        className="min-h-[100px]"
        onChange={(event) => props.onChange(event.target.value)}
      />
    );
  }
  return (
    <Input
      type={props.valueType === 'number' ? 'number' : 'text'}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

function formatStructuredTypeLabel(value: StructuredValueType): string {
  switch (value) {
    case 'json':
      return 'JSON';
    case 'number':
      return 'Number';
    case 'boolean':
      return 'Boolean';
    default:
      return 'String';
  }
}

function updateStructuredDraft(
  drafts: StructuredEntryDraft[],
  draftId: string,
  patch: Partial<StructuredEntryDraft>,
): StructuredEntryDraft[] {
  return drafts.map((draft) => (draft.id === draftId ? { ...draft, ...patch } : draft));
}
