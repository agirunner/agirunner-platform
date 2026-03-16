import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../src/errors/domain-errors.js';
import { assertProjectMemoryWritesAreDurableKnowledge } from '../../src/services/project-memory-write-guard.js';

describe('assertProjectMemoryWritesAreDurableKnowledge', () => {
  it('allows durable knowledge entries', () => {
    expect(() =>
      assertProjectMemoryWritesAreDurableKnowledge([
        {
          key: 'workflow/hello-world/design-routing',
          value: {
            decision: 'Use the existing Python CLI package layout for the Hello World implementation.',
            rationale: 'The repository already exposes a runnable package entrypoint and test layout.',
            design_work_item_id: '421e2423-c1d3-46ae-ac14-8b080869cbde',
          },
        },
      ]),
    ).not.toThrow();
  });

  it('rejects structured operational status entries', () => {
    expect(() =>
      assertProjectMemoryWritesAreDurableKnowledge([
        {
          key: 'requirements_gate_status',
          value: {
            state: 'awaiting_human_approval',
            checkpoint: 'requirements',
            work_item_id: 'ba18946b-e59a-4106-842f-b38d58b659b3',
            rationale: 'Waiting on the required human gate.',
          },
        },
      ]),
    ).toThrowError(ValidationError);
  });
});
