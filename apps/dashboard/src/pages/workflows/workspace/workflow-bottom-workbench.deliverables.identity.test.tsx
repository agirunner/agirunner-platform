import { describe, expect, it } from 'vitest';

import {
  createPacket,
  renderWorkbench,
} from './workflow-bottom-workbench.test-support.js';

describe('WorkflowBottomWorkbench deliverable identity', () => {
  it('collapses a path placeholder when an artifact-backed deliverable resolves the same logical file', () => {
    const packet = createPacket();
    const html = renderWorkbench({
      packet: {
        ...packet,
        bottom_tabs: {
          ...packet.bottom_tabs,
          counts: {
            ...packet.bottom_tabs.counts,
            deliverables: 2,
          },
        },
        deliverables: {
          ...packet.deliverables,
          final_deliverables: [
            {
              descriptor_id: 'deliverable-artifact',
              workflow_id: 'workflow-1',
              work_item_id: null,
              descriptor_kind: 'deliverable_packet',
              delivery_stage: 'final',
              title: 'Research Framing Brief',
              state: 'final',
              summary_brief: 'Verified research framing artifact.',
              preview_capabilities: {
                can_inline_preview: true,
                can_download: true,
              },
              primary_target: {
                target_kind: 'artifact',
                label: 'Open artifact',
                url: '/api/v1/tasks/task-1/artifacts/artifact-1/preview',
                path: 'artifact:workflow-1/research-framing-brief.md',
                artifact_id: 'artifact-1',
              },
              secondary_targets: [],
              content_preview: {
                summary: 'Verified research framing artifact.',
                source_role_name: 'Research Analyst',
              },
              source_brief_id: null,
              created_at: '2026-04-03T23:36:09.131Z',
              updated_at: '2026-04-03T23:36:09.131Z',
            },
          ],
          in_progress_deliverables: [
            {
              descriptor_id: 'deliverable-placeholder',
              workflow_id: 'workflow-1',
              work_item_id: null,
              descriptor_kind: 'brief_packet',
              delivery_stage: 'in_progress',
              title: 'Research framing note',
              state: 'draft',
              summary_brief: null,
              preview_capabilities: {
                can_inline_preview: true,
                can_download: false,
              },
              primary_target: {
                target_kind: 'inline_summary',
                label: 'Research framing note',
                path: 'research-framing-brief.md',
              },
              secondary_targets: [],
              content_preview: {
                summary: 'Path: research-framing-brief.md',
              },
              source_brief_id: 'brief-1',
              created_at: '2026-04-03T23:35:09.131Z',
              updated_at: '2026-04-03T23:35:09.131Z',
            },
          ],
        },
      },
      activeTab: 'deliverables',
    });

    expect((html.match(/Research Framing Brief/g) ?? []).length).toBe(1);
    expect(html).not.toContain('Research framing note');
    expect((html.match(/>Download</g) ?? []).length).toBe(1);
  });
});
