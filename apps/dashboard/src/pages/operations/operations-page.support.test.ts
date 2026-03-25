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
