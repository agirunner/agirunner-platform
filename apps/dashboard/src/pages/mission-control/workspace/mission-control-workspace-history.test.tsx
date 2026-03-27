import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { DashboardMissionControlPacket } from '../../../lib/api.js';
import { MissionControlWorkspaceHistory } from './mission-control-workspace-history.js';

describe('mission control workspace history', () => {
  it('renders decision and progress packets with carryover, timestamps, and output cues', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/mission-control']}>
        <MissionControlWorkspaceHistory
          workflowId="workflow-1"
          packets={[
            buildPacket('packet-1', 'decision', 'Operator approved launch gate', true),
            buildPacket('packet-2', 'progress', 'Reviewer finished checklist', false),
          ]}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain('Operator approved launch gate');
    expect(markup).toContain('Carryover');
    expect(markup).toContain('Decision');
    expect(markup).toContain('Reviewer finished checklist');
    expect(markup).toContain('Release brief');
    expect(markup).toContain('Open full workflow');
  });
});

function buildPacket(
  id: string,
  category: DashboardMissionControlPacket['category'],
  title: string,
  carryover: boolean,
): DashboardMissionControlPacket {
  return {
    id,
    workflowId: 'workflow-1',
    workflowName: 'Release Readiness',
    posture: 'needs_decision',
    category,
    title,
    summary: `${title} summary`,
    changedAt: '2026-03-27T05:00:00.000Z',
    carryover,
    outputDescriptors: [
      {
        id: 'output-1',
        title: 'Release brief',
        summary: 'Updated with launch-readiness callouts.',
        status: 'under_review',
        producedByRole: 'reviewer',
        workItemId: 'work-item-1',
        taskId: 'task-1',
        stageName: 'validation',
        primaryLocation: {
          kind: 'artifact',
          artifactId: 'artifact-1',
          taskId: 'task-1',
          logicalPath: 'artifacts/release-brief.md',
          previewPath: '/artifacts/artifact-1/preview',
          downloadPath: '/artifacts/artifact-1/download',
          contentType: 'text/markdown',
        },
        secondaryLocations: [],
      },
    ],
  };
}
