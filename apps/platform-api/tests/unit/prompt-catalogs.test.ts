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
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain(
      'Repository-backed containers guarantee only the repo checkout, git, and sh.',
    );
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('operational state such as rework counters');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Before task completion, you MUST call submit_handoff');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('unique request_id');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('The platform rejects task completion without a structured handoff');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Do not use submit_handoff as a scratch note or interim progress marker');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Escalate only after exhausting alternatives');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Workspace memory stores durable knowledge only.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).not.toContain('Project memory stores durable knowledge only.');
  });

  it('keeps orchestrator prompt aligned with continuity, budget, and stage guidance', () => {
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Operational continuity lives in work items, rule posture, and structured handoffs.');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Check workflow budget posture when cost, time, or token pressure matters');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Use advance_stage when planned workflows are ready to move forward.');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'complete the predecessor work item if its deliverable is accepted',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'After final approval in a planned workflow, complete the release work item and call complete_workflow.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Use structured handoffs and continuity state to preserve context between activations and role changes.');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Treat platform rule results and continuity state as authoritative.');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('key_artifacts as an array of objects');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'If a playbook has no explicit stage sequence, use board posture and process instructions as the progression model.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'If you conclude that a planned workflow should progress, perform the required workflow mutation in the same activation.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'Create successor work items and tasks in the successor stage, not the stage that just finished.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'every create_work_item and create_task call MUST set stage_name to the stage the new work belongs to.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'Do not keep successor review, QA, or release work anchored to the predecessor stage.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'Do not end a planned-workflow activation with only a recommendation to advance later.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'Never invent, paraphrase, or placeholder workflow, task, work-item, or handoff ids',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'Avoid setting specialist token_budget unless you have a concrete budget reason',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'execution-workspace template',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'Specialists should install any additional language runtime, package manager, or test/build tool they need inside the task container.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'On heartbeat-only activations, exit when specialist work is progressing and nothing new is actionable.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'Workspace memory stores decisions, lessons, constraints, watch items, and key file paths.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).not.toContain('Project memory stores');
  });

  it('adds predecessor-handoff discipline to every built-in role prompt', () => {
    const roles = Object.values(loadBuiltInRolesConfig().roles);
    expect(roles.length).toBeGreaterThan(0);
    for (const role of roles) {
      expect(role.systemPrompt).toContain('If predecessor handoff exists in your task context, read it first');
      expect(role.systemPrompt).toContain('Treat predecessor handoffs, task input, workspace memory, the workflow brief, launch inputs, and the current branch diff as authoritative');
      expect(role.systemPrompt).toContain(
        'assume only the prepared repository workspace, git, and a minimal shell are guaranteed',
      );
      expect(role.systemPrompt).toContain('Install missing runtimes/tools yourself in the task container');
      expect(role.systemPrompt).toContain('Do not infer behavior from stale names or terminology');
      expect(role.systemPrompt).toContain('Before completing the task, you MUST call submit_handoff once with a unique request_id');
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
    expect(BUILT_IN_ROLES.roles['product-manager'].systemPrompt).toContain(
      'quote the exact approved user-facing behavior from QA evidence and current branch content',
    );
    expect(BUILT_IN_ROLES.roles['workspace-manager'].systemPrompt).toContain(
      'You are the Workspace Manager',
    );
    expect(BUILT_IN_ROLES.roles['workspace-manager'].capabilities).toEqual(
      expect.arrayContaining(['workspace-management', 'requirements']),
    );
  });

  it('seeds the core SDLC roles with explicit human escalation targets', () => {
    for (const role of Object.values(BUILT_IN_ROLES.roles)) {
      expect(role.escalationTarget).toBe('human');
      expect(role.maxEscalationDepth).toBe(5);
    }
  });

  it('aligns built-in SDLC role capabilities with repo-backed execution needs', () => {
    expect(BUILT_IN_ROLES.roles.developer.capabilities).toEqual(
      expect.arrayContaining(['coding', 'testing', 'git', 'python']),
    );
    expect(BUILT_IN_ROLES.roles.reviewer.capabilities).toEqual(
      expect.arrayContaining(['code-review', 'security-review', 'git']),
    );
    expect(BUILT_IN_ROLES.roles.architect.capabilities).toEqual(
      expect.arrayContaining(['architecture', 'documentation', 'git']),
    );
    expect(BUILT_IN_ROLES.roles.qa.capabilities).toEqual(
      expect.arrayContaining(['testing', 'requirements', 'git', 'python']),
    );
    expect(BUILT_IN_ROLES.roles['product-manager'].capabilities).toEqual(
      expect.arrayContaining(['requirements', 'documentation', 'git']),
    );
  });

  it('keeps the shared prompts dense enough for routine execution', () => {
    expect(DEFAULT_PLATFORM_INSTRUCTIONS.length).toBeLessThanOrEqual(2350);
    expect(DEFAULT_ORCHESTRATOR_PROMPT.length).toBeLessThanOrEqual(4800);

    for (const role of Object.values(BUILT_IN_ROLES.roles)) {
      expect(role.systemPrompt.length).toBeLessThanOrEqual(1150);
    }
  });
});
