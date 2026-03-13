import { describe, expect, it } from 'vitest';

import {
  fieldsForSection,
  SECTION_DEFINITIONS,
} from './runtime-defaults.schema.js';
import { buildValidationErrors } from './runtime-defaults.validation.js';

describe('runtime defaults page support', () => {
  it('exposes dedicated runtime sections for agent context, orchestrator overrides, and safeguards', () => {
    expect(SECTION_DEFINITIONS.map((section) => section.key)).toEqual([
      'containers',
      'agent_context',
      'orchestrator_context',
      'agent_safeguards',
      'fleet',
      'search',
    ]);
    expect(fieldsForSection('agent_context').map((field) => field.key)).toContain(
      'agent.history_max_messages',
    );
    expect(fieldsForSection('orchestrator_context').map((field) => field.key)).toContain(
      'agent.orchestrator_context_compaction_threshold',
    );
    expect(fieldsForSection('agent_safeguards').map((field) => field.key)).toContain(
      'agent.max_iterations',
    );
  });

  it('validates numeric runtime ranges and history relationships before save', () => {
    const errors = buildValidationErrors({
      'agent.history_max_messages': '20',
      'agent.history_preserve_recent': '25',
      'agent.context_compaction_threshold': '1.5',
      'agent.orchestrator_history_preserve_recent': '21',
      'agent.loop_detection_repeat': '0',
    });

    expect(errors['agent.history_preserve_recent']).toContain('overall history budget');
    expect(errors['agent.context_compaction_threshold']).toContain('at most 1');
    expect(errors['agent.orchestrator_history_preserve_recent']).toContain(
      'overall history budget',
    );
    expect(errors['agent.loop_detection_repeat']).toContain('at least 1');
  });
});
