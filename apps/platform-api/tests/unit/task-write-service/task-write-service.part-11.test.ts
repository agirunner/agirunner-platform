import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildTaskWriteService,
  createApiKeyIdentity,
  isLinkedWorkItemLookup,
  isPlaybookDefinitionLookup,
  resetTaskWriteServiceMocks,
  ValidationError,
} from './task-write-service-test-support.js';

describe('TaskWriteService recoverable create-task guidance', () => {
  beforeEach(() => {
    resetTaskWriteServiceMocks();
    vi.restoreAllMocks();
  });

  it('attaches recoverable guidance details when a planned-stage role is not defined in the playbook', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{
              workflow_id: 'workflow-1',
              stage_name: 'approval-gate',
              workflow_lifecycle: 'planned',
              stage_status: 'active',
              stage_gate_status: 'changes_requested',
              owner_role: 'rework-technical-editor',
              next_expected_actor: null,
              next_expected_action: null,
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{
              definition: {
                process_instructions: 'A human review gate decides after the technical editor prepares the packet.',
                roles: ['rework-product-strategist', 'rework-technical-editor', 'rework-launch-planner'],
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                  entry_column_id: 'planned',
                },
                stages: [
                  { name: 'approval-gate', goal: 'A human decision exists for the brief.', involves: [] },
                ],
                lifecycle: 'planned',
              },
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const { service } = buildTaskWriteService({ pool: pool as never });

    let thrown: unknown;
    try {
      await service.createTask(
        createApiKeyIdentity(),
        {
          title: 'Record the human gate decision',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          request_id: 'undefined-human-gate-role-1',
          role: 'human-review-gate',
          stage_name: 'approval-gate',
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ValidationError);
    const details = (thrown as InstanceType<typeof ValidationError>).details;
    expect(details).toMatchObject({
      recovery_hint: 'orchestrator_guided_recovery',
      reason_code: 'role_not_defined_in_playbook',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      requested_role: 'human-review-gate',
      linked_work_item_stage_name: 'approval-gate',
      defined_roles: [
        'rework-product-strategist',
        'rework-technical-editor',
        'rework-launch-planner',
      ],
    });
  });

  it('attaches recoverable guidance details when continuity expects a different actor', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{
              workflow_id: 'workflow-1',
              stage_name: 'review',
              workflow_lifecycle: 'planned',
              stage_status: 'active',
              stage_gate_status: 'not_requested',
              owner_role: 'live-test-reviewer',
              next_expected_actor: 'live-test-reviewer',
              next_expected_action: 'assess',
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{
              definition: {
                process_instructions: 'Reviewer assesses before QA validates.',
                roles: ['live-test-reviewer', 'live-test-qa'],
                board: {
                  columns: [
                    { id: 'review', label: 'Review' },
                    { id: 'verification', label: 'Verification' },
                  ],
                  entry_column_id: 'review',
                },
                stages: [
                  { name: 'review', goal: 'Review the implementation.', involves: ['live-test-reviewer'] },
                  { name: 'verification', goal: 'Validate the change.', involves: ['live-test-qa'] },
                ],
                lifecycle: 'planned',
              },
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const { service } = buildTaskWriteService({ pool: pool as never });

    let thrown: unknown;
    try {
      await service.createTask(
        createApiKeyIdentity(),
        {
          title: 'Run QA early',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          request_id: 'qa-too-early-1',
          role: 'live-test-qa',
          stage_name: 'review',
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ValidationError);
    const details = (thrown as InstanceType<typeof ValidationError>).details;
    expect(details).toMatchObject({
      recovery_hint: 'orchestrator_guided_recovery',
      reason_code: 'role_routes_to_successor_stage',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      requested_role: 'live-test-qa',
      linked_work_item_stage_name: 'review',
      successor_stage_name: 'verification',
      next_expected_actor: 'live-test-reviewer',
      next_expected_action: 'assess',
    });
  });
});
