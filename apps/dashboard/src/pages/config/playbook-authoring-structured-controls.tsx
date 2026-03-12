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

const CUSTOM_VALUE = '__custom__';
const UNSET_VALUE = '__unset__';

export interface StructuredChoiceOption {
  value: string;
  label: string;
  description?: string;
}

export function SelectWithCustomControl(props: {
  value: string;
  options: StructuredChoiceOption[];
  placeholder: string;
  unsetLabel?: string;
  customPlaceholder?: string;
  onChange(value: string): void;
}): JSX.Element {
  const isKnownValue = props.options.some((option) => option.value === props.value);
  const selectedOption = props.options.find((option) => option.value === props.value) ?? null;
  const selectValue =
    props.value.trim().length === 0 ? UNSET_VALUE : isKnownValue ? props.value : CUSTOM_VALUE;

  return (
    <div className="grid gap-2">
      <Select
        value={selectValue}
        onValueChange={(value) => {
          if (value === UNSET_VALUE) {
            props.onChange('');
            return;
          }
          if (value === CUSTOM_VALUE) {
            props.onChange(isKnownValue ? '' : props.value);
            return;
          }
          props.onChange(value);
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder={props.placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET_VALUE}>{props.unsetLabel ?? 'Unset'}</SelectItem>
          {props.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_VALUE}>Custom value</SelectItem>
        </SelectContent>
      </Select>

      {selectValue === CUSTOM_VALUE ? (
        <Input
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={props.customPlaceholder ?? 'Enter a custom value'}
        />
      ) : null}

      {selectedOption?.description ? (
        <p className="text-xs text-muted">{selectedOption.description}</p>
      ) : null}
    </div>
  );
}

export function MultiChoiceButtonsControl(props: {
  options: StructuredChoiceOption[];
  value: string;
  emptyMessage?: string;
  customPlaceholder?: string;
  onChange(value: string): void;
}): JSX.Element {
  const availableValues = new Set(props.options.map((option) => option.value));
  const selectedValues = parseCommaSeparatedValues(props.value);
  const selectedKnownValues = props.options
    .map((option) => option.value)
    .filter((value) => selectedValues.includes(value));
  const selectedCustomValues = selectedValues.filter((value) => !availableValues.has(value));

  function commit(nextKnownValues: string[], customValue: string): void {
    props.onChange([...nextKnownValues, ...parseCommaSeparatedValues(customValue)].join(', '));
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {props.options.map((option) => {
          const selected = selectedKnownValues.includes(option.value);
          return (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={selected ? 'secondary' : 'outline'}
              onClick={() =>
                commit(
                  selected
                    ? selectedKnownValues.filter((value) => value !== option.value)
                    : [...selectedKnownValues, option.value],
                  selectedCustomValues.join(', '),
                )
              }
            >
              {option.label}
            </Button>
          );
        })}
      </div>

      {props.options.length === 0 && props.emptyMessage ? (
        <p className="text-xs text-muted">{props.emptyMessage}</p>
      ) : null}

      <Input
        value={selectedCustomValues.join(', ')}
        onChange={(event) => commit(selectedKnownValues, event.target.value)}
        placeholder={props.customPlaceholder ?? 'Additional values, comma separated'}
      />
    </div>
  );
}

export function TypedParameterValueControl(props: {
  valueType: string;
  value: string;
  onChange(value: string): void;
}): JSX.Element {
  if (props.valueType === 'boolean') {
    return (
      <Select
        value={props.value || UNSET_VALUE}
        onValueChange={(value) => props.onChange(value === UNSET_VALUE ? '' : value)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Unset" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET_VALUE}>Unset</SelectItem>
          <SelectItem value="true">True</SelectItem>
          <SelectItem value="false">False</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (props.valueType === 'object' || props.valueType === 'array') {
    return (
      <Textarea
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="min-h-[104px] font-mono text-xs"
        placeholder={props.valueType === 'array' ? '[\n  "value"\n]' : '{\n  "key": "value"\n}'}
      />
    );
  }

  return (
    <Input
      type={props.valueType === 'number' ? 'number' : 'text'}
      inputMode={props.valueType === 'number' ? 'numeric' : undefined}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

function parseCommaSeparatedValues(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
