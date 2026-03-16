import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ORCHESTRATOR_PROMPT,
  DEFAULT_PLATFORM_INSTRUCTIONS,
} from '../../src/catalogs/default-prompts.js';
import { BUILT_IN_ROLES, loadBuiltInRolesConfig } from '../../src/catalogs/built-in-roles.js';

describe('prompt catalogs', () => {
  it('keeps platform instructions aligned with escalation and memory discipline', () => {
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Before escalating, leave the work in a clean takeover state.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Repository-backed tasks MUST commit and push relevant work before escalation.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('operational state such as rework counters');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Before task completion, you MUST call submit_handoff');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('The platform rejects task completion without a structured handoff');
  });

  it('keeps orchestrator prompt aligned with continuity, budget, and checkpoint guidance', () => {
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Operational continuity lives in work items, rule posture, and structured handoffs.');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Check workflow budget posture when cost, time, or token pressure matters');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Use advance_checkpoint when planned workflows are ready to move forward.');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Use structured handoffs and continuity state to preserve context between activations and role changes.');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Treat platform rule results and continuity state as authoritative.');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('key_artifacts as an array of objects');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'If a playbook has no explicit checkpoints, use board posture and process instructions as the progression model.',
    );
  });

  it('adds predecessor-handoff discipline to every built-in role prompt', () => {
    const roles = Object.values(loadBuiltInRolesConfig().roles);
    expect(roles.length).toBeGreaterThan(0);
    for (const role of roles) {
      expect(role.systemPrompt).toContain('If predecessor handoff exists in your task context, read it first');
      expect(role.systemPrompt).toContain('Before completing the task, you MUST call submit_handoff');
      expect(role.systemPrompt).toContain('The platform will reject completion without a structured handoff');
    }
  });

  it('gives the core SDLC roles explicit handoff expectations', () => {
    expect(BUILT_IN_ROLES.roles.developer.systemPrompt).toContain(
      'changed files, tests run, known risks, and what the reviewer should inspect next',
    );
    expect(BUILT_IN_ROLES.roles.reviewer.systemPrompt).toContain(
      'APPROVED, REQUEST CHANGES, or BLOCKED',
    );
    expect(BUILT_IN_ROLES.roles.qa.systemPrompt).toContain(
      'evidence, defects, residual risk, and release posture',
    );
    expect(BUILT_IN_ROLES.roles['product-manager'].systemPrompt).toContain(
      'acceptance criteria, scope decisions, and any required human follow-up',
    );
  });
});
