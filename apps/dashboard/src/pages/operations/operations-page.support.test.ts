import { describe, expect, it } from 'vitest';

import {
  OPERATIONS_FIELD_DEFINITIONS,
  OPERATIONS_SECTION_DEFINITIONS,
  fieldsForSection,
} from '../runtimes/runtime-defaults.schema.js';

describe('operations page support', () => {
  it('moves platform-owned timing and supervision settings onto the operations surface', () => {
    expect(OPERATIONS_SECTION_DEFINITIONS.map((section) => section.key)).toEqual([
      'task_timeouts',
      'runtime_fleet',
      'connected_platform',
      'workflow_activation',
      'worker_supervision',
      'agent_supervision',
      'container_manager',
      'realtime_transport',
      'platform_loops',
    ]);

    expect(fieldsForSection('task_timeouts', OPERATIONS_FIELD_DEFINITIONS).map((field) => field.key)).toEqual([
      'tasks.default_timeout_minutes',
    ]);
    expect(fieldsForSection('runtime_fleet', OPERATIONS_FIELD_DEFINITIONS).map((field) => field.key)).toEqual([
      'specialist_runtime_drain_grace_seconds',
    ]);
    expect(
      fieldsForSection('connected_platform', OPERATIONS_FIELD_DEFINITIONS).map((field) => field.key),
    ).toEqual(
      expect.arrayContaining([
        'platform.api_request_timeout_seconds',
        'platform.log_ingest_timeout_seconds',
        'platform.log_flush_interval_ms',
        'platform.drain_timeout_seconds',
        'platform.self_terminate_cleanup_timeout_seconds',
      ]),
    );
    expect(
      fieldsForSection('workflow_activation', OPERATIONS_FIELD_DEFINITIONS).map((field) => field.key),
    ).toEqual(
      expect.arrayContaining([
        'platform.workflow_activation_delay_ms',
        'platform.workflow_activation_heartbeat_interval_ms',
        'platform.workflow_activation_stale_after_ms',
      ]),
    );
    expect(
      fieldsForSection('container_manager', OPERATIONS_FIELD_DEFINITIONS).map((field) => field.key),
    ).toEqual(
      expect.arrayContaining([
        'container_manager.reconcile_interval_seconds',
        'container_manager.stop_timeout_seconds',
      ]),
    );
  });

  it('surfaces the scale-oriented default placeholders for operations tuning', () => {
    const taskTimeoutField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'tasks.default_timeout_minutes',
    );
    const drainGraceField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'specialist_runtime_drain_grace_seconds',
    );
    const staleActivationField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'platform.workflow_activation_stale_after_ms',
    );
    const cancelGraceField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'platform.task_cancel_signal_grace_period_ms',
    );
    const dispatchAckField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'platform.worker_dispatch_ack_timeout_ms',
    );
    const apiTimeoutField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'platform.api_request_timeout_seconds',
    );
    const logIngestField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'platform.log_ingest_timeout_seconds',
    );
    const logFlushField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'platform.log_flush_interval_ms',
    );
    const drainTimeoutField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'platform.drain_timeout_seconds',
    );
    const cleanupTimeoutField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'platform.self_terminate_cleanup_timeout_seconds',
    );
    const agentSweepField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'platform.lifecycle_agent_heartbeat_check_interval_ms',
    );
    const workerSweepField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'platform.lifecycle_worker_heartbeat_check_interval_ms',
    );
    const heartbeatPruneField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'platform.heartbeat_prune_interval_ms',
    );
    const retentionField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'platform.governance_retention_job_interval_ms',
    );
    const reconcileField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'container_manager.reconcile_interval_seconds',
    );
    const managerStopField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'container_manager.stop_timeout_seconds',
    );
    const shutdownTaskField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'container_manager.shutdown_task_stop_timeout_seconds',
    );
    const bufferField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'container_manager.docker_action_buffer_seconds',
    );
    const managerLogFlushField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'container_manager.log_flush_interval_ms',
    );
    const starvationField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'container_manager.starvation_threshold_seconds',
    );
    const orphanField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'container_manager.runtime_orphan_grace_cycles',
    );
    const hungStaleField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'container_manager.hung_runtime_stale_after_seconds',
    );
    const hungStopField = OPERATIONS_FIELD_DEFINITIONS.find(
      (field) => field.key === 'container_manager.hung_runtime_stop_grace_period_seconds',
    );

    expect(taskTimeoutField).toMatchObject({ placeholder: '180' });
    expect(drainGraceField).toMatchObject({ placeholder: '120' });
    expect(staleActivationField).toMatchObject({ placeholder: '900000' });
    expect(cancelGraceField).toMatchObject({ placeholder: '180000' });
    expect(dispatchAckField).toMatchObject({ placeholder: '45000' });
    expect(apiTimeoutField).toMatchObject({ placeholder: '60' });
    expect(logIngestField).toMatchObject({ placeholder: '30' });
    expect(logFlushField).toMatchObject({ placeholder: '2000' });
    expect(drainTimeoutField).toMatchObject({ placeholder: '1800' });
    expect(cleanupTimeoutField).toMatchObject({ placeholder: '60' });
    expect(agentSweepField).toMatchObject({ placeholder: '30000' });
    expect(workerSweepField).toMatchObject({ placeholder: '30000' });
    expect(heartbeatPruneField).toMatchObject({ placeholder: '300000' });
    expect(retentionField).toMatchObject({ placeholder: '21600000' });
    expect(reconcileField).toMatchObject({ placeholder: '10' });
    expect(managerStopField).toMatchObject({ placeholder: '60' });
    expect(shutdownTaskField).toMatchObject({ placeholder: '10' });
    expect(bufferField).toMatchObject({ placeholder: '30' });
    expect(managerLogFlushField).toMatchObject({ placeholder: '2000' });
    expect(starvationField).toMatchObject({ placeholder: '180' });
    expect(orphanField).toMatchObject({ placeholder: '6' });
    expect(hungStaleField).toMatchObject({ placeholder: '180' });
    expect(hungStopField).toMatchObject({ placeholder: '60' });
  });

  it('keeps dead timeout and webhook defaults off the operations surface', () => {
    expect(OPERATIONS_FIELD_DEFINITIONS.map((field) => field.key)).not.toEqual(
      expect.arrayContaining([
        'docker.checker_timeout_ms',
        'docker.stop_timeout_seconds',
        'container.copy_timeout_seconds',
        'containerd.connect_timeout_seconds',
        'workspace.inject_context_rename_timeout_seconds',
        'platform.webhook_max_attempts',
        'platform.webhook_retry_base_delay_ms',
      ]),
    );
  });
});
