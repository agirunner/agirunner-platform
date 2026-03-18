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
    expect(definition.process_instructions).toContain(
      'Reviewer must review every developer-delivered code change',
    );
    expect(definition.process_instructions).toContain(
      'Human approval is required before release and completion',
    );
    expect(definition.process_instructions).toContain(
      'complete the finished checkpoint work item instead of leaving it open',
    );
    expect(definition.checkpoints.map((checkpoint) => checkpoint.name)).toEqual([
      'requirements',
      'design',
      'implementation',
      'review',
      'verification',
      'release',
    ]);
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
        expect.objectContaining({ checkpoint: 'release', approved_by: 'human' }),
      ]),
    );
    expect(definition.handoff_rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from_role: 'product-manager', to_role: 'architect' }),
        expect.objectContaining({ from_role: 'architect', to_role: 'developer' }),
        expect.objectContaining({ from_role: 'developer', to_role: 'reviewer' }),
        expect.objectContaining({ from_role: 'reviewer', to_role: 'qa' }),
        expect.objectContaining({
          from_role: 'qa',
          to_role: 'product-manager',
          required: true,
        }),
      ]),
    );
  });

  it('uses workspace terminology for the built-in planning playbook copy', () => {
    const planning = BUILT_IN_PLAYBOOKS.find((playbook) => playbook.slug === 'project-planning-v2');
    expect(planning).toBeDefined();
    expect(planning!.name).toBe('Workspace Planning');

    const parameters = Array.isArray(planning!.definition.parameters)
      ? planning!.definition.parameters as Array<{ name: string; description?: string }>
      : [];
    expect(parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'workspace_name', description: 'Workspace name' }),
        expect.objectContaining({ name: 'workspace_brief', description: 'Workspace brief to analyze' }),
        expect.objectContaining({ name: 'workspace_id', description: 'Workspace identifier' }),
      ]),
    );
  });
});
