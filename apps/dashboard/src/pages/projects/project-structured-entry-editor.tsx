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
}): JSX.Element {
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
            <div className="grid gap-3 md:grid-cols-[1.1fr,0.7fr,1.2fr,auto]">
              <label className="grid gap-1 text-xs">
                <span className="font-medium">Key</span>
                <Input
                  value={draft.key}
                  onChange={(event) =>
                    props.onChange(updateStructuredDraft(props.drafts, draft.id, { key: event.target.value }))
                  }
                />
              </label>
              <label className="grid gap-1 text-xs">
                <span className="font-medium">Type</span>
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
                  <SelectTrigger className="w-full">
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
                <StructuredValueInput
                  valueType={draft.valueType}
                  value={draft.value}
                  onChange={(value) =>
                    props.onChange(updateStructuredDraft(props.drafts, draft.id, { value }))
                  }
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => props.onChange(props.drafts.filter((entry) => entry.id !== draft.id))}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove entry
                </Button>
              </div>
            </div>
          </div>
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
    </div>
  );
}

function StructuredValueInput(props: {
  valueType: StructuredValueType;
  value: string;
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
  return (
    <Input
      type={props.valueType === 'number' ? 'number' : 'text'}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

function updateStructuredDraft(
  drafts: StructuredEntryDraft[],
  draftId: string,
  patch: Partial<StructuredEntryDraft>,
): StructuredEntryDraft[] {
  return drafts.map((draft) => (draft.id === draftId ? { ...draft, ...patch } : draft));
}
