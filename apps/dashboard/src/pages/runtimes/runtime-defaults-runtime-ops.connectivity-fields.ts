import type { FieldDefinition } from './runtime-defaults.types.js';

export const RUNTIME_OPERATION_CONNECTIVITY_FIELDS: FieldDefinition[] = [
  ...buildConnectedPlatformFields(),
  ...buildRealtimeTransportFields(),
  ...buildWorkflowActivationFields(),
];

function buildConnectedPlatformFields(): FieldDefinition[] {
  return [
    {
      key: 'specialist_runtime_bootstrap_claim_timeout_seconds',
      label: 'Bootstrap claim timeout (seconds)',
      description: 'How long a new specialist agent waits for claimable work before it exits.',
      configType: 'number',
      placeholder: '60',
      section: 'connected_platform',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'specialist_runtime_drain_grace_seconds',
      label: 'Specialist agent drain grace (seconds)',
      description: 'Grace period used when a specialist agent is explicitly drained or replaced.',
      configType: 'number',
      placeholder: '120',
      section: 'connected_platform',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'platform.claim_poll_seconds',
      label: 'Claim poll interval (seconds)',
      description:
        'How often a connected specialist agent polls the platform for newly claimable work.',
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
        'How long a connected specialist agent waits for platform API requests before treating them as failed.',
      configType: 'number',
      placeholder: '60',
      section: 'connected_platform',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'platform.log_ingest_timeout_seconds',
      label: 'Log ingest timeout (seconds)',
      description:
        'How long a connected specialist agent waits while flushing execution logs back to the platform ingest endpoint.',
      configType: 'number',
      placeholder: '30',
      section: 'connected_platform',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'platform.log_flush_interval_ms',
      label: 'Log flush interval (ms)',
      description:
        'How long a connected specialist agent buffers partial execution-log batches before flushing them to the platform ingest endpoint.',
      configType: 'number',
      placeholder: '2000',
      section: 'connected_platform',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'platform.heartbeat_max_failures',
      label: 'Heartbeat failure budget',
      description:
        'How many consecutive heartbeat failures a connected specialist agent tolerates before self-termination.',
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
        'How long a connected specialist agent waits when reporting cancellation or shutdown outcomes back to the platform.',
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
        'How long a draining specialist agent waits for in-flight work before forcing shutdown.',
      configType: 'number',
      placeholder: '1800',
      section: 'connected_platform',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'platform.self_terminate_cleanup_timeout_seconds',
      label: 'Self-terminate cleanup timeout (seconds)',
      description:
        'How long a connected specialist agent waits while cleaning up managed specialist executions before self-termination.',
      configType: 'number',
      placeholder: '60',
      section: 'connected_platform',
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
      label: 'Agent reconnect minimum (ms)',
      description:
        'Lower bound for exponential reconnect backoff offered to agent websocket clients.',
      configType: 'number',
      placeholder: '1000',
      section: 'realtime_transport',
      inputMode: 'numeric',
      min: 1,
      step: 100,
    },
    {
      key: 'platform.worker_reconnect_max_ms',
      label: 'Agent reconnect maximum (ms)',
      description:
        'Upper bound for exponential reconnect backoff offered to agent websocket clients.',
      configType: 'number',
      placeholder: '60000',
      section: 'realtime_transport',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
    },
    {
      key: 'platform.worker_websocket_ping_interval_ms',
      label: 'Agent websocket ping interval (ms)',
      description:
        'How often the platform pings idle agent websocket connections to keep them healthy.',
      configType: 'number',
      placeholder: '20000',
      section: 'realtime_transport',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
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
      placeholder: '1800000',
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
      placeholder: '900000',
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
      placeholder: '180000',
      section: 'workflow_activation',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
    },
  ];
}
