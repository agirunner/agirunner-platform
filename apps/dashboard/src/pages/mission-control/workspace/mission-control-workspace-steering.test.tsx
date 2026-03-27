import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type {
  DashboardMissionControlActionAvailability,
  DashboardMissionControlPacket,
  DashboardWorkflowInputPacketRecord,
  DashboardWorkflowInterventionRecord,
  DashboardWorkflowSteeringMessageRecord,
} from '../../../lib/api.js';
import { MissionControlWorkspaceSteering } from './mission-control-workspace-steering.js';

describe('mission control workspace steering', () => {
  it('renders workflow quick actions, steering notes, operator attachments, and intervention history', () => {
    const client = new QueryClient();
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/mission-control']}>
          <MissionControlWorkspaceSteering
            workflowId="workflow-1"
            workflowName="Release Readiness"
            workflowState="failed"
            workspaceId="workspace-1"
            availableActions={buildAvailableActions()}
            interventionPackets={[
              buildPacket('packet-1', 'intervention', 'Operator redirected the release workflow'),
            ]}
            inputPackets={[
              {
                id: 'packet-1',
                workflow_id: 'workflow-1',
                work_item_id: null,
                packet_kind: 'launch',
                source: 'operator',
                summary: 'Initial launch files',
                structured_inputs: {},
                metadata: {},
                created_by_type: 'user',
                created_by_id: 'user-1',
                created_at: '2026-03-27T05:00:00.000Z',
                updated_at: '2026-03-27T05:00:00.000Z',
                files: [
                  {
                    id: 'file-1',
                    file_name: 'brief.md',
                    description: null,
                    content_type: 'text/markdown',
                    size_bytes: 128,
                    created_at: '2026-03-27T05:00:00.000Z',
                    download_url: '/api/v1/workflows/workflow-1/input-packets/packet-1/files/file-1/content',
                  },
                ],
              },
            ]}
            interventions={[
              {
                id: 'intervention-1',
                workflow_id: 'workflow-1',
                work_item_id: null,
                task_id: null,
                kind: 'steering_instruction',
                origin: 'mission_control',
                status: 'recorded',
                summary: 'Focus on the verification path first.',
                note: 'Use the rollback guide and verify the staging release before any deploy.',
                structured_action: {},
                metadata: {},
                created_by_type: 'user',
                created_by_id: 'user-1',
                created_at: '2026-03-27T05:00:00.000Z',
                updated_at: '2026-03-27T05:00:00.000Z',
                files: [],
              },
            ]}
            steeringMessages={[
              {
                id: 'message-1',
                workflow_id: 'workflow-1',
                steering_session_id: 'session-1',
                role: 'operator',
                content: 'Focus on the verification path first.',
                structured_proposal: {},
                intervention_id: 'intervention-1',
                created_by_type: 'user',
                created_by_id: 'user-1',
                created_at: '2026-03-27T05:00:00.000Z',
              },
            ]}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).toContain('Quick actions');
    expect(markup).toContain('Add work');
    expect(markup).toContain('Redrive workflow');
    expect(markup).toContain('Steering console');
    expect(markup).toContain('Focus on the verification path first.');
    expect(markup).toContain('brief.md');
    expect(markup).toContain('Intervention history');
  });
});

function buildAvailableActions(): DashboardMissionControlActionAvailability[] {
  return [
    {
      kind: 'pause_workflow',
      scope: 'workflow',
      enabled: true,
      confirmationLevel: 'immediate',
      stale: false,
      disabledReason: null,
    },
    {
      kind: 'add_work_item',
      scope: 'workflow',
      enabled: true,
      confirmationLevel: 'standard_confirm',
      stale: false,
      disabledReason: null,
    },
    {
      kind: 'redrive_workflow',
      scope: 'workflow',
      enabled: true,
      confirmationLevel: 'high_impact_confirm',
      stale: false,
      disabledReason: null,
    },
  ];
}

function buildPacket(
  id: string,
  category: DashboardMissionControlPacket['category'],
  title: string,
): DashboardMissionControlPacket {
  return {
    id,
    workflowId: 'workflow-1',
    workflowName: 'Release Readiness',
    posture: 'recoverable_needs_steering',
    category,
    title,
    summary: title,
    changedAt: '2026-03-27T05:00:00.000Z',
    carryover: true,
    outputDescriptors: [],
  };
}
