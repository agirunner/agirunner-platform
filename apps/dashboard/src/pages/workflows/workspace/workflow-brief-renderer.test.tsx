import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WorkflowBriefRenderer } from './workflow-brief-renderer.js';

describe('WorkflowBriefRenderer', () => {
  it('suppresses raw lifecycle payload garbage when a section item has no readable brief text', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowBriefRenderer, {
        brief: {
          id: 'brief-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: null,
          request_id: 'request-1',
          execution_context_id: 'execution-1',
          brief_kind: 'milestone',
          brief_scope: 'workflow_timeline',
          source_kind: 'orchestrator',
          source_role_name: 'Orchestrator',
          status_kind: 'in_progress',
          short_brief: {
            headline: 'Release package is ready for approval.',
          },
          detailed_brief_json: {
            headline: 'Release package is ready for approval.',
            summary: 'Verification completed and the package is ready.',
            sections: {
              validation: [
                'Verified rollback handling.',
                {
                  lifecycle_event: 'task.completed',
                  work_item_id: 'work-item-1',
                  task_id: 'task-4',
                  status_kind: 'completed',
                  sequence_number: 4,
                },
              ],
            },
          },
          linked_target_ids: ['workflow-1', 'work-item-1'],
          sequence_number: 4,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T10:00:00.000Z',
          updated_at: '2026-03-27T10:00:00.000Z',
        },
      }),
    );

    expect(html).toContain('Verified rollback handling.');
    expect(html).not.toContain('lifecycle_event');
    expect(html).not.toContain('work-item-1');
    expect(html).not.toContain('task-4');
    expect(html).not.toContain('sequence_number');
    expect(html).not.toContain('{&quot;');
  });

  it('renders detailed brief sections inline without handoff-style navigation copy', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowBriefRenderer, {
        brief: {
          id: 'brief-2',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          request_id: 'request-2',
          execution_context_id: 'execution-2',
          brief_kind: 'milestone',
          brief_scope: 'deliverable_context',
          source_kind: 'specialist',
          source_role_name: 'Reviewer',
          status_kind: 'completed',
          short_brief: {
            headline: 'Release bundle brief',
          },
          detailed_brief_json: {
            headline: 'Release bundle brief',
            summary: 'The release bundle is ready for operator review.',
            sections: {
              deliverables: [
                'Release bundle is ready for operator review.',
              ],
              next_steps: [
                {
                  label: 'Next review',
                  value: 'Publish the workflow deliverable summary.',
                },
              ],
            },
          },
          linked_target_ids: ['workflow-1', 'work-item-1', 'task-1'],
          sequence_number: 2,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'agent',
          created_by_id: 'agent-1',
          created_at: '2026-03-28T10:00:00.000Z',
          updated_at: '2026-03-28T10:00:00.000Z',
        },
      }),
    );

    expect(html).toContain('Release bundle brief');
    expect(html).toContain('Release bundle is ready for operator review.');
    expect(html).toContain('Next review');
    expect(html).toContain('Publish the workflow deliverable summary.');
    expect(html).not.toContain('Open brief scope');
    expect(html).not.toContain('handoff');
  });
});
