import { Plus, Trash2 } from 'lucide-react';

import type {
  LaunchParameterSpec,
  StructuredEntryDraft,
  StructuredValueType,
} from '../../pages/playbook-launch/playbook-launch-support.js';
import { createStructuredEntryDraft } from '../../pages/playbook-launch/playbook-launch-support.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';
import { Textarea } from '../ui/textarea.js';

export function ChainParameterField(props: {
  spec: LaunchParameterSpec;
  value: string;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <div className="grid gap-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{props.spec.label}</span>
        <div className="flex gap-2">
          {props.spec.options.length > 0 ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
              {props.spec.options.length} options
            </span>
          ) : null}
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {props.spec.key}
          </span>
        </div>
      </div>
      {props.spec.description ? <p className="text-xs text-muted">{props.spec.description}</p> : null}
      <ChainValueInput
        valueType={props.spec.inputType === 'select' ? 'string' : props.spec.inputType}
        value={props.value}
        options={props.spec.options}
        onChange={props.onChange}
      />
    </div>
  );
}

export function ChainStructuredEntryEditor(props: {
  drafts: StructuredEntryDraft[];
  onChange(drafts: StructuredEntryDraft[]): void;
  addLabel: string;
}): JSX.Element {
  return (
    <div className="space-y-3 rounded-md border border-dashed border-border p-3">
      {props.drafts.length === 0 ? (
        <p className="text-sm text-muted">No additional parameter overrides yet.</p>
      ) : (
        props.drafts.map((draft) => (
          <div key={draft.id} className="grid gap-3 rounded-md border border-border p-3">
            <div className="grid gap-3 md:grid-cols-[1.1fr,0.7fr,1.2fr,auto]">
              <label className="grid gap-1 text-xs">
                <span className="font-medium">Key</span>
                <Input
                  value={draft.key}
                  onChange={(event) => props.onChange(updateStructuredDraft(props.drafts, draft.id, { key: event.target.value }))}
                />
              </label>
              <label className="grid gap-1 text-xs">
                <span className="font-medium">Type</span>
                <Select
                  value={draft.valueType}
                  onValueChange={(value) =>
                    props.onChange(updateStructuredDraft(props.drafts, draft.id, { valueType: value as StructuredValueType }))
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
                <ChainValueInput
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
                  size="icon"
                  onClick={() =>
                    props.onChange(props.drafts.filter((entry) => entry.id !== draft.id))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))
      )}
      <Button type="button" variant="outline" onClick={() => props.onChange([...props.drafts, createStructuredEntryDraft()])}>
        <Plus className="h-4 w-4" />
        {props.addLabel}
      </Button>
    </div>
  );
}

function ChainValueInput(props: {
  valueType: StructuredValueType;
  value: string;
  options?: string[];
  onChange(value: string): void;
}): JSX.Element {
  if (props.options && props.options.length > 0) {
    return (
      <Select value={props.value || '__empty__'} onValueChange={(value) => props.onChange(value === '__empty__' ? '' : value)}>
        <SelectTrigger><SelectValue placeholder="Select a value" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__empty__">Unset</SelectItem>
          {props.options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (props.valueType === 'boolean') {
    return (
      <Select value={props.value || '__empty__'} onValueChange={(value) => props.onChange(value === '__empty__' ? '' : value)}>
        <SelectTrigger><SelectValue placeholder="Unset" /></SelectTrigger>
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
        className="min-h-[96px] font-mono text-xs"
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
  id: string,
  patch: Partial<StructuredEntryDraft>,
): StructuredEntryDraft[] {
  return drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft));
}
