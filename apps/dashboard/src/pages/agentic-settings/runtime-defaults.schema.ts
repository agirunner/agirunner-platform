import type {
  FieldDefinition,
  SectionColumnLayout,
  SectionDefinition,
} from './runtime-defaults.types.js';
import {
  BASE_FIELD_DEFINITIONS,
  BASE_SECTION_DEFINITIONS,
} from './runtime-defaults.schema.base.js';
import {
  OPERATIONS_CONNECTED_PLATFORM_FIELD_KEYS,
  OPERATIONS_FIELD_DEFINITIONS,
  OPERATIONS_INLINE_SECTION_COLUMNS,
  OPERATIONS_SECTION_DEFINITIONS,
  PLATFORM_OPERATION_SECTION_KEYS,
  PRIMARY_OPERATIONS_SECTION_KEYS,
  RUNTIME_OPERATION_RUNTIME_SECTION_KEYS,
} from './runtime-defaults.schema.operations.js';
import {
  RUNTIME_OPERATION_FIELD_DEFINITIONS,
  RUNTIME_OPERATION_SECTION_DEFINITIONS,
} from './runtime-defaults-runtime-ops.js';
export {
  OPERATIONS_FIELD_DEFINITIONS,
  OPERATIONS_INLINE_SECTION_COLUMNS,
  OPERATIONS_SECTION_DEFINITIONS,
  PRIMARY_OPERATIONS_SECTION_KEYS,
} from './runtime-defaults.schema.operations.js';

export const SECTION_DEFINITIONS: SectionDefinition[] = [
  BASE_SECTION_DEFINITIONS[0],
  BASE_SECTION_DEFINITIONS[1],
  ...RUNTIME_OPERATION_SECTION_DEFINITIONS.filter((section) =>
    RUNTIME_OPERATION_RUNTIME_SECTION_KEYS.has(section.key),
  ),
  ...BASE_SECTION_DEFINITIONS.slice(2),
];

export const PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS = ['runtime_containers'] as const;

export const RUNTIME_INLINE_SECTION_COLUMNS: SectionColumnLayout = {
  left: [
    'server_timeouts',
    'tool_timeouts',
    'lifecycle_timeouts',
    'workspace_timeouts',
    'capture_timeouts',
  ],
  right: [
    'task_limits',
    'connected_platform',
    'secrets_timeouts',
    'subagent_timeouts',
    'agent_context',
    'orchestrator_context',
    'agent_safeguards',
  ],
};

export const FIELD_DEFINITIONS: FieldDefinition[] = [
  ...BASE_FIELD_DEFINITIONS.slice(0, 4),
  ...RUNTIME_OPERATION_FIELD_DEFINITIONS.filter(
    (field) =>
      RUNTIME_OPERATION_RUNTIME_SECTION_KEYS.has(field.section) &&
      !OPERATIONS_CONNECTED_PLATFORM_FIELD_KEYS.has(field.key) &&
      field.key !== 'specialist_runtime_drain_grace_seconds',
  ),
  ...BASE_FIELD_DEFINITIONS.slice(4),
];

export function fieldsForSection(
  sectionKey: FieldDefinition['section'],
  fieldDefinitions: FieldDefinition[] = FIELD_DEFINITIONS,
): FieldDefinition[] {
  return fieldDefinitions.filter((field) => field.section === sectionKey);
}

export const __runtimeDefaultsSchemaPrivate = {
  OPERATIONS_CONNECTED_PLATFORM_FIELD_KEYS,
  PLATFORM_OPERATION_SECTION_KEYS,
};
