import type { FieldDefinition, SectionDefinition } from './runtime-defaults.types.js';

export const RUNTIME_OPERATION_SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    key: 'server_timeouts',
    title: 'Server timeouts',
    description: 'Bound runtime HTTP server shutdown and request-header handling.',
  },
  {
    key: 'llm_transport',
    title: 'LLM transport',
    description: 'Control upstream model transport deadlines used by runtime provider adapters.',
  },
  {
    key: 'tool_timeouts',
    title: 'Tool timeouts',
    description: 'Set execution ceilings for the built-in file, git, shell, web, and MCP tools.',
  },
  {
    key: 'container_timeouts',
    title: 'Container operations',
    description: 'Bound runtime checks and container-copy/connect operations.',
  },
  {
    key: 'lifecycle_timeouts',
    title: 'Lifecycle timeouts',
    description: 'Control health checks and task-container stop/destroy deadlines.',
  },
  {
    key: 'task_timeouts',
    title: 'Task timeouts',
    description: 'Set the default timeout applied when newly created tasks do not specify one explicitly.',
  },
  {
    key: 'connected_platform',
    title: 'Connected platform',
    description: 'Tune claim polling and drain behavior when runtimes are attached to the platform fleet.',
  },
  {
    key: 'container_manager',
    title: 'Container manager',
    description: 'Control fleet reconcile cadence and stop/remove grace periods for the manager service.',
  },
  {
    key: 'workspace_timeouts',
    title: 'Workspace timeouts',
    description: 'Bound repo bootstrap, identity setup, and context injection steps before work begins.',
  },
  {
    key: 'capture_timeouts',
    title: 'Capture timeouts',
    description: 'Limit result packaging, artifact export, and capture-side exec steps.',
  },
  {
    key: 'secrets_timeouts',
    title: 'Secrets backends',
    description: 'Limit secret-provider calls made by the runtime during task execution.',
  },
  {
    key: 'subagent_timeouts',
    title: 'Subagent timeouts',
    description: 'Set the default deadline for spawned subagents when callers do not override it.',
  },
];

export const RUNTIME_OPERATION_FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    key: 'server.shutdown_timeout_seconds',
    label: 'Shutdown timeout (seconds)',
    description: 'How long the runtime waits for graceful shutdown before forcing termination.',
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
    key: 'llm.http_timeout_seconds',
    label: 'Provider HTTP timeout (seconds)',
    description: 'Upper bound for outbound LLM HTTP requests from the runtime.',
    configType: 'number',
    placeholder: '60',
    section: 'llm_transport',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  ...buildToolTimeoutFields(),
  ...buildContainerTimeoutFields(),
  ...buildLifecycleTimeoutFields(),
  {
    key: 'tasks.default_timeout_minutes',
    label: 'Default task timeout (minutes)',
    description: 'Default timeout assigned to new tasks when the task payload does not provide one explicitly.',
    configType: 'number',
    placeholder: '30',
    section: 'task_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  ...buildConnectedPlatformFields(),
  ...buildContainerManagerFields(),
  ...buildWorkspaceTimeoutFields(),
  {
    key: 'capture.push_timeout_seconds',
    label: 'Capture push timeout (seconds)',
    description: 'Deadline for capture-side artifact upload and result push steps.',
    configType: 'number',
    placeholder: '60',
    section: 'capture_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'capture.exec_timeout_seconds',
    label: 'Capture exec timeout (seconds)',
    description: 'Maximum duration for capture-side shell execution while packaging task results.',
    configType: 'number',
    placeholder: '10',
    section: 'capture_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'secrets.vault_timeout_seconds',
    label: 'Vault timeout (seconds)',
    description: 'Upper bound for Vault reads and revocation calls when Vault-backed secrets are enabled.',
    configType: 'number',
    placeholder: '10',
    section: 'secrets_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'subagent.default_timeout_seconds',
    label: 'Default subagent timeout (seconds)',
    description: 'Fallback deadline for subagents when the caller does not provide one explicitly.',
    configType: 'number',
    placeholder: '300',
    section: 'subagent_timeouts',
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
    toolTimeoutField('tools.shell_exec_timeout_seconds', 'Shell exec timeout', '120'),
    toolTimeoutField('tools.shell_exec_timeout_min_seconds', 'Shell exec minimum timeout', '1'),
    toolTimeoutField('tools.shell_exec_timeout_max_seconds', 'Shell exec maximum timeout', '300'),
    toolTimeoutField('tools.helpers_exec_timeout_seconds', 'Helper exec timeout', '10'),
    toolTimeoutField('tools.web_fetch_timeout_seconds', 'Web fetch timeout', '30'),
    toolTimeoutField('tools.web_search_timeout_seconds', 'Web search timeout', '30'),
    toolTimeoutField('tools.mcp_timeout_seconds', 'MCP timeout', '30'),
  ];
}

function buildContainerTimeoutFields(): FieldDefinition[] {
  return [
    {
      key: 'docker.checker_timeout_ms',
      label: 'Container checker timeout (ms)',
      description: 'Deadline for runtime container-health checks against the container backend.',
      configType: 'number',
      placeholder: '500',
      section: 'container_timeouts',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'docker.stop_timeout_seconds',
      label: 'Container stop timeout (seconds)',
      description: 'How long runtime stop operations wait before forcing container shutdown.',
      configType: 'number',
      placeholder: '10',
      section: 'container_timeouts',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'container.copy_timeout_seconds',
      label: 'Container copy timeout (seconds)',
      description: 'Maximum duration for copy-to/copy-from operations against task containers.',
      configType: 'number',
      placeholder: '30',
      section: 'container_timeouts',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'containerd.connect_timeout_seconds',
      label: 'Containerd connect timeout (seconds)',
      description: 'Upper bound for establishing containerd connections when that provider is in use.',
      configType: 'number',
      placeholder: '5',
      section: 'container_timeouts',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
  ];
}

function buildLifecycleTimeoutFields(): FieldDefinition[] {
  return [
    {
      key: 'lifecycle.healthcheck_timeout_seconds',
      label: 'Healthcheck timeout (seconds)',
      description: 'Deadline for lifecycle health probes before the runtime marks the check as failed.',
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
      description: 'How long the runtime waits before retrying a failed task-container health probe.',
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
      description: 'How long the runtime waits when stopping a task container that never became healthy.',
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
      description: 'How long the runtime waits when destroying an existing task container.',
      configType: 'number',
      placeholder: '10',
      section: 'lifecycle_timeouts',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
  ];
}

function buildConnectedPlatformFields(): FieldDefinition[] {
  return [
    {
      key: 'platform.claim_poll_seconds',
      label: 'Claim poll interval (seconds)',
      description: 'How often a connected runtime polls the platform for newly claimable work.',
      configType: 'number',
      placeholder: '5',
      section: 'connected_platform',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'platform.heartbeat_max_failures',
      label: 'Heartbeat failure budget',
      description: 'How many consecutive heartbeat failures a connected runtime tolerates before self-termination.',
      configType: 'number',
      placeholder: '24',
      section: 'connected_platform',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'platform.drain_timeout_seconds',
      label: 'Drain timeout (seconds)',
      description: 'How long a draining connected runtime waits for in-flight work before forcing shutdown.',
      configType: 'number',
      placeholder: '600',
      section: 'connected_platform',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
  ];
}

function buildWorkspaceTimeoutFields(): FieldDefinition[] {
  return [
    workspaceTimeoutField('workspace.create_layout_timeout_seconds', 'Create layout timeout', '20'),
    workspaceTimeoutField('workspace.inject_context_rename_timeout_seconds', 'Context rename timeout', '10'),
    workspaceTimeoutField('workspace.configure_git_timeout_seconds', 'Configure git timeout', '15'),
    workspaceTimeoutField('workspace.cleanup_git_timeout_seconds', 'Cleanup git timeout', '10'),
    workspaceTimeoutField('workspace.configure_identity_timeout_seconds', 'Configure identity timeout', '10'),
    workspaceTimeoutField('workspace.clone_timeout_seconds', 'Clone timeout', '120'),
  ];
}

function buildContainerManagerFields(): FieldDefinition[] {
  return [
    {
      key: 'container_manager.reconcile_interval_seconds',
      label: 'Reconcile interval (seconds)',
      description: 'How often the container manager polls the shared fleet snapshot and runs a reconcile cycle.',
      configType: 'number',
      placeholder: '5',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'container_manager.stop_timeout_seconds',
      label: 'Runtime stop timeout (seconds)',
      description: 'Grace period used when the manager stops runtime containers during normal cleanup.',
      configType: 'number',
      placeholder: '30',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'container_manager.shutdown_task_stop_timeout_seconds',
      label: 'Shutdown task stop timeout (seconds)',
      description: 'Grace period used for task containers during manager shutdown cleanup.',
      configType: 'number',
      placeholder: '2',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'container_manager.docker_action_buffer_seconds',
      label: 'Docker action buffer (seconds)',
      description: 'Extra headroom added around stop and remove calls so Docker operations can settle cleanly.',
      configType: 'number',
      placeholder: '15',
      section: 'container_manager',
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
    description: `Maximum runtime duration for ${label.toLowerCase()} operations.`,
    configType: 'number',
    placeholder,
    section: 'tool_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  };
}

function workspaceTimeoutField(key: string, label: string, placeholder: string): FieldDefinition {
  return {
    key,
    label: `${label} (seconds)`,
    description: `Upper bound for ${label.toLowerCase()} during workspace preparation.`,
    configType: 'number',
    placeholder,
    section: 'workspace_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  };
}
