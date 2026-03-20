import type { FieldDefinition, SectionDefinition } from './runtime-defaults.types.js';

export const RUNTIME_OPERATION_SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    key: 'runtime_throughput',
    title: 'Runtime throughput',
    description:
      'Set local queue and parallelism limits for a specialist runtime process.',
  },
  {
    key: 'process_logging',
    title: 'Process logging',
    description: 'Control the runtime process log verbosity applied after platform config loads.',
  },
  {
    key: 'server_timeouts',
    title: 'Server timeouts',
    description: 'Bound runtime HTTP server shutdown and request-header handling.',
  },
  {
    key: 'runtime_api',
    title: 'Runtime API',
    description: 'Control task-event heartbeat cadence for active runtime API streams.',
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
    description:
      'Set the default timeout applied when newly created tasks do not specify one explicitly.',
  },
  {
    key: 'connected_platform',
    title: 'Connected platform',
    description:
      'Tune claim polling, bootstrap behavior, and manual drain handling when runtimes are attached to the platform fleet.',
  },
  {
    key: 'realtime_transport',
    title: 'Realtime transport',
    description:
      'Tune event-stream keepalives and worker websocket reconnect cadence for realtime platform connections.',
  },
  {
    key: 'workflow_activation',
    title: 'Workflow activation',
    description:
      'Control activation debounce, heartbeat wakeups, stale detection, and task-cancel grace timing.',
  },
  {
    key: 'container_manager',
    title: 'Container manager',
    description:
      'Control fleet reconcile cadence and stop/remove grace periods for the manager service.',
  },
  {
    key: 'worker_supervision',
    title: 'Worker supervision',
    description:
      'Tune worker heartbeat defaults, dispatch acknowledgements, and offline/disconnected thresholds.',
  },
  {
    key: 'agent_supervision',
    title: 'Agent supervision',
    description:
      'Tune standalone agent heartbeat defaults, stale-task grace periods, and issued agent key lifetimes.',
  },
  {
    key: 'webhook_delivery',
    title: 'Webhook delivery',
    description:
      'Tune webhook delivery retry budgets and backoff cadence for platform-controlled outbound events.',
  },
  {
    key: 'platform_loops',
    title: 'Platform loops',
    description:
      'Control the cadence of background platform enforcement, dispatch, pruning, and retention sweeps.',
  },
  {
    key: 'workspace_timeouts',
    title: 'Workspace timeouts',
    description:
      'Bound repo bootstrap, identity setup, and context injection steps before work begins.',
  },
  {
    key: 'workspace_operations',
    title: 'Workspace operations',
    description: 'Control clone retries, backoff timing, and automatic workspace snapshot cadence.',
  },
  {
    key: 'capture_timeouts',
    title: 'Capture resilience',
    description:
      'Control how aggressively the runtime retries result publication and how long capture-side steps may run.',
  },
  {
    key: 'secrets_timeouts',
    title: 'Secrets backends',
    description: 'Limit secret-provider calls made by the runtime during task execution.',
  },
  {
    key: 'subagent_timeouts',
    title: 'Subagents',
    description:
      'Set default timeout and fanout limits for delegated subagents spawned from a parent task.',
  },
];

export const RUNTIME_OPERATION_FIELD_DEFINITIONS: FieldDefinition[] = [
  ...buildRuntimeThroughputFields(),
  {
    key: 'log.level',
    label: 'Runtime log level',
    description: 'Verbosity for runtime process logs after connected configuration is applied.',
    configType: 'string',
    placeholder: 'info',
    section: 'process_logging',
    options: ['debug', 'info', 'warn', 'error'],
  },
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
    key: 'api.events_heartbeat_seconds',
    label: 'Event heartbeat interval (seconds)',
    description: 'How often the runtime emits task-event heartbeats while a stream is open.',
    configType: 'number',
    placeholder: '10',
    section: 'runtime_api',
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
    description:
      'Default timeout assigned to new tasks when the task payload does not provide one explicitly.',
    configType: 'number',
    placeholder: '30',
    section: 'task_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  ...buildConnectedPlatformFields(),
  ...buildRealtimeTransportFields(),
  ...buildWorkflowActivationFields(),
  ...buildContainerManagerFields(),
  ...buildWorkerSupervisionFields(),
  ...buildAgentSupervisionFields(),
  ...buildWebhookDeliveryFields(),
  ...buildPlatformLoopFields(),
  ...buildWorkspaceTimeoutFields(),
  ...buildWorkspaceOperationFields(),
  {
    key: 'capture.push_retries',
    label: 'Capture push retry budget',
    description:
      'How many times the runtime retries git push or result publication before giving up.',
    configType: 'number',
    placeholder: '3',
    section: 'capture_timeouts',
    inputMode: 'numeric',
    min: 0,
    step: 1,
  },
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
    description:
      'Upper bound for Vault reads and revocation calls when Vault-backed secrets are enabled.',
    configType: 'number',
    placeholder: '10',
    section: 'secrets_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'subagent.max_concurrent',
    label: 'Concurrent subagents per root task',
    description:
      'Maximum number of subagents that may run at the same time for one root task.',
    configType: 'number',
    placeholder: '3',
    section: 'subagent_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'subagent.max_total',
    label: 'Total subagents per root task',
    description:
      'Maximum number of subagents a root task may spawn before further delegation is rejected.',
    configType: 'number',
    placeholder: '10',
    section: 'subagent_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'subagent.max_depth',
    label: 'Subagent nesting depth',
    description:
      'Maximum allowed subagent depth. Set to 0 to block nested delegation entirely.',
    configType: 'number',
    placeholder: '1',
    section: 'subagent_timeouts',
    inputMode: 'numeric',
    min: 0,
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
      description:
        'Upper bound for establishing containerd connections when that provider is in use.',
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
      description:
        'Deadline for lifecycle health probes before the runtime marks the check as failed.',
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
        'How long the runtime waits before retrying a failed task-container health probe.',
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
        'How long the runtime waits when stopping a task container that never became healthy.',
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
      key: 'specialist_runtime_bootstrap_claim_timeout_seconds',
      label: 'Bootstrap claim timeout (seconds)',
      description:
        'How long a new generic specialist runtime waits for claimable work before it exits.',
      configType: 'number',
      placeholder: '30',
      section: 'connected_platform',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'specialist_runtime_drain_grace_seconds',
      label: 'Specialist runtime drain grace (seconds)',
      description:
        'Grace period used when a specialist runtime is explicitly drained or replaced.',
      configType: 'number',
      placeholder: '30',
      section: 'connected_platform',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
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
      key: 'platform.api_request_timeout_seconds',
      label: 'Platform API timeout (seconds)',
      description:
        'How long a connected runtime waits for platform API requests before treating them as failed.',
      configType: 'number',
      placeholder: '30',
      section: 'connected_platform',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'platform.log_ingest_timeout_seconds',
      label: 'Log ingest timeout (seconds)',
      description:
        'How long a connected runtime waits while flushing execution logs back to the platform ingest endpoint.',
      configType: 'number',
      placeholder: '10',
      section: 'connected_platform',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'platform.log_flush_interval_ms',
      label: 'Log flush interval (ms)',
      description:
        'How long a connected runtime buffers partial execution-log batches before flushing them to the platform ingest endpoint.',
      configType: 'number',
      placeholder: '500',
      section: 'connected_platform',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'platform.heartbeat_max_failures',
      label: 'Heartbeat failure budget',
      description:
        'How many consecutive heartbeat failures a connected runtime tolerates before self-termination.',
      configType: 'number',
      placeholder: '24',
      section: 'connected_platform',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'platform.cancellation_report_timeout_seconds',
      label: 'Cancellation report timeout (seconds)',
      description:
        'How long a connected runtime waits when reporting cancellation or shutdown outcomes back to the platform.',
      configType: 'number',
      placeholder: '10',
      section: 'connected_platform',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'platform.drain_timeout_seconds',
      label: 'Drain timeout (seconds)',
      description:
        'How long a draining connected runtime waits for in-flight work before forcing shutdown.',
      configType: 'number',
      placeholder: '600',
      section: 'connected_platform',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'platform.self_terminate_cleanup_timeout_seconds',
      label: 'Self-terminate cleanup timeout (seconds)',
      description:
        'How long a connected runtime waits while cleaning up managed task containers before self-termination.',
      configType: 'number',
      placeholder: '15',
      section: 'connected_platform',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
  ];
}

function buildRuntimeThroughputFields(): FieldDefinition[] {
  return [
    {
      key: 'queue.max_concurrency',
      label: 'Parallel task execution limit',
      description: 'Maximum number of tasks this runtime may execute at the same time.',
      configType: 'number',
      placeholder: '2',
      section: 'runtime_throughput',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'queue.max_depth',
      label: 'Queued task backlog limit',
      description:
        'Maximum number of accepted queued tasks before the runtime starts rejecting additional submissions.',
      configType: 'number',
      placeholder: '100',
      section: 'runtime_throughput',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
  ];
}

function buildRealtimeTransportFields(): FieldDefinition[] {
  return [
    {
      key: 'platform.event_stream_keepalive_interval_ms',
      label: 'Event stream keepalive (ms)',
      description:
        'How often the platform emits keepalive pings on open event streams and task event feeds.',
      configType: 'number',
      placeholder: '15000',
      section: 'realtime_transport',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
    },
    {
      key: 'platform.worker_reconnect_min_ms',
      label: 'Worker reconnect minimum (ms)',
      description:
        'Lower bound for exponential reconnect backoff offered to worker websocket clients.',
      configType: 'number',
      placeholder: '1000',
      section: 'realtime_transport',
      inputMode: 'numeric',
      min: 1,
      step: 100,
    },
    {
      key: 'platform.worker_reconnect_max_ms',
      label: 'Worker reconnect maximum (ms)',
      description:
        'Upper bound for exponential reconnect backoff offered to worker websocket clients.',
      configType: 'number',
      placeholder: '60000',
      section: 'realtime_transport',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
    },
    {
      key: 'platform.worker_websocket_ping_interval_ms',
      label: 'Worker websocket ping interval (ms)',
      description:
        'How often the platform pings idle worker websocket connections to keep them healthy.',
      configType: 'number',
      placeholder: '20000',
      section: 'realtime_transport',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
    },
  ];
}

function buildWorkspaceTimeoutFields(): FieldDefinition[] {
  return [
    workspaceTimeoutField('workspace.create_layout_timeout_seconds', 'Create layout timeout', '20'),
    workspaceTimeoutField(
      'workspace.inject_context_rename_timeout_seconds',
      'Context rename timeout',
      '10',
    ),
    workspaceTimeoutField('workspace.configure_git_timeout_seconds', 'Configure git timeout', '15'),
    workspaceTimeoutField('workspace.cleanup_git_timeout_seconds', 'Cleanup git timeout', '10'),
    workspaceTimeoutField(
      'workspace.configure_identity_timeout_seconds',
      'Configure identity timeout',
      '10',
    ),
    workspaceTimeoutField('workspace.clone_timeout_seconds', 'Clone timeout', '120'),
  ];
}

function buildWorkspaceOperationFields(): FieldDefinition[] {
  return [
    {
      key: 'workspace.clone_max_retries',
      label: 'Clone retry budget',
      description: 'How many times the runtime retries a workspace clone before failing the task.',
      configType: 'number',
      placeholder: '3',
      section: 'workspace_operations',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'workspace.clone_backoff_base_seconds',
      label: 'Clone backoff base (seconds)',
      description: 'Base backoff in seconds used between workspace clone retry attempts.',
      configType: 'number',
      placeholder: '1',
      section: 'workspace_operations',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'workspace.snapshot_interval',
      label: 'Snapshot interval (iterations)',
      description:
        'Automatic workspace snapshot cadence in engine iterations; set to 0 to disable snapshots.',
      configType: 'number',
      placeholder: '1',
      section: 'workspace_operations',
      inputMode: 'numeric',
      min: 0,
      step: 1,
    },
    {
      key: 'workspace.snapshot_max_per_task',
      label: 'Snapshots kept per task',
      description:
        'Maximum number of archived workspace snapshots retained for one task before older snapshots are pruned.',
      configType: 'number',
      placeholder: '10',
      section: 'workspace_operations',
      inputMode: 'numeric',
      min: 0,
      step: 1,
    },
  ];
}

function buildContainerManagerFields(): FieldDefinition[] {
  return [
    {
      key: 'container_manager.reconcile_interval_seconds',
      label: 'Reconcile interval (seconds)',
      description:
        'How often the container manager polls the shared fleet snapshot and runs a reconcile cycle.',
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
      description:
        'Grace period used when the manager stops runtime containers during normal cleanup.',
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
      description:
        'Extra headroom added around stop and remove calls so Docker operations can settle cleanly.',
      configType: 'number',
      placeholder: '15',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'container_manager.log_flush_interval_ms',
      label: 'Log flush interval (ms)',
      description:
        'How long the container manager buffers execution logs before flushing them to the platform ingest API.',
      configType: 'number',
      placeholder: '500',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'container_manager.docker_event_reconnect_backoff_ms',
      label: 'Docker event reconnect backoff (ms)',
      description:
        'How long the container manager waits before reconnecting after the Docker event stream disconnects.',
      configType: 'number',
      placeholder: '5000',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'container_manager.crash_log_capture_timeout_seconds',
      label: 'Crash log capture timeout (seconds)',
      description:
        'How long the container manager waits when capturing crash logs from a dead container.',
      configType: 'number',
      placeholder: '5',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'container_manager.starvation_threshold_seconds',
      label: 'Starvation threshold (seconds)',
      description:
        'How long pending work may wait without a runtime before the container manager boosts the target for starvation recovery.',
      configType: 'number',
      placeholder: '60',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'container_manager.runtime_orphan_grace_cycles',
      label: 'Runtime orphan grace cycles',
      description:
        'How many reconcile cycles a managed runtime may stay orphaned before the container manager force-removes it.',
      configType: 'number',
      placeholder: '3',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'container_manager.hung_runtime_stale_after_seconds',
      label: 'Hung runtime stale threshold (seconds)',
      description:
        'Maximum heartbeat age before the container manager classifies a runtime as hung.',
      configType: 'number',
      placeholder: '90',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'container_manager.hung_runtime_stop_grace_period_seconds',
      label: 'Hung runtime stop grace period (seconds)',
      description:
        'How long the container manager waits when stopping a runtime container that has been classified as hung.',
      configType: 'number',
      placeholder: '30',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
  ];
}

function buildWorkflowActivationFields(): FieldDefinition[] {
  return [
    {
      key: 'platform.workflow_activation_delay_ms',
      label: 'Activation delay (ms)',
      description:
        'How long non-immediate activation events wait before the orchestrator is eligible to dispatch.',
      configType: 'number',
      placeholder: '10000',
      section: 'workflow_activation',
      inputMode: 'numeric',
      min: 0,
      step: 1000,
    },
    {
      key: 'platform.workflow_activation_heartbeat_interval_ms',
      label: 'Heartbeat interval (ms)',
      description:
        'Minimum spacing between no-op watchdog heartbeat activations for the same workflow.',
      configType: 'number',
      placeholder: '900000',
      section: 'workflow_activation',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
    },
    {
      key: 'platform.workflow_activation_stale_after_ms',
      label: 'Stale activation threshold (ms)',
      description:
        'How long a processing activation can sit before recovery logic treats it as stale.',
      configType: 'number',
      placeholder: '300000',
      section: 'workflow_activation',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
    },
    {
      key: 'platform.task_cancel_signal_grace_period_ms',
      label: 'Task cancel grace period (ms)',
      description:
        'How long the platform waits after sending a cancel signal before force-failing or force-cancelling work.',
      configType: 'number',
      placeholder: '60000',
      section: 'workflow_activation',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
    },
  ];
}

function buildWorkerSupervisionFields(): FieldDefinition[] {
  return [
    {
      key: 'platform.worker_dispatch_ack_timeout_ms',
      label: 'Dispatch acknowledgement timeout (ms)',
      description:
        'Maximum time a worker has to acknowledge an assigned task before dispatch is released.',
      configType: 'number',
      placeholder: '15000',
      section: 'worker_supervision',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
    },
    {
      key: 'platform.worker_key_expiry_ms',
      label: 'Worker API key lifetime (ms)',
      description: 'Default lifetime applied to API keys issued for newly registered workers.',
      configType: 'number',
      placeholder: '31536000000',
      section: 'worker_supervision',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
    },
    {
      key: 'platform.worker_default_heartbeat_interval_seconds',
      label: 'Default worker heartbeat interval (seconds)',
      description:
        'Default heartbeat cadence assigned to new workers when the registration payload omits it.',
      configType: 'number',
      placeholder: '30',
      section: 'worker_supervision',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'platform.worker_offline_grace_period_ms',
      label: 'Offline grace period (ms)',
      description:
        'Additional grace after the offline threshold before the platform declares a worker fully offline.',
      configType: 'number',
      placeholder: '300000',
      section: 'worker_supervision',
      inputMode: 'numeric',
      min: 0,
      step: 1000,
    },
    {
      key: 'platform.worker_offline_threshold_multiplier',
      label: 'Offline threshold multiplier',
      description:
        'Multiplier applied to worker heartbeat intervals when deciding the offline cutoff.',
      configType: 'number',
      placeholder: '2',
      section: 'worker_supervision',
      inputMode: 'decimal',
      min: 1,
      step: 0.1,
    },
    {
      key: 'platform.worker_degraded_threshold_multiplier',
      label: 'Degraded threshold multiplier',
      description:
        'Multiplier applied to worker heartbeat intervals when deciding the degraded or disconnected cutoff.',
      configType: 'number',
      placeholder: '1',
      section: 'worker_supervision',
      inputMode: 'decimal',
      min: 1,
      step: 0.1,
    },
  ];
}

function buildAgentSupervisionFields(): FieldDefinition[] {
  return [
    {
      key: 'platform.agent_default_heartbeat_interval_seconds',
      label: 'Default agent heartbeat interval (seconds)',
      description:
        'Default heartbeat cadence assigned to new standalone agents when registration omits it.',
      configType: 'number',
      placeholder: '60',
      section: 'agent_supervision',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'platform.agent_heartbeat_grace_period_ms',
      label: 'Agent heartbeat grace period (ms)',
      description: 'Additional grace period before a stale standalone agent fails claimed work.',
      configType: 'number',
      placeholder: '300000',
      section: 'agent_supervision',
      inputMode: 'numeric',
      min: 0,
      step: 1000,
    },
    {
      key: 'platform.agent_heartbeat_threshold_multiplier',
      label: 'Agent heartbeat stale multiplier',
      description:
        'Multiplier applied to agent heartbeat intervals when deciding that a standalone agent is stale.',
      configType: 'number',
      placeholder: '2',
      section: 'agent_supervision',
      inputMode: 'decimal',
      min: 1,
      step: 0.1,
    },
    {
      key: 'platform.agent_key_expiry_ms',
      label: 'Agent API key lifetime (ms)',
      description:
        'Default lifetime applied to API keys issued for newly registered standalone agents.',
      configType: 'number',
      placeholder: '31536000000',
      section: 'agent_supervision',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
    },
  ];
}

function buildWebhookDeliveryFields(): FieldDefinition[] {
  return [
    {
      key: 'platform.webhook_max_attempts',
      label: 'Webhook max attempts',
      description:
        'Maximum number of attempts the platform makes before a webhook delivery is marked failed.',
      configType: 'number',
      placeholder: '4',
      section: 'webhook_delivery',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'platform.webhook_retry_base_delay_ms',
      label: 'Webhook retry base delay (ms)',
      description:
        'Base delay used for exponential backoff between webhook delivery retry attempts.',
      configType: 'number',
      placeholder: '200',
      section: 'webhook_delivery',
      inputMode: 'numeric',
      min: 1,
      step: 100,
    },
  ];
}

function buildPlatformLoopFields(): FieldDefinition[] {
  return [
    {
      key: 'platform.lifecycle_agent_heartbeat_check_interval_ms',
      label: 'Agent heartbeat sweep interval (ms)',
      description: 'How often the platform checks for stale agent heartbeats.',
      configType: 'number',
      placeholder: '15000',
      section: 'platform_loops',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
    },
    {
      key: 'platform.lifecycle_worker_heartbeat_check_interval_ms',
      label: 'Worker heartbeat sweep interval (ms)',
      description: 'How often the platform checks for stale worker heartbeats.',
      configType: 'number',
      placeholder: '15000',
      section: 'platform_loops',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
    },
    {
      key: 'platform.lifecycle_task_timeout_check_interval_ms',
      label: 'Task timeout sweep interval (ms)',
      description:
        'How often the platform enforces task timeouts and graceful workflow cancellation windows.',
      configType: 'number',
      placeholder: '60000',
      section: 'platform_loops',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
    },
    {
      key: 'platform.lifecycle_dispatch_loop_interval_ms',
      label: 'Dispatch loop interval (ms)',
      description:
        'How often the platform runs the ready-task and workflow-activation dispatch loop.',
      configType: 'number',
      placeholder: '2000',
      section: 'platform_loops',
      inputMode: 'numeric',
      min: 1,
      step: 100,
    },
    {
      key: 'platform.heartbeat_prune_interval_ms',
      label: 'Heartbeat prune interval (ms)',
      description: 'How often stale fleet heartbeat rows are pruned from platform state.',
      configType: 'number',
      placeholder: '60000',
      section: 'platform_loops',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
    },
    {
      key: 'platform.governance_retention_job_interval_ms',
      label: 'Retention sweep interval (ms)',
      description:
        'How often the platform runs governance retention and log-partition maintenance.',
      configType: 'number',
      placeholder: '3600000',
      section: 'platform_loops',
      inputMode: 'numeric',
      min: 1000,
      step: 1000,
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
