import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/document-reference/document-reference-service.js', () => ({
  listTaskDocuments: vi.fn(async () => []),
}));

vi.mock('../../../src/services/orchestrator-task-context.js', () => ({
  buildOrchestratorTaskContext: vi.fn(async () => null),
}));

import { summarizeTaskContextAttachments } from '../../../src/services/task-context-service.js';

describe('buildTaskContext active stage semantics', () => {
  it('marks orchestrator checkpoints in attachment summaries', () => {
    const summary = summarizeTaskContextAttachments({
      task: {
        predecessor_handoff: null,
        predecessor_handoff_resolution: null,
        context_anchor: null,
        recent_handoffs: [],
        work_item: {},
      },
      workspace: {
        memory_index: {},
        artifact_index: {},
      },
      instruction_layers: {},
      documents: [],
      orchestrator: {
        last_activation_checkpoint: {
          activation_id: 'activation-7',
        },
      },
    });

    expect(summary.orchestrator_checkpoint_present).toBe(true);
  });
});
