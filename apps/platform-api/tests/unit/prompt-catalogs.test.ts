import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ORCHESTRATOR_PROMPT,
  DEFAULT_PLATFORM_INSTRUCTIONS,
} from '../../src/catalogs/default-prompts.js';

describe('prompt catalogs', () => {
  it('keeps platform instructions aligned with escalation and memory discipline', () => {
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Before escalating, leave clean takeover state.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Repository-backed tasks MUST commit and push relevant work before escalation.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain(
      'Repository-backed containers guarantee the repo checkout, git, sh, and python3.',
    );
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('operational state such as rework counters');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Before task completion, you MUST ensure');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('successful structured handoff');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Rejected attempts do not count');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Do not duplicate unchanged handoffs');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('unique request_id');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('The platform rejects completion without a structured handoff');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Do not use submit_handoff as a scratch note or progress marker');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain(
      'Never reference task-local paths such as output/, repo/, or /tmp/workspace in a structured handoff.',
    );
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Never invent ids or leave placeholder ids in tool calls.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Use repo-relative or tool-returned workspace paths; do not use guessed absolute /tmp/workspace paths.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Only assessment or approval handoffs may include resolution.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('On delivery handoffs, omit resolution entirely.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Do not assume optional context files exist.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('shell_exec timeout is in seconds, not milliseconds');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('confirm the runtime exists in the container or install it first');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Escalate only after exhausting alternatives');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Workspace memory stores durable knowledge only.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).not.toContain('Project memory stores durable knowledge only.');
  });

  it('keeps orchestrator prompt aligned with continuity, budget, and stage guidance', () => {
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Operational continuity lives in work items, rule posture, and structured handoffs.');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Check workflow budget posture when cost, time, or token pressure matters');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'Routing accepted work into the next stage and closing the predecessor work item is the progression mutation; do not also call advance_stage for the same move.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'Use advance_stage only if the predecessor still shows as current and successor-stage routing has not already moved the workflow on.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'complete the predecessor work item if its deliverable is accepted',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'Use complete_work_item for accepted work; do not guess terminal column_id with update_work_item.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'After final approval in a planned workflow, complete the accepted final-stage work item, then call complete_workflow.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Use structured handoffs and continuity state to preserve context between activations and role changes.');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Treat platform rule results and continuity state as authoritative.');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Mandatory assessment, approval, and handoff rules are enforced by the platform.');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'A null predecessor handoff is normal for first-stage work or freshly seeded entry work.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('key_artifacts as { id, task_id, label, path } objects');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'If a playbook has no explicit stage sequence, use board posture and process instructions.',
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
      'Do not keep successor-stage work anchored to the predecessor stage.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'Do not end a planned-workflow activation with only a recommendation to advance later.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'Never invent, paraphrase, or placeholder workflow, task, work-item, or handoff ids',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'If newer continuity shows the target task or work item already advanced, do not retry stale mutations; finish and wait for the next event.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'If request_changes reuses an already reopened task, call update_task_input with the concrete rework contract before the specialist resumes.',
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

  it('keeps the shared prompts bounded for routine execution', () => {
    expect(DEFAULT_PLATFORM_INSTRUCTIONS.length).toBeLessThanOrEqual(2350);
    expect(DEFAULT_ORCHESTRATOR_PROMPT.length).toBeLessThanOrEqual(5300);
  });
});
