import { afterEach, describe, expect, it } from 'vitest';

import { metricsRegistry } from '../../../src/observability/metrics.js';
import { logSafetynetTriggered } from '../../../src/services/safetynet/logging.js';
import {
  PLATFORM_ACTIVATION_STALE_RECOVERY_ID,
  PLATFORM_APPROVAL_STALE_DECISION_SUPERSESSION_ID,
  PLATFORM_CONTINUITY_STALE_WRITE_SUPPRESSION_ID,
  PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
  PLATFORM_CONTROL_PLANE_NOT_READY_NOOP_RECOVERY_ID,
  PLATFORM_ORCHESTRATOR_EXPECTED_TASK_TYPE_INFERENCE_ID,
  PLATFORM_ORCHESTRATOR_PARENT_WORK_ITEM_DEFAULT_INFERENCE_ID,
  PLATFORM_HANDOFF_NORMALIZATION_AND_REPLAY_REPAIR_ID,
  PLATFORM_LOGGING_SECRET_REDACTION_ID,
  PLATFORM_ORCHESTRATOR_REWORK_ROUTE_INFERENCE_ID,
  PLATFORM_ORCHESTRATOR_STAGE_ALIGNMENT_REPAIR_ID,
  PLATFORM_ORCHESTRATOR_SUBJECT_LINKAGE_INFERENCE_ID,
  getSafetynetEntry,
  mustGetSafetynetEntry,
} from '../../../src/services/safetynet/registry.js';

describe('platform safetynet registry', () => {
  afterEach(() => {
    metricsRegistry.resetMetrics();
  });

  it('includes the expected platform entries', () => {
    const ids = [
      PLATFORM_ORCHESTRATOR_SUBJECT_LINKAGE_INFERENCE_ID,
      PLATFORM_ORCHESTRATOR_REWORK_ROUTE_INFERENCE_ID,
      PLATFORM_ORCHESTRATOR_PARENT_WORK_ITEM_DEFAULT_INFERENCE_ID,
      PLATFORM_ORCHESTRATOR_STAGE_ALIGNMENT_REPAIR_ID,
      PLATFORM_ORCHESTRATOR_EXPECTED_TASK_TYPE_INFERENCE_ID,
      PLATFORM_ACTIVATION_STALE_RECOVERY_ID,
      PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
      PLATFORM_CONTROL_PLANE_NOT_READY_NOOP_RECOVERY_ID,
      PLATFORM_HANDOFF_NORMALIZATION_AND_REPLAY_REPAIR_ID,
      PLATFORM_CONTINUITY_STALE_WRITE_SUPPRESSION_ID,
      PLATFORM_APPROVAL_STALE_DECISION_SUPERSESSION_ID,
      PLATFORM_LOGGING_SECRET_REDACTION_ID,
    ];

    for (const id of ids) {
      const entry = getSafetynetEntry(id);
      expect(entry).not.toBeNull();
      expect(entry?.kind).toBe('safetynet_behavior');
      expect(entry?.layer).toBe('platform');
      expect(entry?.name).toBeTruthy();
      expect(entry?.owner_module).toBeTruthy();
      expect(entry?.metrics_key).toContain(id);
      expect(entry?.log_event_type).toBe('platform.safetynet.triggered');
      expect(entry?.test_requirements.length).toBeGreaterThan(0);
    }
  });

  it('throws for unknown ids', () => {
    expect(() => mustGetSafetynetEntry('platform.unknown')).toThrow(
      "unknown platform safetynet entry 'platform.unknown'",
    );
  });

  it('increments the platform safetynet trigger counter when a safetynet is logged', async () => {
    const entry = mustGetSafetynetEntry(PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID);

    logSafetynetTriggered(entry, 'test trigger');
    logSafetynetTriggered(entry, 'test trigger');

    const metrics = await metricsRegistry.getMetricsAsJSON();
    const metric = metrics.find((candidate) => candidate.name === 'platform_safetynet_trigger_total');

    expect(metric).toBeDefined();
    expect(metric?.values).toContainEqual({
      value: 2,
      labels: { behavior: PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID },
    });
  });
});
