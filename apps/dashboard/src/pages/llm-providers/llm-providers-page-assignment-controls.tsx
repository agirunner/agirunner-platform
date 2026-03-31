import type { Dispatch, SetStateAction } from 'react';

import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { TableCell } from '../../components/ui/table.js';
import { ERROR_TEXT_STYLE, FIELD_ERROR_CLASS_NAME } from './llm-providers-page.chrome.js';
import type {
  AssignmentRoleRow,
  LlmModel,
  ReasoningConfigSchema,
} from './llm-providers-page.types.js';

export interface RoleState {
  modelId: string;
  reasoningConfig: Record<string, unknown> | null;
}

export const TABLE_ROLE_DESCRIPTION_LIMIT = 56;

export function buildReasoningValue(
  schema: ReasoningConfigSchema,
  value: string | number,
): Record<string, unknown> {
  return { [schema.type]: value };
}

export function extractReasoningValue(
  schema: ReasoningConfigSchema | null | undefined,
  config: Record<string, unknown> | null | undefined,
): string | number | null {
  if (!schema || !config) return null;
  const val = config[schema.type];
  return val !== undefined ? (val as string | number) : null;
}

export function ReasoningControl(props: {
  schema: ReasoningConfigSchema | null | undefined;
  value: string | number | null;
  onChange(v: Record<string, unknown> | null): void;
}): JSX.Element | null {
  if (!props.schema) {
    return <span className="text-sm text-muted">N/A</span>;
  }
  const schema = props.schema;

  const selectClassName = 'h-11 w-full max-w-[180px]';

  if (schema.options) {
    const current = (props.value as string) ?? '__default__';
    return (
      <Select
        value={current}
        onValueChange={(value) => {
          if (value === '__default__') {
            props.onChange(null);
          } else {
            props.onChange(buildReasoningValue(schema, value));
          }
        }}
      >
        <SelectTrigger className={selectClassName}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__default__">Default ({String(schema.default)})</SelectItem>
          {schema.options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  const numValue = (props.value as number) ?? schema.default;
  const min = schema.min ?? 0;
  const max = schema.max ?? 128000;

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={min}
        max={max}
        value={numValue}
        onChange={(event) => {
          const n = parseInt(event.target.value, 10);
          if (!isNaN(n)) {
            props.onChange(buildReasoningValue(schema, Math.max(min, Math.min(max, n))));
          }
        }}
        className="h-11 w-[120px]"
      />
      <span className="text-xs text-muted">Thinking budget</span>
    </div>
  );
}

export function ModelReasoningSelect(props: {
  modelId: string;
  reasoningConfig: Record<string, unknown> | null;
  enabledModels: LlmModel[];
  modelError?: string;
  layout?: 'table' | 'stack';
  onModelChange(modelId: string): void;
  onReasoningChange(config: Record<string, unknown> | null): void;
}): JSX.Element {
  const selectedModel = props.enabledModels.find((model) => model.id === props.modelId);
  const modelReasoningSchema = selectedModel?.reasoning_config ?? null;
  const layout = props.layout ?? 'table';
  const modelTriggerClassName = props.modelError
    ? layout === 'table'
      ? 'h-11 w-full max-w-[260px] border-red-300 focus-visible:ring-red-500'
      : 'w-full border-red-300 focus-visible:ring-red-500'
    : layout === 'table'
      ? 'h-11 w-full max-w-[260px]'
      : 'w-full';
  const modelField = (
    <div className="space-y-1">
      <Select
        value={props.modelId}
        onValueChange={(value) => {
          props.onModelChange(value);
          props.onReasoningChange(null);
        }}
      >
        <SelectTrigger className={modelTriggerClassName}>
          <SelectValue placeholder="Select model" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">None (use system default)</SelectItem>
          {props.enabledModels.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.model_id}
              {model.provider_name ? ` (${model.provider_name})` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {props.modelError ? (
        <p className={FIELD_ERROR_CLASS_NAME} style={ERROR_TEXT_STYLE}>
          {props.modelError}
        </p>
      ) : null}
    </div>
  );
  const reasoningField = (
    <ReasoningControl
      schema={modelReasoningSchema}
      value={extractReasoningValue(modelReasoningSchema, props.reasoningConfig)}
      onChange={props.onReasoningChange}
    />
  );

  if (layout === 'stack') {
    return (
      <div className="grid gap-3">
        <div className="grid gap-1 text-sm">
          <span className="font-medium">Model</span>
          {modelField}
        </div>
        <div className="grid gap-1 text-sm">
          <span className="font-medium">Reasoning</span>
          {reasoningField}
        </div>
      </div>
    );
  }

  return (
    <>
      <TableCell className="align-middle">
        <div className="flex justify-center">{modelField}</div>
      </TableCell>
      <TableCell className="align-middle whitespace-nowrap">
        <div className="flex justify-center">{reasoningField}</div>
      </TableCell>
    </>
  );
}

export function summarizeRoleDescription(role: AssignmentRoleRow): string {
  if (role.description?.trim()) {
    return role.description.trim();
  }
  if (role.source === 'assignment') {
    return 'Assignment references a role that is no longer in the active catalog.';
  }
  if (role.source === 'system') {
    return 'Dedicated orchestrator model and reasoning policy.';
  }
  return 'Configured role is currently inactive.';
}

export function truncateRoleDescription(description: string): string {
  if (description.length <= TABLE_ROLE_DESCRIPTION_LIMIT) {
    return description;
  }
  return `${description.slice(0, TABLE_ROLE_DESCRIPTION_LIMIT - 1).trimEnd()}…`;
}

export function normalizeReasoningConfig(
  value: Record<string, unknown> | null | undefined,
): string {
  return JSON.stringify(value ?? null);
}

export function summarizeStaleRoleBadgeLabel(input: { missingAssignmentCount: number }): string {
  if (input.missingAssignmentCount > 0) {
    return `${input.missingAssignmentCount} missing assignment${input.missingAssignmentCount === 1 ? '' : 's'}`;
  }
  return '';
}

export type RoleStateSetter = Dispatch<SetStateAction<Record<string, RoleState>>>;
