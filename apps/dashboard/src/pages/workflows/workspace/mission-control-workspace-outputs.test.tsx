import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type {
  DashboardMissionControlOutputDescriptor,
  DashboardMissionControlPacket,
} from '../../../lib/api.js';
import { MissionControlWorkspaceOutputs } from './mission-control-workspace-outputs.js';

describe('mission control workspace outputs', () => {
  it('renders deliverables and live output packets with canonical location links', () => {
    const deliverable = buildOutputDescriptor();
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/mission-control']}>
        <MissionControlWorkspaceOutputs
          deliverables={[deliverable]}
          feed={[buildOutputPacket(deliverable)]}
          initialDetailMode="summary"
        />
      </MemoryRouter>,
    );

    expect(markup).toContain('Deliverables');
    expect(markup).toContain('Release brief');
    expect(markup).toContain('under review');
    expect(markup).toContain('Preview artifact');
    expect(markup).toContain('/artifacts/artifact-1/preview');
    expect(markup).toContain('Pull request');
    expect(markup).toContain('https://example.test/pr');
    expect(markup).toContain('Live output feed');
    expect(markup).toContain('Release brief updated');
  });

  it('supports richer operational and forensic detail modes without falling back to raw artifact inference', () => {
    const deliverable = buildOutputDescriptor();
    const operationalMarkup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/mission-control']}>
        <MissionControlWorkspaceOutputs
          deliverables={[deliverable]}
          feed={[buildOutputPacket(deliverable)]}
          initialDetailMode="operational"
        />
      </MemoryRouter>,
    );
    const forensicMarkup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/mission-control']}>
        <MissionControlWorkspaceOutputs
          deliverables={[deliverable]}
          feed={[buildOutputPacket(deliverable)]}
          initialDetailMode="forensic"
        />
      </MemoryRouter>,
    );

    expect(operationalMarkup).toContain('Produced by reviewer');
    expect(operationalMarkup).toContain('Validation');
    expect(forensicMarkup).toContain('Packet id packet-output-1');
    expect(forensicMarkup).toContain('Output descriptor count 1');
  });
});

function buildOutputDescriptor(): DashboardMissionControlOutputDescriptor {
  return {
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
    secondaryLocations: [
      {
        kind: 'repository',
        repository: 'agirunner/ship',
        branch: 'feat/release-brief',
        branchUrl: 'https://example.test/branch',
        commitSha: 'abc1234',
        commitUrl: 'https://example.test/commit',
        pullRequestUrl: 'https://example.test/pr',
      },
    ],
  };
}

function buildOutputPacket(
  deliverable: DashboardMissionControlOutputDescriptor,
): DashboardMissionControlPacket {
  return {
    id: 'packet-output-1',
    workflowId: 'workflow-1',
    workflowName: 'Release Readiness',
    posture: 'needs_decision',
    category: 'output',
    title: 'Release brief updated',
    summary: 'Reviewer refreshed the brief with launch callouts.',
    changedAt: '2026-03-27T05:00:00.000Z',
    carryover: false,
    outputDescriptors: [deliverable],
  };
}
