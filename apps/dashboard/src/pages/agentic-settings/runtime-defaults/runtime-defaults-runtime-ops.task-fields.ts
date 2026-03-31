import type { FieldDefinition } from './runtime-defaults.types.js';

export const RUNTIME_OPERATION_TASK_FIELDS: FieldDefinition[] = [
  {
    key: 'queue.max_depth',
    label: 'Queued task backlog limit',
    description:
      'Maximum number of accepted queued tasks before the specialist agent starts rejecting additional submissions.',
    configType: 'number',
    placeholder: '100',
    section: 'task_limits',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'server.shutdown_timeout_seconds',
    label: 'Shutdown timeout (seconds)',
    description:
      'How long the specialist agent waits for graceful shutdown before forcing termination.',
    configType: 'number',
    placeholder: '5',
    section: 'server_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'server.read_header_timeout_seconds',
    label: 'Read-header timeout (seconds)',
    description: 'Maximum time allowed to receive incoming HTTP request headers.',
    configType: 'number',
    placeholder: '5',
    section: 'server_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'api.events_heartbeat_seconds',
    label: 'Event heartbeat interval (seconds)',
    description:
      'How often the specialist agent emits task-event heartbeats while a stream is open.',
    configType: 'number',
    placeholder: '10',
    section: 'server_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'llm.http_timeout_seconds',
    label: 'Provider HTTP timeout (seconds)',
    description: 'Upper bound for outbound LLM HTTP requests from the specialist agent.',
    configType: 'number',
    placeholder: '120',
    section: 'server_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  ...buildToolTimeoutFields(),
  ...buildLifecycleTimeoutFields(),
  {
    key: 'tasks.default_timeout_minutes',
    label: 'Default task timeout (minutes)',
    description:
      'Default timeout assigned to new tasks when the task payload does not provide one explicitly.',
    configType: 'number',
    placeholder: '180',
    section: 'task_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
];

function buildToolTimeoutFields(): FieldDefinition[] {
  return [
    toolTimeoutField('tools.file_read_timeout_seconds', 'File read timeout', '30'),
    toolTimeoutField('tools.file_write_timeout_seconds', 'File write timeout', '30'),
    toolTimeoutField('tools.file_edit_timeout_seconds', 'File edit timeout', '30'),
    toolTimeoutField('tools.file_list_timeout_seconds', 'File list timeout', '30'),
    toolTimeoutField('tools.git_status_timeout_seconds', 'Git status timeout', '30'),
    toolTimeoutField('tools.git_diff_timeout_seconds', 'Git diff timeout', '30'),
    toolTimeoutField('tools.git_log_timeout_seconds', 'Git log timeout', '30'),
    toolTimeoutField('tools.git_commit_timeout_seconds', 'Git commit timeout', '60'),
    toolTimeoutField('tools.git_push_timeout_seconds', 'Git push timeout', '90'),
    toolTimeoutField('tools.shell_exec_timeout_seconds', 'Shell exec timeout', '300'),
    toolTimeoutField('tools.shell_exec_timeout_min_seconds', 'Shell exec minimum timeout', '1'),
    toolTimeoutField('tools.shell_exec_timeout_max_seconds', 'Shell exec maximum timeout', '900'),
    toolTimeoutField('tools.helpers_exec_timeout_seconds', 'Helper exec timeout', '10'),
    toolTimeoutField('tools.web_fetch_timeout_seconds', 'Web fetch timeout', '30'),
    toolTimeoutField('tools.mcp_timeout_seconds', 'MCP timeout', '30'),
  ];
}

function buildLifecycleTimeoutFields(): FieldDefinition[] {
  return [
    {
      key: 'lifecycle.healthcheck_timeout_seconds',
      label: 'Healthcheck timeout (seconds)',
      description:
        'Deadline for lifecycle health probes before the specialist agent marks the check as failed.',
      configType: 'number',
      placeholder: '5',
      section: 'lifecycle_timeouts',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'lifecycle.healthcheck_retry_delay_seconds',
      label: 'Healthcheck retry delay (seconds)',
      description:
        'How long the specialist agent waits before retrying a failed specialist execution health probe.',
      configType: 'number',
      placeholder: '2',
      section: 'lifecycle_timeouts',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'lifecycle.failed_start_stop_timeout_seconds',
      label: 'Failed-start stop timeout (seconds)',
      description:
        'How long the specialist agent waits when stopping a specialist execution that never became healthy.',
      configType: 'number',
      placeholder: '2',
      section: 'lifecycle_timeouts',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'lifecycle.destroy_stop_timeout_seconds',
      label: 'Destroy stop timeout (seconds)',
      description:
        'How long the specialist agent waits when destroying an existing specialist execution.',
      configType: 'number',
      placeholder: '10',
      defaultValue: '1',
      section: 'lifecycle_timeouts',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
  ];
}

function toolTimeoutField(key: string, label: string, placeholder: string): FieldDefinition {
  return {
    key,
    label: `${label} (seconds)`,
    description: `Maximum specialist agent duration for ${label.toLowerCase()} operations.`,
    configType: 'number',
    placeholder,
    section: 'tool_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  };
}
