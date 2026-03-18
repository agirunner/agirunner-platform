import type { DashboardPlaybookRecord } from '../../lib/api.js';
import type {
  StructuredEntryFieldError,
  StructuredEntryValidationResult,
} from './playbook-launch-entry-validation.js';
import type { StructuredEntryDraft, StructuredValueType } from './playbook-launch-support.js';

export type InstructionLayerName = 'platform' | 'workspace' | 'playbook' | 'role' | 'task';

export interface WorkflowConfigOverrideSpec {
  path: string;
  label: string;
  description: string;
  valueType: StructuredValueType;
  options: string[];
  defaultValue?: unknown;
  min?: number;
  max?: number;
}

export interface WorkflowPolicyDefinition {
  configOverrideSpecs: WorkflowConfigOverrideSpec[];
  defaultSuppressedLayers: InstructionLayerName[];
}

export interface WorkflowConfigOverrideValidationResult {
  fieldErrors: Record<string, string | undefined>;
  blockingIssues: string[];
  isValid: boolean;
}

const INSTRUCTION_LAYER_ORDER: InstructionLayerName[] = [
  'platform',
  'workspace',
  'playbook',
  'role',
  'task',
];

export function readWorkflowPolicyDefinition(
  playbook: DashboardPlaybookRecord | null,
): WorkflowPolicyDefinition {
  const definition = asRecord(playbook?.definition);
  const configDefaults = asRecord(definition.config);
  const constraintEntries = readConstraintEntries(definition);
  const defaultLeaves = new Map<string, unknown>();
  collectLeafPaths(configDefaults, [], defaultLeaves);

  const paths = new Set<string>();
  for (const path of defaultLeaves.keys()) {
    paths.add(path);
  }
  for (const path of constraintEntries.keys()) {
    paths.add(path);
  }

  return {
    configOverrideSpecs: [...paths]
      .sort((left, right) => left.localeCompare(right))
      .map((path) =>
        buildWorkflowConfigOverrideSpec({
          path,
          defaultValue: defaultLeaves.get(path),
          constraint: constraintEntries.get(path),
        }),
      ),
    defaultSuppressedLayers: readInstructionLayers(
      asRecord(definition.default_instruction_config).suppress_layers,
    ),
  };
}

export function validateWorkflowConfigOverrideDrafts(
  specs: WorkflowConfigOverrideSpec[],
  drafts: Record<string, string>,
): WorkflowConfigOverrideValidationResult {
  const fieldErrors: Record<string, string | undefined> = {};

  for (const spec of specs) {
    const rawValue = drafts[spec.path]?.trim() ?? '';
    if (!rawValue) {
      fieldErrors[spec.path] = undefined;
      continue;
    }
    fieldErrors[spec.path] = readWorkflowConfigOverrideError(spec, rawValue);
  }

  const blockingIssues = uniqueMessages(Object.values(fieldErrors));
  return {
    fieldErrors,
    blockingIssues,
    isValid: blockingIssues.length === 0,
  };
}

export function validateWorkflowConfigEntryDrafts(
  drafts: StructuredEntryDraft[],
  specs: WorkflowConfigOverrideSpec[],
): StructuredEntryValidationResult {
  const knownPaths = new Set(specs.map((spec) => spec.path.toLowerCase()));
  const duplicateKeys = findDuplicateConfigKeys(drafts);
  const entryErrors = drafts.map((draft) =>
    validateWorkflowConfigEntryDraft(draft, duplicateKeys, knownPaths),
  );
  const blockingIssues = uniqueMessages(entryErrors.flatMap((entry) => [entry.key, entry.value]));
  return {
    entryErrors,
    blockingIssues,
    isValid: blockingIssues.length === 0,
  };
}

export function buildWorkflowConfigOverrides(input: {
  specs: WorkflowConfigOverrideSpec[];
  draftValues: Record<string, string>;
  extraDrafts: StructuredEntryDraft[];
}): Record<string, unknown> | undefined {
  const value: Record<string, unknown> = {};

  for (const spec of input.specs) {
    const rawValue = input.draftValues[spec.path] ?? '';
    const parsedValue = parseConfigValue(
      rawValue,
      spec.valueType,
      `Workflow config override '${spec.label}'`,
    );
    if (parsedValue === undefined) {
      continue;
    }
    setConfigOverrideValue(value, spec.path, parsedValue);
  }

  for (const draft of input.extraDrafts) {
    const key = normalizeConfigOverridePath(draft.key);
    if (!key) {
      if (draft.value.trim() === '') {
        continue;
      }
      throw new Error('Workflow config override paths are required.');
    }
    const parsedValue = parseConfigValue(
      draft.value,
      draft.valueType,
      `Workflow config override '${key}'`,
    );
    if (parsedValue === undefined) {
      throw new Error(`Workflow config override '${key}' must include a value.`);
    }
    setConfigOverrideValue(value, key, parsedValue);
  }

  return Object.keys(value).length > 0 ? value : undefined;
}

export function countConfiguredWorkflowConfigOverrides(input: {
  specs: WorkflowConfigOverrideSpec[];
  draftValues: Record<string, string>;
  extraDrafts: StructuredEntryDraft[];
}): number {
  const structuredCount = input.specs.filter(
    (spec) => (input.draftValues[spec.path] ?? '').trim().length > 0,
  ).length;
  const extraCount = input.extraDrafts.filter(
    (draft) => normalizeConfigOverridePath(draft.key).length > 0 && draft.value.trim().length > 0,
  ).length;
  return structuredCount + extraCount;
}

export function buildInstructionConfig(input: {
  suppressedLayers: InstructionLayerName[];
  defaultSuppressedLayers: InstructionLayerName[];
}): Record<string, unknown> | undefined {
  const selected = normalizeInstructionLayers(input.suppressedLayers);
  const defaults = normalizeInstructionLayers(input.defaultSuppressedLayers);
  if (selected.length === 0 && defaults.length === 0) {
    return undefined;
  }
  if (haveSameInstructionLayers(selected, defaults)) {
    return undefined;
  }
  return { suppress_layers: selected };
}

export function haveSameInstructionLayers(
  current: InstructionLayerName[],
  baseline: InstructionLayerName[],
): boolean {
  const currentValue = normalizeInstructionLayers(current);
  const baselineValue = normalizeInstructionLayers(baseline);
  return (
    currentValue.length === baselineValue.length &&
    currentValue.every((layer, index) => layer === baselineValue[index])
  );
}

export function summarizeInstructionLayerSelection(input: {
  suppressedLayers: InstructionLayerName[];
  defaultSuppressedLayers: InstructionLayerName[];
}): string {
  const selected = normalizeInstructionLayers(input.suppressedLayers);
  const defaults = normalizeInstructionLayers(input.defaultSuppressedLayers);
  if (selected.length === 0 && defaults.length === 0) {
    return 'No instruction layers suppressed.';
  }
  if (haveSameInstructionLayers(selected, defaults)) {
    return defaults.length > 0
      ? `Using playbook defaults: ${formatInstructionLayerList(defaults)} suppressed.`
      : 'Using playbook defaults with every instruction layer active.';
  }
  return selected.length > 0
    ? `Workflow launch will suppress ${formatInstructionLayerList(selected)}.`
    : 'Workflow launch restores every instruction layer, including playbook defaults.';
}

export function toggleInstructionLayer(
  selectedLayers: InstructionLayerName[],
  layer: InstructionLayerName,
  checked: boolean,
): InstructionLayerName[] {
  const selected = new Set(normalizeInstructionLayers(selectedLayers));
  if (checked) {
    selected.add(layer);
  } else {
    selected.delete(layer);
  }
  return normalizeInstructionLayers([...selected]);
}

function buildWorkflowConfigOverrideSpec(input: {
  path: string;
  defaultValue: unknown;
  constraint?: Record<string, unknown>;
}): WorkflowConfigOverrideSpec {
  const constraint = input.constraint ?? {};
  const enumOptions = readPrimitiveOptions(constraint.enum);
  const valueType = inferValueType(input.defaultValue, constraint, enumOptions);
  const label = humanizeConfigPath(input.path);
  const descriptionParts = [
    `Override ${input.path} for this workflow without changing the playbook revision.`,
  ];

  if (input.defaultValue !== undefined) {
    descriptionParts.push(`Playbook default: ${formatConfigValue(input.defaultValue)}.`);
  }
  if (enumOptions.length > 0) {
    descriptionParts.push(`Allowed values: ${enumOptions.join(', ')}.`);
  }
  if (typeof constraint.min === 'number' || typeof constraint.max === 'number') {
    const rangeParts: string[] = [];
    if (typeof constraint.min === 'number') {
      rangeParts.push(`minimum ${constraint.min}`);
    }
    if (typeof constraint.max === 'number') {
      rangeParts.push(`maximum ${constraint.max}`);
    }
    descriptionParts.push(`Constraint: ${rangeParts.join(', ')}.`);
  }

  return {
    path: input.path,
    label,
    description: descriptionParts.join(' '),
    valueType,
    options: enumOptions,
    defaultValue: input.defaultValue,
    ...(typeof constraint.min === 'number' ? { min: constraint.min } : {}),
    ...(typeof constraint.max === 'number' ? { max: constraint.max } : {}),
  };
}

function readConstraintEntries(
  definition: Record<string, unknown>,
): Map<string, Record<string, unknown>> {
  const constraints = asRecord(asRecord(definition.config_policy).constraints);
  const entries = new Map<string, Record<string, unknown>>();
  for (const [rawPath, rawConstraint] of Object.entries(constraints)) {
    const path = normalizeConfigOverridePath(rawPath);
    if (!path) {
      continue;
    }
    entries.set(path, asRecord(rawConstraint));
  }
  return entries;
}

function collectLeafPaths(
  value: Record<string, unknown>,
  prefix: string[],
  paths: Map<string, unknown>,
): void {
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = [...prefix, key];
    if (isRecord(entry)) {
      collectLeafPaths(entry, nextPath, paths);
      continue;
    }
    paths.set(nextPath.join('.'), entry);
  }
}

function inferValueType(
  defaultValue: unknown,
  constraint: Record<string, unknown>,
  enumOptions: string[],
): StructuredValueType {
  if (enumOptions.length > 0) {
    const enumValues = Array.isArray(constraint.enum) ? constraint.enum : [];
    if (enumValues.every((value) => typeof value === 'boolean')) {
      return 'boolean';
    }
    if (enumValues.every((value) => typeof value === 'number')) {
      return 'number';
    }
    return 'string';
  }
  if (typeof defaultValue === 'number') {
    return 'number';
  }
  if (typeof defaultValue === 'boolean') {
    return 'boolean';
  }
  if (typeof constraint.min === 'number' || typeof constraint.max === 'number') {
    return 'number';
  }
  if (defaultValue && typeof defaultValue === 'object') {
    return 'json';
  }
  return 'string';
}

function readPrimitiveOptions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  if (
    !value.every(
      (entry) =>
        typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean',
    )
  ) {
    return [];
  }
  return value.map((entry) => String(entry));
}

function readWorkflowConfigOverrideError(
  spec: WorkflowConfigOverrideSpec,
  rawValue: string,
): string | undefined {
  if (spec.options.length > 0 && !spec.options.includes(rawValue)) {
    return `Choose one of the allowed values for ${spec.label}.`;
  }
  try {
    const parsedValue = parseConfigValue(
      rawValue,
      spec.valueType,
      `Workflow config override '${spec.label}'`,
    );
    if (parsedValue === undefined) {
      return undefined;
    }
    if (typeof parsedValue === 'number') {
      if (typeof spec.min === 'number' && parsedValue < spec.min) {
        return `${spec.label} must be at least ${spec.min}.`;
      }
      if (typeof spec.max === 'number' && parsedValue > spec.max) {
        return `${spec.label} must be at most ${spec.max}.`;
      }
    }
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : `${spec.label} is invalid.`;
  }
}

function validateWorkflowConfigEntryDraft(
  draft: StructuredEntryDraft,
  duplicateKeys: Set<string>,
  knownPaths: Set<string>,
): StructuredEntryFieldError {
  const normalizedPath = normalizeConfigOverridePath(draft.key);
  const value = draft.value.trim();
  const hasAnyValue = normalizedPath.length > 0 || draft.key.trim().length > 0 || value.length > 0;
  if (!hasAnyValue) {
    return {};
  }

  const fieldError: StructuredEntryFieldError = {};
  if (!normalizedPath) {
    fieldError.key = 'Use a dotted config path such as tools.web_search_provider.';
  } else if (!isValidConfigOverridePath(normalizedPath)) {
    fieldError.key = 'Use dot-separated path segments with letters, numbers, or underscores.';
  } else if (duplicateKeys.has(normalizedPath.toLowerCase())) {
    fieldError.key = 'Config override paths must be unique within this section.';
  } else if (knownPaths.has(normalizedPath.toLowerCase())) {
    fieldError.key = 'Use the dedicated structured field for this config path.';
  }

  if (!value) {
    fieldError.value = 'Add a value or remove this row.';
  } else {
    fieldError.value = readEntryValueError(draft.valueType, value);
  }

  return fieldError;
}

function findDuplicateConfigKeys(drafts: StructuredEntryDraft[]): Set<string> {
  const values = drafts
    .map((draft) => normalizeConfigOverridePath(draft.key).toLowerCase())
    .filter((value) => value.length > 0);
  return new Set(values.filter((value, index) => values.indexOf(value) !== index));
}

function parseConfigValue(
  rawValue: string,
  valueType: StructuredValueType,
  label: string,
): unknown {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }
  if (valueType === 'number') {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${label} must be a valid number.`);
    }
    return parsed;
  }
  if (valueType === 'boolean') {
    if (trimmed !== 'true' && trimmed !== 'false') {
      throw new Error(`${label} must be true or false.`);
    }
    return trimmed === 'true';
  }
  if (valueType === 'json') {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      throw new Error(
        `${label} must be valid JSON: ${error instanceof Error ? error.message : 'parse error'}`,
      );
    }
  }
  return rawValue;
}

function setConfigOverrideValue(
  target: Record<string, unknown>,
  rawPath: string,
  value: unknown,
): void {
  const path = normalizeConfigOverridePath(rawPath);
  if (!path) {
    throw new Error('Workflow config override paths are required.');
  }
  const segments = path.split('.');
  let current = target;

  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (existing === undefined) {
      current[segment] = {};
      current = current[segment] as Record<string, unknown>;
      continue;
    }
    if (!isRecord(existing)) {
      throw new Error(`Workflow config overrides contains a conflicting path '${path}'.`);
    }
    current = existing;
  }

  const lastSegment = segments[segments.length - 1];
  const existing = current[lastSegment];
  if (existing !== undefined) {
    throw new Error(`Workflow config overrides contains a duplicate path '${path}'.`);
  }
  current[lastSegment] = value;
}

function normalizeConfigOverridePath(value: string): string {
  return value.trim().replace(/^config\./, '');
}

function isValidConfigOverridePath(value: string): boolean {
  if (!value || value.startsWith('.') || value.endsWith('.')) {
    return false;
  }
  return value.split('.').every((segment) => /^[A-Za-z0-9_]+$/.test(segment));
}

function readEntryValueError(valueType: StructuredValueType, value: string): string | undefined {
  if (valueType === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? undefined : 'Enter a valid number.';
  }
  if (valueType === 'json') {
    try {
      JSON.parse(value);
      return undefined;
    } catch {
      return 'Enter valid JSON before launch.';
    }
  }
  return undefined;
}

function readInstructionLayers(value: unknown): InstructionLayerName[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return normalizeInstructionLayers(
    value.filter(
      (entry): entry is InstructionLayerName =>
        entry === 'platform' ||
        entry === 'workspace' ||
        entry === 'playbook' ||
        entry === 'role' ||
        entry === 'task',
    ),
  );
}

function normalizeInstructionLayers(layers: InstructionLayerName[]): InstructionLayerName[] {
  const selected = new Set(layers);
  return INSTRUCTION_LAYER_ORDER.filter((layer) => selected.has(layer));
}

function formatInstructionLayerList(layers: InstructionLayerName[]): string {
  return layers.map((layer) => layer.replace(/_/g, ' ')).join(', ');
}

function humanizeConfigPath(path: string): string {
  const lastSegment = path.split('.').at(-1) ?? path;
  return lastSegment.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatConfigValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueMessages(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
