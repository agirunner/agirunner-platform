import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type {
  DashboardWorkflowDeliverableRecord,
  DashboardWorkflowDeliverablesPacket,
} from '../../../lib/api.js';
import type { WorkflowWorkbenchScopeDescriptor } from '../workflows-page.support.js';
import { WorkflowDeliverables } from './workflow-deliverables.js';

function readDeliverablesSource() {
  return readFileSync(resolve(import.meta.dirname, './workflow-deliverables.tsx'), 'utf8');
}

describe('WorkflowDeliverables', () => {
  it('keeps deliverables scoped to workflow or work item with no selected-task prop surface', () => {
    const source = readDeliverablesSource();

    expect(source).not.toContain('selectedTask: DashboardTaskRecord | null;');
    expect(source).not.toContain('props.selectedTask?.work_item_id');
    expect(source).not.toContain("scope.scopeKind !== 'selected_task'");
  });

  it('renders a scope-pure workflow view with final and interim sections only', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createPacket({
          final_deliverables: [
            createDeliverable({
              descriptor_id: 'workflow-final-1',
              title: 'Release brief',
              work_item_id: null,
              created_at: '2026-03-30T10:00:00.000Z',
            }),
            createDeliverable({
              descriptor_id: 'work-item-final-1',
              title: 'Implement audit flow',
              work_item_id: 'work-item-1',
              created_at: '2026-03-30T09:00:00.000Z',
            }),
          ],
          in_progress_deliverables: [
            createDeliverable({
              descriptor_id: 'workflow-interim-1',
              title: 'QA packet',
              delivery_stage: 'in_progress',
              state: 'under_review',
              created_at: '2026-03-30T08:00:00.000Z',
            }),
          ],
        }),
        selectedWorkItemId: null,
        selectedWorkItemTitle: null,
        scope: createWorkflowScope(),
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Deliverables');
    expect(html).toContain('Showing all deliverables recorded across this workflow');
    expect(html).toContain('Final');
    expect(html).toContain('Interim');
    expect(html).toContain('Release brief');
    expect(html).toContain('Implement audit flow');
    expect(html).toContain('QA packet');
    expect(html).not.toContain('Load older deliverables');
    expect(html).not.toContain('Inputs');
    expect(html).not.toContain('Working handoffs');
    expect(html).not.toContain('Workflow deliverables (');
    expect(html).not.toContain('Work item deliverables (');
  });

  it('filters work-item scope to only the selected work item deliverables', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createPacket({
          final_deliverables: [
            createDeliverable({
              descriptor_id: 'selected-work-item',
              title: 'Draft review-ready product brief',
              work_item_id: 'work-item-1',
            }),
            createDeliverable({
              descriptor_id: 'other-work-item',
              title: 'Different work item packet',
              work_item_id: 'work-item-2',
            }),
            createDeliverable({
              descriptor_id: 'workflow-final',
              title: 'Workflow terminal packet',
              work_item_id: null,
            }),
          ],
        }),
        selectedWorkItemId: 'work-item-1',
        selectedWorkItemTitle: 'Draft review-ready product brief',
        scope: createSelectedWorkItemScope(),
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Showing only deliverables recorded for Draft review-ready product brief.');
    expect(html).toContain('Draft review-ready product brief');
    expect(html).not.toContain('Different work item packet');
    expect(html).not.toContain('Workflow terminal packet');
    expect(html).toContain('Work item');
    expect(html).not.toContain('Task');
  });

  it('keeps final entries sorted newest first inside each stage', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createPacket({
          final_deliverables: [
            createDeliverable({
              descriptor_id: 'older-final',
              title: 'Older final packet',
              created_at: '2026-03-29T08:00:00.000Z',
            }),
            createDeliverable({
              descriptor_id: 'newer-final',
              title: 'Newer final packet',
              created_at: '2026-03-30T08:00:00.000Z',
            }),
          ],
        }),
        selectedWorkItemId: null,
        selectedWorkItemTitle: null,
        scope: createWorkflowScope(),
        onLoadMore: vi.fn(),
      }),
    );

    expect(html.indexOf('Newer final packet')).toBeLessThan(html.indexOf('Older final packet'));
  });

  it('shows empty-state copy per stage for a selected work item with no deliverables', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createPacket(),
        selectedWorkItemId: 'work-item-1',
        selectedWorkItemTitle: 'Draft review-ready product brief',
        scope: createSelectedWorkItemScope(),
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain(
      'No final deliverables are recorded for Draft review-ready product brief yet.',
    );
    expect(html).toContain(
      'No interim deliverables are recorded for Draft review-ready product brief yet.',
    );
  });

  it('only renders the paging affordance when a next cursor exists', () => {
    const withoutNextPage = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createPacket(),
        selectedWorkItemId: null,
        selectedWorkItemTitle: null,
        scope: createWorkflowScope(),
        onLoadMore: vi.fn(),
      }),
    );
    const withNextPage = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createPacket({ next_cursor: 'cursor:2' }),
        selectedWorkItemId: null,
        selectedWorkItemTitle: null,
        scope: createWorkflowScope(),
        onLoadMore: vi.fn(),
      }),
    );

    expect(withoutNextPage).not.toContain('Load older deliverables');
    expect(withNextPage).toContain('Load older deliverables');
  });
});

function createDeliverable(
  overrides: Partial<DashboardWorkflowDeliverableRecord> = {},
): DashboardWorkflowDeliverableRecord {
  return {
    descriptor_id: overrides.descriptor_id ?? 'deliverable-1',
    workflow_id: overrides.workflow_id ?? 'workflow-1',
    work_item_id: overrides.work_item_id ?? null,
    descriptor_kind: overrides.descriptor_kind ?? 'deliverable_packet',
    delivery_stage: overrides.delivery_stage ?? 'final',
    title: overrides.title ?? 'Deliverable title',
    state: overrides.state ?? 'final',
    summary_brief: overrides.summary_brief ?? 'Summary',
    preview_capabilities: overrides.preview_capabilities ?? {},
    primary_target: overrides.primary_target ?? {
      target_kind: 'inline_summary',
      label: 'Inline summary',
      url: '',
    },
    secondary_targets: overrides.secondary_targets ?? [],
    content_preview: overrides.content_preview ?? {
      summary: overrides.summary_brief ?? 'Summary',
    },
    source_brief_id: overrides.source_brief_id ?? null,
    created_at: overrides.created_at ?? '2026-03-30T07:00:00.000Z',
    updated_at: overrides.updated_at ?? overrides.created_at ?? '2026-03-30T07:00:00.000Z',
  };
}

function createPacket(
  overrides: Partial<DashboardWorkflowDeliverablesPacket> = {},
): DashboardWorkflowDeliverablesPacket {
  return {
    final_deliverables: overrides.final_deliverables ?? [],
    in_progress_deliverables: overrides.in_progress_deliverables ?? [],
    working_handoffs: overrides.working_handoffs ?? [],
    inputs_and_provenance:
      overrides.inputs_and_provenance ?? {
        launch_packet: null,
        supplemental_packets: [],
        intervention_attachments: [],
        redrive_packet: null,
      },
    next_cursor: overrides.next_cursor ?? null,
  };
}

function createWorkflowScope(): WorkflowWorkbenchScopeDescriptor {
  return {
    scopeKind: 'workflow' as const,
    title: 'Workflow' as const,
    subject: 'workflow',
    name: 'Workflow 1',
    banner: 'Workflow: Workflow 1',
  };
}

function createSelectedWorkItemScope(): WorkflowWorkbenchScopeDescriptor {
  return {
    scopeKind: 'selected_work_item' as const,
    title: 'Work item' as const,
    subject: 'work item',
    name: 'Draft review-ready product brief',
    banner: 'Work item: Draft review-ready product brief',
  };
}

function createTaskScope(): WorkflowWorkbenchScopeDescriptor {
  return {
    scopeKind: 'selected_work_item' as const,
    title: 'Work item' as const,
    subject: 'work item',
    name: 'Draft review-ready product brief',
    banner: 'Work item: Draft review-ready product brief',
  };
}
