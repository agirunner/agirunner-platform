import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: vi.fn(),
}));

import { ValidationError } from '../../../../../src/errors/domain-errors.js';
import { buildUnconfiguredGateApprovalAdvisory } from '../../../../../src/api/routes/orchestrator-control/recoverable-mutations.js';
import { logSafetynetTriggered } from '../../../../../src/services/safetynet/logging.js';
import { PLATFORM_CONTROL_PLANE_UNCONFIGURED_GATE_ADVISORY_ID, mustGetSafetynetEntry } from '../../../../../src/services/safetynet/registry.js';

const UNCONFIGURED_GATE_ADVISORY_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_CONTROL_PLANE_UNCONFIGURED_GATE_ADVISORY_ID,
);

describe('buildUnconfiguredGateApprovalAdvisory', () => {
  it('tags and logs the recoverable advisory with the unconfigured-gate safetynet', async () => {
    const client = {};
    const app = {
      eventService: {
        emit: vi.fn(async () => undefined),
      },
    };

    const response = await buildUnconfiguredGateApprovalAdvisory(
      app as never,
      {
        tenantId: 'tenant-1',
        scope: 'agent',
        keyPrefix: 'agent-key',
      } as never,
      {
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        stage_name: 'draft-package',
      } as never,
      'operator-approval',
      {
        summary: 'Need human approval before release',
      } as never,
      client as never,
      new ValidationError("Stage 'operator-approval' does not require a human gate"),
    );

    expect(response).toMatchObject({
      advisory: true,
      reason_code: 'approval_not_configured',
      recovery_class: 'approval_not_configured',
      safetynet_behavior_id: UNCONFIGURED_GATE_ADVISORY_SAFETYNET.id,
      stage_name: 'operator-approval',
      task_id: 'task-orchestrator',
      work_item_id: 'work-item-1',
      workflow_id: 'workflow-1',
    });
    expect(logSafetynetTriggered).toHaveBeenCalledWith(
      UNCONFIGURED_GATE_ADVISORY_SAFETYNET,
      'recoverable gate approval advisory returned because the stage has no configured human gate',
      {
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        task_id: 'task-orchestrator',
        stage_name: 'operator-approval',
        reason_code: 'approval_not_configured',
      },
    );
    expect(app.eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.advisory_recorded',
        entityType: 'workflow',
        entityId: 'workflow-1',
        data: expect.objectContaining({
          safetynet_behavior_id: UNCONFIGURED_GATE_ADVISORY_SAFETYNET.id,
        }),
      }),
      client,
    );
  });
});
