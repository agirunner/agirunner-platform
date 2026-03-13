import { describe, expect, it } from 'vitest';

import {
  buildProjectArtifactScopeChips,
  buildArtifactContentTypeOptions,
  buildArtifactStageOptions,
  buildProjectArtifactEntries,
  describeProjectArtifactNextAction,
  filterProjectArtifactEntries,
  formatArtifactFileSize,
  summarizeProjectArtifactEntries,
  type ProjectArtifactEntry,
} from './project-artifact-explorer-support.js';

describe('project artifact explorer support', () => {
  const entries = buildProjectArtifactEntries({
    workflows: [
      {
        id: 'workflow-1',
        name: 'Release board',
        state: 'active',
        createdAt: '2026-03-10T09:00:00.000Z',
      },
    ],
    tasks: [
      {
        id: 'task-1',
        workflowId: 'workflow-1',
        title: 'Build release notes',
        state: 'completed',
        stageName: 'delivery',
        workItemId: 'wi-1',
        activationId: null,
        role: 'writer',
        isOrchestratorTask: false,
      },
    ],
    workItems: [
      {
        id: 'wi-1',
        workflowId: 'workflow-1',
        title: 'Prepare release packet',
        stageName: 'delivery',
        columnId: 'done',
        priority: 'high',
        completedAt: null,
      },
    ],
    artifactsByTask: {
      'task-1': [
        {
          id: 'artifact-1',
          task_id: 'task-1',
          logical_path: 'artifacts/release-notes.md',
          content_type: 'text/markdown',
          size_bytes: 2048,
          checksum_sha256: 'abc',
          metadata: { audience: 'operators' },
          retention_policy: {},
          created_at: '2026-03-11T11:00:00.000Z',
          download_url: '/download/release-notes',
        },
      ],
    },
  });

  it('builds project-scoped artifact entries with workflow and work-item context', () => {
    expect(entries).toEqual([
      {
        id: 'task-1:artifact-1',
        artifactId: 'artifact-1',
        taskId: 'task-1',
        taskTitle: 'Build release notes',
        taskState: 'completed',
        workflowId: 'workflow-1',
        workflowName: 'Release board',
        workflowState: 'active',
        workItemId: 'wi-1',
        workItemTitle: 'Prepare release packet',
        stageName: 'delivery',
        role: 'writer',
        logicalPath: 'artifacts/release-notes.md',
        fileName: 'release-notes.md',
        contentType: 'text/markdown',
        sizeBytes: 2048,
        createdAt: '2026-03-11T11:00:00.000Z',
        downloadUrl: '/download/release-notes',
        metadata: { audience: 'operators' },
        previewKind: 'markdown',
        canPreview: true,
      },
    ]);
  });

  it('filters by scoped selectors, search text, dates, and sort order', () => {
    const combinedEntries: ProjectArtifactEntry[] = [
      ...entries,
      {
        ...entries[0],
        id: 'task-2:artifact-2',
        artifactId: 'artifact-2',
        taskId: 'task-2',
        taskTitle: 'Export changelog',
        contentType: 'application/json',
        logicalPath: 'exports/changelog.json',
        fileName: 'changelog.json',
        workItemId: 'wi-2',
        workItemTitle: 'Package release',
        stageName: 'review',
        sizeBytes: 512,
        createdAt: '2026-03-10T10:00:00.000Z',
        canPreview: true,
        previewKind: 'json',
      },
    ];

    expect(
      filterProjectArtifactEntries(combinedEntries, {
        query: 'changelog',
        workflowId: '',
        workItemId: '',
        taskId: '',
        stageName: '',
        contentType: '',
        createdFrom: '',
        createdTo: '',
        sort: 'newest',
      }),
    ).toEqual([combinedEntries[1]]);

    expect(
      filterProjectArtifactEntries(combinedEntries, {
        query: '',
        workflowId: '',
        workItemId: '',
        taskId: '',
        stageName: 'delivery',
        contentType: 'text/markdown',
        createdFrom: '2026-03-11',
        createdTo: '2026-03-11',
        sort: 'largest',
      }),
    ).toEqual([combinedEntries[0]]);
  });

  it('summarizes project artifact coverage and builds filter options', () => {
    const combinedEntries: ProjectArtifactEntry[] = [
      ...entries,
      {
        ...entries[0],
        id: 'task-2:artifact-2',
        artifactId: 'artifact-2',
        taskId: 'task-2',
        workItemId: null,
        workItemTitle: null,
        stageName: 'review',
        contentType: 'application/json',
        previewKind: 'json',
        createdAt: '2026-03-12T10:00:00.000Z',
        sizeBytes: 1024,
      },
    ];

    expect(summarizeProjectArtifactEntries(combinedEntries)).toEqual({
      totalArtifacts: 2,
      previewableArtifacts: 2,
      totalBytes: 3072,
      workflowCount: 1,
      workItemCount: 1,
      taskCount: 2,
    });
    expect(buildArtifactStageOptions(combinedEntries)).toEqual(['delivery', 'review']);
    expect(buildArtifactContentTypeOptions(combinedEntries)).toEqual([
      'application/json',
      'text/markdown',
    ]);
  });

  it('formats artifact sizes for operator review surfaces', () => {
    expect(formatArtifactFileSize(300)).toBe('300 B');
    expect(formatArtifactFileSize(2048)).toBe('2.0 KB');
    expect(formatArtifactFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('builds scope chips and next-action guidance for adaptive review', () => {
    expect(
      buildProjectArtifactScopeChips({
        query: 'release',
        workflowName: 'Release board',
        stageName: 'delivery',
        workItemTitle: 'Prepare release packet',
        taskTitle: 'Build release notes',
        contentType: 'text/markdown',
        createdFrom: '2026-03-10',
        createdTo: '2026-03-12',
      }),
    ).toEqual([
      { label: 'Search', value: 'release' },
      { label: 'Workflow', value: 'Release board' },
      { label: 'Stage', value: 'delivery' },
      { label: 'Work item', value: 'Prepare release packet' },
      { label: 'Task', value: 'Build release notes' },
      { label: 'Type', value: 'text/markdown' },
      { label: 'Created', value: '2026-03-10 to 2026-03-12' },
    ]);

    expect(
      describeProjectArtifactNextAction({
        totalArtifacts: 0,
        selectedCount: 0,
        selectedArtifactName: null,
        activeFilterCount: 3,
      }),
    ).toContain('Widen the current filters');

    expect(
      describeProjectArtifactNextAction({
        totalArtifacts: 8,
        selectedCount: 2,
        selectedArtifactName: null,
        activeFilterCount: 4,
      }),
    ).toContain('2 selected artifacts');

    expect(
      describeProjectArtifactNextAction({
        totalArtifacts: 4,
        selectedCount: 0,
        selectedArtifactName: 'release-notes.md',
        activeFilterCount: 1,
      }),
    ).toContain('release-notes.md');
  });
});
