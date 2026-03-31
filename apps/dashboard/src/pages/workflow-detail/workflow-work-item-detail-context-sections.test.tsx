import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type {
  DashboardTaskHandoffRecord,
  DashboardWorkItemMemoryEntry,
  DashboardWorkItemMemoryHistoryEntry,
  DashboardWorkflowWorkItemRecord,
} from '../../lib/api.js';
import type {
  DashboardWorkItemArtifactRecord,
  DashboardWorkItemTaskRecord,
} from './workflow-work-item-detail-support.js';
import {
  WorkItemArtifactsSection,
  WorkItemContinuitySection,
  WorkItemHandoffHistorySection,
  WorkItemMemorySection,
} from './workflow-work-item-detail-context-sections.js';

describe('workflow work-item detail context sections', () => {
  it('renders structured memory packets and artifacts without object leakage', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement('div', null, [
          createElement(WorkItemMemorySection, {
            key: 'memory',
            isLoading: false,
            hasError: false,
            entries: [createMemoryEntry()],
            history: [createMemoryHistoryEntry()],
            isHistoryLoading: false,
            hasHistoryError: false,
          }),
          createElement(WorkItemArtifactsSection, {
            key: 'artifacts',
            isLoading: false,
            hasError: false,
            tasks: [createTask()],
            artifacts: [createArtifact()],
          }),
        ]),
      ),
    );

    expect(markup).toContain('Current memory');
    expect(markup).toContain('prompt_context');
    expect(markup).toContain('Memory history');
    expect(markup).toContain('Updated value');
    expect(markup).toContain('Artifacts');
    expect(markup).toContain('brief.md');
    expect(markup).toContain('Preview artifact');
    expect(markup).not.toContain('[object Object]');
  });

  it('renders continuity and handoff summaries with the latest specialist context', () => {
    const latestHandoff = createHandoff();
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement('div', null, [
          createElement(WorkItemContinuitySection, {
            key: 'continuity',
            workItem: createWorkItem(),
            latestHandoff,
            handoffCount: 2,
            isLoading: false,
          }),
          createElement(WorkItemHandoffHistorySection, {
            key: 'handoffs',
            handoffs: [latestHandoff],
            isLoading: false,
          }),
        ]),
      ),
    );

    expect(markup).toContain('What the platform expects next');
    expect(markup).toContain('qa');
    expect(markup).toContain('review_follow_up');
    expect(markup).toContain('Most recent specialist handoff');
    expect(markup).toContain('Gate review packet is ready for operator assessment.');
    expect(markup).toContain('Full execution chain for this work item');
    expect(markup).toContain('Step 1');
    expect(markup).not.toContain('[object Object]');
  });
});

function createMemoryEntry(): DashboardWorkItemMemoryEntry {
  return {
    key: 'prompt_context',
    value: {
      checklist: ['Inspect gate findings', 'Confirm release owner'],
      summary: 'Hold for operator review',
    },
    event_id: 17,
    updated_at: '2026-03-31T00:00:00.000Z',
    actor_type: 'orchestrator',
    actor_id: 'agent-7',
    workflow_id: 'workflow-1',
    work_item_id: 'work-item-1',
    task_id: 'task-1',
    stage_name: 'qa',
  };
}

function createMemoryHistoryEntry(): DashboardWorkItemMemoryHistoryEntry {
  return {
    ...createMemoryEntry(),
    event_id: 18,
    event_type: 'updated',
  };
}

function createWorkItem(): DashboardWorkflowWorkItemRecord {
  return {
    id: 'work-item-1',
    workflow_id: 'workflow-1',
    stage_name: 'qa',
    title: 'Review release packet',
    column_id: 'needs-review',
    priority: 'high',
    next_expected_actor: 'operator',
    next_expected_action: 'review_follow_up',
    blocked_state: null,
    blocked_reason: null,
    escalation_status: null,
    rework_count: 2,
    current_subject_revision: 4,
    assessment_status: 'awaiting_review',
    gate_status: 'pending',
    branch_id: 'branch-17',
    branch_status: 'active',
  };
}

function createHandoff(): DashboardTaskHandoffRecord {
  return {
    id: 'handoff-1',
    workflow_id: 'workflow-1',
    work_item_id: 'work-item-1',
    task_id: 'task-1',
    request_id: 'request-1',
    role: 'qa_specialist',
    team_name: 'qa',
    stage_name: 'qa',
    sequence: 1,
    summary: 'Gate review packet is ready for operator assessment.',
    completion: 'awaiting_review',
    closure_effect: 'blocking',
    completion_callouts: null,
    changes: [],
    decisions: [],
    remaining_items: ['Approve release note'],
    blockers: ['Need operator sign-off'],
    focus_areas: ['Gate findings'],
    known_risks: ['Release timing'],
    successor_context: 'Review the gate packet and decide whether to approve the release.',
    role_data: {
      decision_state: 'awaiting_review',
    },
    artifact_ids: ['artifact-1'],
    created_at: '2026-03-31T00:00:00.000Z',
  };
}

function createTask(): DashboardWorkItemTaskRecord {
  return {
    id: 'task-1',
    title: 'Prepare review packet',
    state: 'completed',
    role: 'qa_specialist',
    stage_name: 'qa',
    work_item_id: 'work-item-1',
    completed_at: '2026-03-31T00:00:00.000Z',
    depends_on: [],
  };
}

function createArtifact(): DashboardWorkItemArtifactRecord {
  return {
    id: 'artifact-1',
    workflow_id: 'workflow-1',
    workspace_id: 'workspace-1',
    task_id: 'task-1',
    logical_path: 'handoffs/release/brief.md',
    content_type: 'text/markdown',
    size_bytes: 512,
    checksum_sha256: 'abc123',
    metadata: {},
    retention_policy: {},
    created_at: '2026-03-31T00:00:00.000Z',
    download_url: 'https://example.test/artifact-1',
    task_title: 'Prepare review packet',
  };
}
