import type {
  FieldDefinition,
  SectionColumnLayout,
  SectionDefinition,
} from './runtime-defaults.types.js';
import {
  RUNTIME_OPERATION_FIELD_DEFINITIONS,
  RUNTIME_OPERATION_SECTION_DEFINITIONS,
} from './runtime-defaults-runtime-ops.js';

export const RUNTIME_OPERATION_RUNTIME_SECTION_KEYS = new Set<FieldDefinition['section']>([
  'task_limits',
  'server_timeouts',
  'tool_timeouts',
  'lifecycle_timeouts',
  'connected_platform',
  'workspace_timeouts',
  'capture_timeouts',
  'secrets_timeouts',
  'subagent_timeouts',
]);

export const PLATFORM_OPERATION_SECTION_KEYS = new Set<FieldDefinition['section']>([
  'task_timeouts',
  'realtime_transport',
  'workflow_activation',
  'container_manager',
  'worker_supervision',
  'agent_supervision',
  'platform_loops',
]);

export const OPERATIONS_CONNECTED_PLATFORM_FIELD_KEYS = new Set<string>([
  'platform.api_request_timeout_seconds',
  'platform.log_ingest_timeout_seconds',
  'platform.log_flush_interval_ms',
  'platform.heartbeat_max_failures',
  'platform.cancellation_report_timeout_seconds',
  'platform.drain_timeout_seconds',
  'platform.self_terminate_cleanup_timeout_seconds',
]);

const OPERATIONS_SECTION_DEFINITION_BY_KEY = new Map(
  RUNTIME_OPERATION_SECTION_DEFINITIONS.map((section) => [section.key, section]),
);
const OPERATIONS_FIELD_DEFINITION_BY_KEY = new Map(
  RUNTIME_OPERATION_FIELD_DEFINITIONS.map((field) => [field.key, field]),
);

export const OPERATIONS_SECTION_DEFINITIONS: SectionDefinition[] = [
  operationSectionByKey('task_timeouts'),
  {
    ...operationSectionByKey('connected_platform'),
    title: 'Platform Connection & Reporting',
    description:
      'Tune API, log, drain, and cleanup behavior for platform-connected specialist agents.',
  },
  {
    ...operationSectionByKey('container_manager'),
    description:
      'Control specialist agent drain timing plus container reconcile, shutdown, and log-management behavior.',
  },
  operationSectionByKey('worker_supervision'),
  operationSectionByKey('realtime_transport'),
  operationSectionByKey('platform_loops'),
];

export const PRIMARY_OPERATIONS_SECTION_KEYS = [] as const;

export const OPERATIONS_INLINE_SECTION_COLUMNS: SectionColumnLayout = {
  left: ['task_timeouts', 'connected_platform', 'container_manager'],
  right: ['worker_supervision', 'realtime_transport', 'platform_loops'],
};

export const OPERATIONS_FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    ...fieldByKey('specialist_runtime_drain_grace_seconds'),
    section: 'container_manager',
  },
  fieldByKey('tasks.default_timeout_minutes'),
  ...RUNTIME_OPERATION_FIELD_DEFINITIONS.filter(
    (field) =>
      (PLATFORM_OPERATION_SECTION_KEYS.has(field.section) ||
        OPERATIONS_CONNECTED_PLATFORM_FIELD_KEYS.has(field.key)) &&
      field.key !== 'tasks.default_timeout_minutes' &&
      field.key !== 'specialist_runtime_drain_grace_seconds',
  ).map<FieldDefinition>((field) => {
    if (field.section === 'workflow_activation') {
      return { ...field, section: 'task_timeouts' };
    }
    if (field.section === 'agent_supervision') {
      return { ...field, section: 'worker_supervision' };
    }
    return field;
  }),
];

function fieldByKey(key: string): FieldDefinition {
  const field = OPERATIONS_FIELD_DEFINITION_BY_KEY.get(key);
  if (!field) {
    throw new Error(`Missing runtime default field definition for ${key}`);
  }
  return field;
}

function operationSectionByKey(key: FieldDefinition['section']): SectionDefinition {
  const section = OPERATIONS_SECTION_DEFINITION_BY_KEY.get(key);
  if (!section) {
    throw new Error(`Missing runtime default section definition for ${key}`);
  }
  return section;
}
