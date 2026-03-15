import { describe, expect, it } from 'vitest';

import { BUILT_IN_PLAYBOOKS } from '../../src/catalogs/built-in-playbooks.js';
import { parsePlaybookDefinition } from '../../src/orchestration/playbook-model.js';

describe('built-in playbooks', () => {
  it('parse against the redesigned playbook contract', () => {
    for (const playbook of BUILT_IN_PLAYBOOKS) {
      const definition = parsePlaybookDefinition(playbook.definition);

      expect(definition.process_instructions?.length ?? 0).toBeGreaterThan(0);
      expect(definition.board.columns.length).toBeGreaterThan(0);
      expect(definition.lifecycle).toBe(playbook.lifecycle);
    }
  });

  it('ships SDLC with explicit review, approval, and handoff rules', () => {
    const sdlc = BUILT_IN_PLAYBOOKS.find((playbook) => playbook.slug === 'sdlc-v2');
    expect(sdlc).toBeDefined();

    const definition = parsePlaybookDefinition(sdlc!.definition);
    expect(definition.review_rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from_role: 'developer',
          reviewed_by: 'reviewer',
          required: true,
        }),
      ]),
    );
    expect(definition.approval_rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checkpoint: 'requirements', approved_by: 'human' }),
        expect.objectContaining({ checkpoint: 'verification', approved_by: 'human' }),
      ]),
    );
    expect(definition.handoff_rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from_role: 'developer', to_role: 'reviewer' }),
      ]),
    );
  });
});
