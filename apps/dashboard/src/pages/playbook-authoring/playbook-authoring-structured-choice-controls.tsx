import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';

const CUSTOM_VALUE = '__custom__';
export const STRUCTURED_CONTROL_UNSET_VALUE = '__unset__';

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
  const [isCustomMode, setIsCustomMode] = useState<boolean>(() =>
    resolveSelectWithCustomMode({
      currentValue: props.value,
      optionValues: props.options.map((option) => option.value),
    }),
  );

  useEffect(() => {
    if (props.value.trim().length === 0) {
      return;
    }
    setIsCustomMode(
      resolveSelectWithCustomMode({
        currentValue: props.value,
        optionValues: props.options.map((option) => option.value),
      }),
    );
  }, [props.options, props.value]);

  const selectValue = resolveSelectWithCustomValue({
    currentValue: props.value,
    isKnownValue,
    isCustomMode,
  });

  return (
    <div className="grid gap-2">
      <Select
        value={selectValue}
        onValueChange={(value) => {
          const nextSelection = resolveSelectWithCustomSelection({
            currentValue: props.value,
            optionValues: props.options.map((option) => option.value),
            nextSelection: value,
          });
          setIsCustomMode(nextSelection.isCustomMode);
          props.onChange(nextSelection.nextValue);
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder={props.placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={STRUCTURED_CONTROL_UNSET_VALUE}>
            {props.unsetLabel ?? 'Unset'}
          </SelectItem>
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

export function resolveSelectWithCustomMode(input: {
  currentValue: string;
  optionValues: string[];
}): boolean {
  return input.currentValue.trim().length > 0 && !input.optionValues.includes(input.currentValue);
}

export function resolveSelectWithCustomValue(input: {
  currentValue: string;
  isKnownValue: boolean;
  isCustomMode: boolean;
}): string {
  if (input.isCustomMode) {
    return CUSTOM_VALUE;
  }
  if (input.currentValue.trim().length === 0) {
    return STRUCTURED_CONTROL_UNSET_VALUE;
  }
  return input.isKnownValue ? input.currentValue : CUSTOM_VALUE;
}

export function resolveSelectWithCustomSelection(input: {
  currentValue: string;
  optionValues: string[];
  nextSelection: string;
}): {
  nextValue: string;
  isCustomMode: boolean;
} {
  const isKnownValue = input.optionValues.includes(input.currentValue);
  if (input.nextSelection === STRUCTURED_CONTROL_UNSET_VALUE) {
    return { nextValue: '', isCustomMode: false };
  }
  if (input.nextSelection === CUSTOM_VALUE) {
    return {
      nextValue: isKnownValue ? '' : input.currentValue,
      isCustomMode: true,
    };
  }
  return { nextValue: input.nextSelection, isCustomMode: false };
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

function parseCommaSeparatedValues(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
