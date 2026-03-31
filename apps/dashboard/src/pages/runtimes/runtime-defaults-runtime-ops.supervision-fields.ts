import type { FieldDefinition } from './runtime-defaults.types.js';

export const RUNTIME_OPERATION_SUPERVISION_FIELDS: FieldDefinition[] = [
  ...buildContainerManagerFields(),
  ...buildWorkerSupervisionFields(),
  ...buildAgentSupervisionFields(),
  ...buildPlatformLoopFields(),
];

function buildContainerManagerFields(): FieldDefinition[] {
  return [
    {
      key: 'container_manager.reconcile_interval_seconds',
      label: 'Reconcile interval (seconds)',
      description:
        'How often the container manager polls the shared fleet snapshot and runs a reconcile cycle.',
      configType: 'number',
      placeholder: '10',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'container_manager.stop_timeout_seconds',
      label: 'Specialist agent stop timeout (seconds)',
      description:
        'Grace period used when the manager stops specialist agents during normal cleanup.',
      configType: 'number',
      placeholder: '60',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'container_manager.shutdown_task_stop_timeout_seconds',
      label: 'Shutdown execution stop timeout (seconds)',
      description: 'Grace period used for specialist executions during manager shutdown cleanup.',
      configType: 'number',
      placeholder: '10',
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
      placeholder: '30',
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
      placeholder: '2000',
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
        'How long pending work may wait without a specialist agent before the container manager boosts the target for starvation recovery.',
      configType: 'number',
      placeholder: '180',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'container_manager.runtime_orphan_grace_cycles',
      label: 'Specialist agent orphan grace cycles',
      description:
        'How many reconcile cycles a managed specialist agent may stay orphaned before the container manager force-removes it.',
      configType: 'number',
      placeholder: '6',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'container_manager.hung_runtime_stale_after_seconds',
      label: 'Hung specialist agent stale threshold (seconds)',
      description:
        'Maximum heartbeat age before the container manager classifies a specialist agent as hung.',
      configType: 'number',
      placeholder: '180',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'container_manager.hung_runtime_stop_grace_period_seconds',
      label: 'Hung specialist agent stop grace period (seconds)',
      description:
        'How long the container manager waits when stopping a specialist agent that has been classified as hung.',
      configType: 'number',
      placeholder: '60',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'container_manager.runtime_log_max_size_mb',
      label: 'Specialist agent log max size (MB)',
      description:
        'Maximum size of a specialist agent Docker log file before the Docker engine rotates it.',
      configType: 'number',
      placeholder: '10',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'container_manager.runtime_log_max_files',
      label: 'Specialist agent log file count',
      description: 'Maximum number of rotated Docker log files retained for each specialist agent.',
      configType: 'number',
      placeholder: '3',
      section: 'container_manager',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
  ];
}

function buildWorkerSupervisionFields(): FieldDefinition[] {
  return [
    {
      key: 'platform.worker_dispatch_ack_timeout_ms',
      label: 'Dispatch acknowledgement timeout (ms)',
      description:
        'Maximum time a specialist agent has to acknowledge an assigned task before dispatch is released.',
      configType: 'number',
      placeholder: '45000',
      section: 'worker_supervision',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
    },
    {
      key: 'platform.worker_key_expiry_ms',
      label: 'Specialist agent API key lifetime (ms)',
      description:
        'Default lifetime applied to API keys issued for newly registered specialist agents.',
      configType: 'number',
      placeholder: '31536000000',
      section: 'worker_supervision',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
    },
    {
      key: 'platform.worker_default_heartbeat_interval_seconds',
      label: 'Default specialist agent heartbeat interval (seconds)',
      description:
        'Default heartbeat cadence assigned to new specialist agents when the registration payload omits it.',
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
        'Additional grace after the offline threshold before the platform declares a specialist agent fully offline.',
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
        'Multiplier applied to specialist agent heartbeat intervals when deciding the offline cutoff.',
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
        'Multiplier applied to specialist agent heartbeat intervals when deciding the degraded or disconnected cutoff.',
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

function buildPlatformLoopFields(): FieldDefinition[] {
  return [
    {
      key: 'platform.lifecycle_agent_heartbeat_check_interval_ms',
      label: 'Agent heartbeat sweep interval (ms)',
      description: 'How often the platform checks for stale agent heartbeats.',
      configType: 'number',
      placeholder: '30000',
      section: 'platform_loops',
      inputMode: 'numeric',
      min: 1,
      step: 1000,
    },
    {
      key: 'platform.lifecycle_worker_heartbeat_check_interval_ms',
      label: 'Specialist agent heartbeat sweep interval (ms)',
      description: 'How often the platform checks for stale specialist agent heartbeats.',
      configType: 'number',
      placeholder: '30000',
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
      placeholder: '300000',
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
      placeholder: '300000',
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
      placeholder: '21600000',
      section: 'platform_loops',
      inputMode: 'numeric',
      min: 1000,
      step: 1000,
    },
  ];
}
