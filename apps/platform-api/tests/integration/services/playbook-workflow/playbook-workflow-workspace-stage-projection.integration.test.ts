import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MissionControlLiveService } from '../../../../src/services/workflow-operations/mission-control/live-service.js';
import { WorkflowRailService } from '../../../../src/services/workflow-operations/workflow-rail-service.js';
import { WorkflowWorkspaceService } from '../../../../src/services/workflow-operations/workflow-workspace-service.js';
import { TEST_IDENTITY as identity } from '../workflow-runtime/v2-harness.js';
import {
  setupPlaybookWorkflowIntegrationSuite,
  type PlaybookWorkflowIntegrationSuite,
} from './playbook-workflow.integration.setup.js';

let suite: PlaybookWorkflowIntegrationSuite;

beforeAll(async () => {
  suite = await setupPlaybookWorkflowIntegrationSuite();
}, 120_000);

afterAll(async () => {
  await suite.cleanup();
});

describe('playbook workflow workspace stage projection', () => {
  it('surfaces the active planned stage through the rail card and workspace packet', async (context) => {
    if (!suite.canRunIntegration) {
      context.skip();
    }

    const harness = suite.harness!;
    const playbook = await harness.playbookService.createPlaybook(identity.tenantId, {
      name: 'Hotfix Workspace Projection',
      outcome: 'Track the active planned stage through workspace views',
      definition: {
        roles: ['developer'],
        lifecycle: 'planned',
        stages: [
          { name: 'triage', goal: 'Bound the incident.' },
          { name: 'implement', goal: 'Produce the hotfix.' },
          { name: 'close', goal: 'Record the final state.' },
        ],
      },
    });

    const workflow = await harness.workflowService.createWorkflow(identity, {
      playbook_id: String(playbook.id),
      name: 'Hotfix Workspace Projection Run',
    });

    await harness.workflowService.createWorkflowWorkItem(identity, String(workflow.id), {
      request_id: 'workspace-stage-implement',
      title: 'Implement the hotfix',
      stage_name: 'implement',
      column_id: 'active',
    });

    const board = await harness.workflowService.getWorkflowBoard(identity.tenantId, String(workflow.id));
    expect(board.active_stages).toEqual(['implement']);

    const liveService = new MissionControlLiveService(suite.db!.pool);
    const railService = new WorkflowRailService(
      liveService,
      { getRecent: async () => ({ version: { generatedAt: new Date().toISOString(), latestEventId: null, token: 'recent:empty' }, packets: [] }) },
      { getHistory: async () => ({ version: { generatedAt: new Date().toISOString(), latestEventId: null, token: 'history:empty' }, packets: [] }) },
    );
    const workspaceService = new WorkflowWorkspaceService(
      harness.workflowService as never,
      railService,
      {
        getLiveConsole: async () => ({
          snapshot_version: 'workflow-operations:1',
          generated_at: new Date().toISOString(),
          latest_event_id: 1,
          items: [],
          total_count: 0,
          next_cursor: null,
          live_visibility_mode: 'enhanced',
        }),
      } as never,
      {
        getHistory: async () => ({
          snapshot_version: 'workflow-operations:1',
          generated_at: new Date().toISOString(),
          latest_event_id: 1,
          groups: [],
          items: [],
          total_count: 0,
          filters: { available: [], active: [] },
          next_cursor: null,
        }),
      } as never,
      {
        getDeliverables: async () => ({
          final_deliverables: [],
          in_progress_deliverables: [],
          working_handoffs: [],
          inputs_and_provenance: {
            launch_packet: null,
            supplemental_packets: [],
            intervention_attachments: [],
            redrive_packet: null,
          },
          next_cursor: null,
          all_deliverables: [],
        }),
      } as never,
      { listWorkflowInterventions: async () => [] } as never,
      { listSessions: async () => [], listMessages: async () => [] } as never,
      undefined,
      undefined,
      {
        getBriefs: async () => ({
          snapshot_version: 'workflow-operations:1',
          generated_at: new Date().toISOString(),
          latest_event_id: 1,
          items: [],
          total_count: 0,
          next_cursor: null,
        }),
      } as never,
    );

    const workflowCard = await railService.getWorkflowCard(identity.tenantId, String(workflow.id));
    expect(workflowCard?.currentStage).toBe('implement');

    const workspace = await workspaceService.getWorkspace(identity.tenantId, String(workflow.id), {
      tabScope: 'workflow',
    });
    expect(workspace.workflow?.currentStage).toBe('implement');
  }, 120_000);
});
