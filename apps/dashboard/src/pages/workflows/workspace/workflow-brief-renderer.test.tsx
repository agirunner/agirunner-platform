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
});
