import { Loader2 } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import type { LlmModelRecord } from './role-definitions-page.support.js';
import { buildReasoningConfig } from './role-definitions-orchestrator.form.js';

export function DialogActions(props: {
  isSaving: boolean;
  saveLabel: string;
  onCancel: () => void;
  onSave: () => Promise<void>;
}): JSX.Element {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="outline" onClick={props.onCancel} disabled={props.isSaving}>
        Cancel
      </Button>
      <Button
        onClick={() => {
          void props.onSave();
        }}
        disabled={props.isSaving}
      >
        {props.isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {props.saveLabel}
      </Button>
    </div>
  );
}

export function ReasoningControl(props: {
  schema: NonNullable<LlmModelRecord['reasoning_config']>;
  value: string | number | null;
  onChange: (config: Record<string, unknown> | null) => void;
}): JSX.Element {
  if (props.schema.options) {
    const currentValue = String(props.value ?? '__default__');
    return (
      <Select
        value={currentValue}
        onValueChange={(nextValue) =>
          props.onChange(
            nextValue === '__default__'
              ? null
              : buildReasoningConfig(props.schema, nextValue),
          )
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__default__">Default ({String(props.schema.default)})</SelectItem>
          {props.schema.options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  const numericValue =
    typeof props.value === 'number' ? String(props.value) : String(props.schema.default);
  const min = props.schema.min ?? 0;
  const max = props.schema.max ?? 128000;
  return (
    <Input
      type="number"
      min={min}
      max={max}
      value={numericValue}
      onChange={(event) =>
        props.onChange(
          buildReasoningConfig(
            props.schema,
            Math.max(min, Math.min(max, parseInt(event.target.value || '0', 10) || min)),
          ),
        )
      }
    />
  );
}
