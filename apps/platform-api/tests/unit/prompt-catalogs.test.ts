import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ORCHESTRATOR_PROMPT,
  DEFAULT_PLATFORM_INSTRUCTIONS,
} from '../../src/catalogs/default-prompts.js';
import { loadBuiltInRolesConfig } from '../../src/catalogs/built-in-roles.js';

describe('prompt catalogs', () => {
  it('keeps platform instructions aligned with escalation and memory discipline', () => {
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Before escalating, leave the work in a clean takeover state.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Repository-backed tasks MUST commit and push relevant work before escalation.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Operational state such as rework counters');
  });

  it('keeps orchestrator prompt aligned with continuity, budget, and checkpoint guidance', () => {
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Operational continuity lives in work items, rule posture, and structured handoffs.');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Use read_workflow_budget when budget posture can affect the next decision.');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Use advance_checkpoint when planned workflows are ready to move forward.');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Use structured handoffs and continuity state to preserve context between activations and role changes.');
  });

  it('adds predecessor-handoff discipline to every built-in role prompt', () => {
    const roles = Object.values(loadBuiltInRolesConfig().roles);
    expect(roles.length).toBeGreaterThan(0);
    for (const role of roles) {
      expect(role.systemPrompt).toContain('If predecessor handoff exists in your task context, read it first');
      expect(role.systemPrompt).toContain('Leave a structured handoff');
    }
  });
});
