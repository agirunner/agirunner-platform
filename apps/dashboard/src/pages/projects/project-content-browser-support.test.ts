import { describe, expect, it } from 'vitest';

import {
  filterTasksByWorkItem,
  buildWorkflowOptions,
  formatContentFileSize,
  formatContentRelativeTimestamp,
  normalizeProjectList,
  normalizeTaskOptions,
  normalizeWorkItemOptions,
  summarizeArtifactExecutionScope,
  summarizeArtifactInventory,
  summarizeArtifactUploadPosture,
  summarizeDocumentInventory,
} from './project-content-browser-support.js';

describe('project content browser support', () => {
  it('normalizes projects from wrapped responses', () => {
    expect(
      normalizeProjectList({ data: [{ id: 'project-1', name: 'Alpha', slug: 'alpha' }] }),
    ).toEqual([{ id: 'project-1', name: 'Alpha', slug: 'alpha' }]);
  });

  it('deduplicates timeline workflows while preserving first-seen order', () => {
    expect(
      buildWorkflowOptions([
        {
          workflow_id: 'workflow-1',
          name: 'Planning',
          state: 'active',
          created_at: '2026-03-10T10:00:00.000Z',
        },
        {
          workflow_id: 'workflow-1',
          name: 'Planning duplicate',
          state: 'completed',
          created_at: '2026-03-10T11:00:00.000Z',
        },
        {
          workflow_id: 'workflow-2',
          name: 'Delivery',
          state: 'pending',
          created_at: '2026-03-11T09:00:00.000Z',
        },
      ]),
    ).toEqual([
      {
        id: 'workflow-1',
        name: 'Planning',
        state: 'active',
        createdAt: '2026-03-10T10:00:00.000Z',
      },
      {
        id: 'workflow-2',
        name: 'Delivery',
        state: 'pending',
        createdAt: '2026-03-11T09:00:00.000Z',
      },
    ]);
  });

  it('falls back to string-safe workflow fields when timeline payloads contain objects', () => {
    expect(
      buildWorkflowOptions([
        {
          workflow_id: 'workflow-3',
          name: {} as never,
          state: {} as never,
          created_at: '2026-03-12T09:00:00.000Z',
        },
      ]),
    ).toEqual([
      {
        id: 'workflow-3',
        name: 'workflow-3',
        state: 'unknown',
        createdAt: '2026-03-12T09:00:00.000Z',
      },
    ]);
  });

  it('normalizes task records from paginated task responses', () => {
    expect(
      normalizeTaskOptions({
        data: [
          {
            id: 'task-1',
            title: 'Review PR',
            state: 'in_progress',
            stage_name: 'review',
            work_item_id: 'wi-1',
            activation_id: 'act-1',
            role: 'reviewer',
            is_orchestrator_task: false,
            created_at: '2026-03-11T09:00:00.000Z',
          },
        ],
      }),
    ).toEqual([
      {
        id: 'task-1',
        workflowId: null,
        title: 'Review PR',
        state: 'in_progress',
        stageName: 'review',
        workItemId: 'wi-1',
        activationId: 'act-1',
        role: 'reviewer',
        isOrchestratorTask: false,
        createdAt: '2026-03-11T09:00:00.000Z',
      },
    ]);
  });

  it('normalizes workflow work item options and filters tasks by work item', () => {
    expect(
      normalizeWorkItemOptions([
        {
          id: 'wi-1',
          workflow_id: 'wf-1',
          stage_name: 'implementation',
          title: 'Build auth',
          column_id: 'active',
          priority: 'high',
        } as never,
      ]),
    ).toEqual([
      {
        id: 'wi-1',
        workflowId: 'wf-1',
        title: 'Build auth',
        stageName: 'implementation',
        columnId: 'active',
        priority: 'high',
        completedAt: null,
      },
    ]);

    expect(
      normalizeWorkItemOptions([
        {
          id: 'wi-2',
          workflow_id: 'wf-2',
          stage_name: {} as never,
          title: {} as never,
          column_id: {} as never,
          priority: {} as never,
        } as never,
      ]),
    ).toEqual([
      {
        id: 'wi-2',
        workflowId: 'wf-2',
        title: 'wi-2',
        stageName: 'No stage',
        columnId: 'planned',
        priority: 'normal',
        completedAt: null,
      },
    ]);

    expect(
      filterTasksByWorkItem(
        [
          {
            id: 'task-1',
            workflowId: null,
            title: 'Build auth',
            state: 'claimed',
            stageName: 'implementation',
            workItemId: 'wi-1',
            activationId: null,
            role: 'developer',
            isOrchestratorTask: false,
          },
          {
            id: 'task-2',
            workflowId: null,
            title: 'Review auth',
            state: 'pending',
            stageName: 'review',
            workItemId: 'wi-2',
            activationId: null,
            role: 'reviewer',
            isOrchestratorTask: false,
          },
        ],
        'wi-1',
      ),
    ).toEqual([
      {
        id: 'task-1',
        workflowId: null,
        title: 'Build auth',
        state: 'claimed',
        stageName: 'implementation',
        workItemId: 'wi-1',
        activationId: null,
        role: 'developer',
        isOrchestratorTask: false,
      },
    ]);
  });

  it('preserves canonical escalation task state', () => {
    expect(
      normalizeTaskOptions({
        data: [
          {
            id: 'task-3',
            title: 'Resolve blocker',
            state: 'escalated',
            is_orchestrator_task: false,
          },
        ],
      }),
    ).toEqual([
      {
        id: 'task-3',
        workflowId: null,
        title: 'Resolve blocker',
        state: 'escalated',
        stageName: null,
        workItemId: null,
        activationId: null,
        role: null,
        isOrchestratorTask: false,
        createdAt: undefined,
      },
    ]);
  });

  it('preserves canonical claimed tasks instead of collapsing them into in-progress', () => {
    expect(
      normalizeTaskOptions({
        data: [
          {
            id: 'task-4',
            title: 'Queued specialist',
            state: 'claimed',
            is_orchestrator_task: false,
          },
        ],
      }),
    ).toEqual([
      {
        id: 'task-4',
        workflowId: null,
        title: 'Queued specialist',
        state: 'claimed',
        stageName: null,
        workItemId: null,
        activationId: null,
        role: null,
        isOrchestratorTask: false,
        createdAt: undefined,
      },
    ]);
  });

  it('summarizes document coverage for operator inventory packets', () => {
    expect(
      summarizeDocumentInventory([
        {
          logical_name: 'project_brief',
          scope: 'workflow',
          source: 'repository',
          description: 'Primary implementation brief',
          metadata: { owner: 'delivery' },
          created_at: '2026-03-12T10:00:00.000Z',
        },
        {
          logical_name: 'test_report',
          scope: 'workflow',
          source: 'artifact',
          metadata: {},
          created_at: '2026-03-12T12:00:00.000Z',
        },
        {
          logical_name: 'external_spec',
          scope: 'workflow',
          source: 'external',
          metadata: { source: 'vendor' },
        },
      ]),
    ).toEqual({
      totalDocuments: 3,
      repositoryDocuments: 1,
      artifactDocuments: 1,
      externalDocuments: 1,
      describedDocuments: 1,
      metadataBackedDocuments: 2,
      latestCreatedAt: '2026-03-12T12:00:00.000Z',
    });
  });

  it('summarizes artifact coverage and formats operator-facing timestamps and sizes', () => {
    expect(
      summarizeArtifactInventory([
        {
          id: 'artifact-1',
          task_id: 'task-1',
          logical_path: 'docs/brief.md',
          content_type: 'text/markdown',
          size_bytes: 3200,
          checksum_sha256: 'sha',
          metadata: { review: true },
          retention_policy: {},
          created_at: '2026-03-12T11:45:00.000Z',
          download_url: '/download/1',
        },
        {
          id: 'artifact-2',
          task_id: 'task-1',
          logical_path: 'docs/report.json',
          content_type: 'application/json',
          size_bytes: 2048,
          checksum_sha256: 'sha-2',
          metadata: {},
          retention_policy: {},
          created_at: '2026-03-12T11:55:00.000Z',
          download_url: '/download/2',
        },
      ]),
    ).toEqual({
      totalArtifacts: 2,
      totalBytes: 5248,
      metadataBackedArtifacts: 1,
      uniqueContentTypes: 2,
      latestCreatedAt: '2026-03-12T11:55:00.000Z',
    });

    expect(
      formatContentRelativeTimestamp(
        '2026-03-12T11:45:00.000Z',
        new Date('2026-03-12T12:00:00.000Z').getTime(),
      ),
    ).toBe('15m ago');
    expect(formatContentRelativeTimestamp(null)).toBe('No timestamp recorded');
    expect(formatContentFileSize(5248)).toBe('5.1 KB');
  });

  it('summarizes artifact execution scope and upload readiness for operator guidance', () => {
    expect(
      summarizeArtifactExecutionScope({
        selectedWorkflow: {
          id: 'workflow-1',
          name: 'Delivery board',
          state: 'active',
          createdAt: '2026-03-12T10:00:00.000Z',
        },
        selectedWorkItem: {
          id: 'work-item-1',
          workflowId: 'workflow-1',
          title: 'Implement billing webhooks',
          stageName: 'implementation',
          columnId: 'doing',
          priority: 'high',
          completedAt: null,
        },
        selectedTask: {
          id: 'task-1',
          workflowId: 'workflow-1',
          title: 'Publish webhook artifact',
          state: 'in_progress',
          stageName: 'implementation',
          workItemId: 'work-item-1',
          activationId: 'activation-1',
          role: 'developer',
          isOrchestratorTask: false,
          createdAt: undefined,
        },
        filteredTaskCount: 3,
      }),
    ).toEqual({
      headline: 'Publish webhook artifact',
      detail: 'implementation • developer • in_progress',
      nextAction: 'Upload or review artifacts for the selected execution step.',
    });

    expect(
      summarizeArtifactUploadPosture({
        selectedTask: null,
        fileName: null,
        logicalPath: '',
        metadataError: null,
      }),
    ).toEqual({
      isReady: false,
      headline: 'Action required before upload',
      detail:
        'Resolve the blockers below so the artifact packet is scoped, named, and valid before upload.',
      blockers: [
        'Select a task for the artifact upload target.',
        'Choose a source file to upload.',
        'Add a logical artifact path.',
      ],
    });
  });
});
