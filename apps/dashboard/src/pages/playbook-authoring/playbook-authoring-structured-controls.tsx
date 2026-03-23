import { useEffect, useMemo, useState } from 'react';

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
  createStructuredParameterEntry,
  readStructuredParameterEditorState,
  serializeStructuredParameterEntries,
  validateStructuredParameterEntries,
  type StructuredParameterEditorState,
  type StructuredParameterEntry,
  type StructuredParameterValueType,
} from './playbook-authoring-structured-controls.support.js';

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
    return UNSET_VALUE;
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
  if (input.nextSelection === UNSET_VALUE) {
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

export function TypedParameterValueControl(props: {
  valueType: string;
  value: string;
  onValidationChange?(issue?: string): void;
  onChange(value: string): void;
}): JSX.Element {
  useEffect(() => {
    if (props.valueType !== 'object' && props.valueType !== 'array') {
      props.onValidationChange?.(undefined);
    }
  }, [props.onValidationChange, props.valueType]);

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
      <StructuredParameterDefaultEditor
        valueType={props.valueType}
        value={props.value}
        onChange={props.onChange}
        onValidationChange={props.onValidationChange}
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

function StructuredParameterDefaultEditor(props: {
  valueType: 'object' | 'array';
  value: string;
  onChange(value: string): void;
  onValidationChange?(issue?: string): void;
}): JSX.Element {
  const [editorState, setEditorState] = useState<StructuredParameterEditorState>(() =>
    readStructuredParameterEditorState(props.valueType, props.value),
  );

  useEffect(() => {
    setEditorState(readStructuredParameterEditorState(props.valueType, props.value));
  }, [props.value, props.valueType]);

  const validation = useMemo(
    () => validateStructuredParameterEntries(props.valueType, editorState.entries),
    [editorState.entries, props.valueType],
  );

  useEffect(() => {
    props.onValidationChange?.(editorState.sourceError ?? validation.blockingIssues[0]);
  }, [editorState.sourceError, props.onValidationChange, validation.blockingIssues]);

  function updateEntries(
    updater: (current: StructuredParameterEntry[]) => StructuredParameterEntry[],
  ): void {
    setEditorState((current) => {
      const nextEntries = updater(current.entries);
      const nextState = { entries: nextEntries };
      const nextValidation = validateStructuredParameterEntries(props.valueType, nextEntries);
      if (nextValidation.isValid) {
        props.onChange(serializeStructuredParameterEntries(props.valueType, nextEntries));
      }
      return nextState;
    });
  }

  function resetStructuredDefault(): void {
    setEditorState({ entries: [] });
    props.onChange('');
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/10 p-4">
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">
          {props.valueType === 'object' ? 'Structured object fields' : 'Structured list items'}
        </div>
        <p className="text-xs text-muted">
          {props.valueType === 'object'
            ? 'Set object defaults with named fields and typed values instead of authoring a raw JSON blob.'
            : 'Set list defaults with typed items instead of authoring a raw JSON array.'}
        </p>
      </div>
      {editorState.sourceError ? (
        <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <p>{editorState.sourceError}</p>
          <Button type="button" variant="outline" size="sm" onClick={resetStructuredDefault}>
            {props.valueType === 'object' ? 'Clear object default' : 'Clear list default'}
          </Button>
        </div>
      ) : null}
      {validation.blockingIssues.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          Resolve the highlighted default-value rows before saving the playbook.
        </div>
      ) : null}
      {editorState.entries.length === 0 ? (
        <p className="text-sm text-muted">
          {props.valueType === 'object'
            ? 'No default object fields configured.'
            : 'No default list items configured.'}
        </p>
      ) : (
        editorState.entries.map((entry, index) => (
          <StructuredParameterEntryCard
            key={entry.id}
            entry={entry}
            index={index}
            valueType={props.valueType}
            errors={validation.entryErrors[index] ?? {}}
            onChange={(patch) =>
              updateEntries((current) =>
                current.map((currentEntry, entryIndex) =>
                  entryIndex === index ? { ...currentEntry, ...patch } : currentEntry,
                ),
              )
            }
            onRemove={() =>
              updateEntries((current) =>
                current.filter((_, entryIndex) => entryIndex !== index),
              )
            }
          />
        ))
      )}
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          updateEntries((current) => [...current, createStructuredParameterEntry()])
        }
      >
        {props.valueType === 'object' ? 'Add object field' : 'Add list item'}
      </Button>
    </div>
  );
}

function StructuredParameterEntryCard(props: {
  entry: StructuredParameterEntry;
  index: number;
  valueType: 'object' | 'array';
  errors: {
    key?: string;
    value?: string;
  };
  onChange(patch: Partial<StructuredParameterEntry>): void;
  onRemove(): void;
}): JSX.Element {
  return (
    <div className="grid gap-3 rounded-lg border border-border/70 bg-background/80 p-3">
      <div
        className={
          props.valueType === 'object'
            ? 'grid gap-3 lg:grid-cols-[minmax(0,1fr),minmax(0,0.7fr),minmax(0,1.2fr),auto]'
            : 'grid gap-3 lg:grid-cols-[minmax(0,0.7fr),minmax(0,1.2fr),auto]'
        }
      >
        {props.valueType === 'object' ? (
          <label className="grid gap-1 text-xs">
            <span className="font-medium">Field name</span>
            <Input
              value={props.entry.key}
              aria-invalid={props.errors.key ? true : undefined}
              className={
                props.errors.key ? 'border-red-300 focus-visible:ring-red-500' : undefined
              }
              onChange={(event) => props.onChange({ key: event.target.value })}
              placeholder="branch"
            />
            {props.errors.key ? (
              <span className="text-xs text-red-600 dark:text-red-400">{props.errors.key}</span>
            ) : (
              <span className="text-xs text-muted">
                Use stable field names that match the launch input operators expect.
              </span>
            )}
          </label>
        ) : null}
        <label className="grid gap-1 text-xs">
          <span className="font-medium">Type</span>
          <Select
            value={props.entry.valueType}
            onValueChange={(value) =>
              props.onChange({ valueType: value as StructuredParameterValueType })
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
          <StructuredScalarValueField
            entry={props.entry}
            hasError={Boolean(props.errors.value)}
            onChange={(value) => props.onChange({ value })}
          />
          {props.errors.value ? (
            <span className="text-xs text-red-600 dark:text-red-400">{props.errors.value}</span>
          ) : (
            <span className="text-xs text-muted">
              Choose JSON only when the nested default is genuinely complex.
            </span>
          )}
        </div>
        <div className="flex items-end">
          <Button type="button" variant="outline" size="sm" onClick={props.onRemove}>
            Remove
          </Button>
        </div>
      </div>
    </div>
  );
}

function StructuredScalarValueField(props: {
  entry: StructuredParameterEntry;
  hasError: boolean;
  onChange(value: string): void;
}): JSX.Element {
  if (props.entry.valueType === 'boolean') {
    return (
      <Select
        value={props.entry.value || UNSET_VALUE}
        onValueChange={(value) => props.onChange(value === UNSET_VALUE ? '' : value)}
      >
        <SelectTrigger
          aria-invalid={props.hasError ? true : undefined}
          className={props.hasError ? 'border-red-300 focus-visible:ring-red-500' : undefined}
        >
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

  if (props.entry.valueType === 'json') {
    return (
      <Textarea
        value={props.entry.value}
        onChange={(event) => props.onChange(event.target.value)}
        className={`min-h-[96px] font-mono text-xs${
          props.hasError ? ' border-red-300 focus-visible:ring-red-500' : ''
        }`}
        placeholder='{"branch":"main"}'
      />
    );
  }

  return (
    <Input
      type={props.entry.valueType === 'number' ? 'number' : 'text'}
      inputMode={props.entry.valueType === 'number' ? 'decimal' : undefined}
      value={props.entry.value}
      aria-invalid={props.hasError ? true : undefined}
      className={props.hasError ? 'border-red-300 focus-visible:ring-red-500' : undefined}
      onChange={(event) => props.onChange(event.target.value)}
      placeholder={props.entry.valueType === 'number' ? '3' : 'main'}
    />
  );
}

function parseCommaSeparatedValues(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
