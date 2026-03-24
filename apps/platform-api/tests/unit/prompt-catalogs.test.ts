import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ORCHESTRATOR_PROMPT,
  DEFAULT_PLATFORM_INSTRUCTIONS,
} from '../../src/catalogs/default-prompts.js';

describe('prompt catalogs', () => {
  it('keeps platform instructions aligned with escalation and memory discipline', () => {
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Playbook prose defines governance intent.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain(
      'Actual invoked handoffs, assessments, approvals, and escalations define binding workflow state.',
    );
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Before escalating, leave clean takeover state.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Repository-backed tasks MUST commit and push relevant work before completion or escalation.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain(
      'Repository-backed containers already provide repo checkout, git, sh, and python3.',
    );
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('operational state such as rework counters');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Before completion, ensure');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('successful structured handoff');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Rejected attempts do not count');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Do not duplicate unchanged handoffs');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('unique request_id');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Completion is rejected without a structured handoff');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Do not use submit_handoff for scratch progress');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain(
      'Never reference task-local paths such as output/, repo/, or /tmp/workspace in handoffs.',
    );
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain(
      'For non-repository workspaces, treat the workspace root as the only valid file root and use workspace-relative paths only.',
    );
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain(
      'Never use host absolute paths from instructions, logs, or prior output in tool calls or handoffs.',
    );
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain(
      'Do not call git tools or assume a repository exists unless the execution contract explicitly provides a repository-backed workspace.',
    );
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Never invent ids or leave placeholders in tool calls.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain(
      'Omit the resolution key itself; do not send resolution: approved or placeholders.',
    );
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Use repo-relative or tool-returned workspace paths, never guessed /tmp/workspace paths.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Only assessment or approval handoffs may include resolution.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Delivery handoffs MUST omit resolution entirely.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Completion and decision are separate.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Full assessment or approval handoffs MUST set resolution to approved, request_changes, rejected, or blocked.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Blocked completions MUST omit resolution.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('submit_handoff accepts only its documented schema fields.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Do not invent extras such as tests_run or verification_results');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Optional context files may not exist.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('shell_exec timeout is in seconds and MUST stay within tool limits');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('confirm the runtime exists or install it');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Treat next_expected_actor and next_expected_action as authoritative routing state.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Do not invent parallel assessor, approval, or successor work while continuity still requires a specific actor');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('In workflows with multiple open work items, stay scoped to the current work item or explicitly linked subject.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Do not infer routing or review policy from role, stage, or playbook names.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Read the task input, predecessor handoff, and referenced artifacts or files before acting.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Your task is not complete until the requested deliverable exists, you have checked it directly');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Assessment and approval handoffs MUST cite concrete current-subject findings');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Escalations MUST explain the blocker, the evidence, what you already tried, and the exact decision or input now needed.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).not.toContain('mandatory approval or assessment comes from authored config');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Escalate only after exhausting alternatives');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain('Workspace memory stores durable knowledge only.');
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain(
      'Use memory_write for durable decisions, constraints, key paths, and resolved issues with a non-empty updates map',
    );
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).toContain(
      'never send empty updates or request_id alone.',
    );
    expect(DEFAULT_PLATFORM_INSTRUCTIONS).not.toContain('Project memory stores durable knowledge only.');
  });

  it('keeps orchestrator prompt aligned with continuity, budget, and stage guidance', () => {
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Operational continuity lives in work items and structured handoffs.');
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
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Use process instructions as the workflow contract.');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain('Treat actual invoked governance state and continuity state as authoritative.');
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
      'after create_work_item returns reuse that id/work_item_id verbatim in later mutations.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'If you do not already have the exact task or work-item id from tool output, discover it first with list/read tools; never synthesize labels like task_x or work_item_x.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'If newer continuity shows the target task or work item already advanced, do not retry stale mutations; finish and wait for the next event.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'If request_changes reuses an already reopened task, call update_task_input with the concrete rework contract before the specialist resumes.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'A blocked work item, unresolved escalation, or unsatisfied approval or assessment requirement makes successor dispatch and completion illegal.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'Superseded approvals or assessments are historical evidence, not current authorization.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'Prior handoff prose is not authoritative gate state.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'request_gate_approval targets the human-gate stage, never the predecessor stage.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'There is no governance metadata to wait for or consult.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'When prose calls for approval, assessment, escalation, or rework, invoke the real control explicitly.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'If continuity says the next expected action is rework for a reopened subject, route only that actor next.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'When multiple work items are open, every continuity or activation-checkpoint mutation MUST include the exact work_item_id',
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
      'create_task.type MUST be one of analysis, code, assessment, test, docs, or custom.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'On heartbeat-only activations, exit when specialist work is progressing and nothing new is actionable.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).toContain(
      'Workspace memory stores decisions, lessons, constraints, watch items, and key file paths.',
    );
    expect(DEFAULT_ORCHESTRATOR_PROMPT).not.toContain('Project memory stores');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).not.toContain('metadata-driven');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).not.toContain('configured metadata');
    expect(DEFAULT_ORCHESTRATOR_PROMPT).not.toContain('approval_before_assessment');
  });

  it('keeps the shared prompts bounded for routine execution', () => {
    expect(DEFAULT_PLATFORM_INSTRUCTIONS.length).toBeLessThanOrEqual(4000);
    expect(DEFAULT_ORCHESTRATOR_PROMPT.length).toBeLessThanOrEqual(6500);
  });
});
