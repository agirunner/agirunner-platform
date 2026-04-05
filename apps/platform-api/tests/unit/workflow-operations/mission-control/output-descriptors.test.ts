import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { composeMissionControlOutputDescriptor } from '../../../../src/services/workflow-operations/mission-control/output-descriptors.js';

const hostOutputPath = resolve('exports/release-notes.md');

describe('mission control output descriptors', () => {
  it('maps artifacts into explicit artifact locations', () => {
    const descriptor = composeMissionControlOutputDescriptor({
      kind: 'artifact',
      id: 'output-1',
      artifactId: 'artifact-1',
      taskId: 'task-1',
      logicalPath: 'deliverables/spec.md',
      status: 'draft',
      recordedAt: '2026-04-04T08:20:00.000Z',
      contentType: 'text/markdown',
    });

    expect(descriptor).toEqual(
      expect.objectContaining({
        title: 'Spec',
        recordedAt: '2026-04-04T08:20:00.000Z',
        primaryLocation: expect.objectContaining({
          kind: 'artifact',
          artifactId: 'artifact-1',
          taskId: 'task-1',
          logicalPath: 'deliverables/spec.md',
          previewPath: '/api/v1/tasks/task-1/artifacts/artifact-1/preview',
          downloadPath: '/api/v1/tasks/task-1/artifacts/artifact-1',
          contentType: 'text/markdown',
        }),
      }),
    );
  });

  it('humanizes path-backed artifact titles even when the descriptor title echoes the logical path', () => {
    const descriptor = composeMissionControlOutputDescriptor({
      kind: 'artifact',
      id: 'output-1b',
      artifactId: 'artifact-1b',
      taskId: 'task-1b',
      logicalPath: 'artifact:workflow-1/deliverables/quantum-computer-source-review.md',
      title: 'artifact:workflow-1/deliverables/quantum-computer-source-review.md',
      status: 'final',
    });

    expect(descriptor.title).toBe('Quantum Computer Source Review');
  });

  it('prefers repository links as the primary typed location', () => {
    const descriptor = composeMissionControlOutputDescriptor({
      kind: 'repository',
      id: 'output-2',
      repository: 'git@example.com/repo.git',
      branch: 'feat/retry-flow',
      pullRequestUrl: 'https://example.test/pr/184',
      status: 'under_review',
      title: 'Retry-flow patch',
    });

    expect(descriptor.primaryLocation).toEqual({
      kind: 'repository',
      repository: 'git@example.com/repo.git',
      branch: 'feat/retry-flow',
      branchUrl: null,
      commitSha: null,
      commitUrl: null,
      pullRequestUrl: 'https://example.test/pr/184',
    });
  });

  it('maps host-directory outputs without pretending they are artifacts', () => {
    const descriptor = composeMissionControlOutputDescriptor({
      kind: 'host_directory',
      id: 'output-3',
      path: hostOutputPath,
      status: 'final',
    });

    expect(descriptor.primaryLocation).toEqual({
      kind: 'host_directory',
      path: hostOutputPath,
    });
  });

  it('maps workflow documents and external urls into explicit typed locations', () => {
    const documentDescriptor = composeMissionControlOutputDescriptor({
      kind: 'workflow_document',
      id: 'output-4',
      workflowId: 'workflow-1',
      documentId: 'document-1',
      logicalName: 'design-brief',
      title: 'Design brief',
      source: 'artifact',
      location: 'deliverables/design-brief.md',
      artifactId: 'artifact-2',
      status: 'approved',
    });

    const linkDescriptor = composeMissionControlOutputDescriptor({
      kind: 'external_url',
      id: 'output-5',
      url: 'https://example.test/releases/42',
      status: 'final',
    });

    expect(documentDescriptor.primaryLocation).toEqual({
      kind: 'workflow_document',
      workflowId: 'workflow-1',
      documentId: 'document-1',
      logicalName: 'design-brief',
      source: 'artifact',
      location: 'deliverables/design-brief.md',
      artifactId: 'artifact-2',
    });
    expect(documentDescriptor.title).toBe('Design brief');
    expect(linkDescriptor.primaryLocation).toEqual({
      kind: 'external_url',
      url: 'https://example.test/releases/42',
    });
  });

  it('keeps external document origins reachable as secondary output locations', () => {
    const descriptor = composeMissionControlOutputDescriptor({
      kind: 'workflow_document',
      id: 'output-6',
      workflowId: 'workflow-1',
      documentId: 'document-2',
      logicalName: 'release-brief',
      title: 'Release brief',
      source: 'external',
      location: 'https://example.test/release-brief',
      artifactId: null,
      status: 'approved',
    });

    expect(descriptor.secondaryLocations).toEqual([
      {
        kind: 'external_url',
        url: 'https://example.test/release-brief',
      },
    ]);
  });
});
