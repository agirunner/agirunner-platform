/**
 * Template schema factories for live test scenarios.
 *
 * Produces the JSON schema objects expected by POST /api/v1/templates.
 * Each factory returns a deterministic template schema with proper
 * dependency graphs matching the test plan.
 */

/**
 * SDLC template: architect → developer → reviewer → qa
 *
 * Linear dependency chain: each task depends on the previous one completing.
 * Used by AP-1 (calc-api "add multiply endpoint").
 */
export function sdlcTemplateSchema(params?: {
  inputTemplate?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    variables: [
      { name: 'repo', type: 'string', required: true },
      { name: 'goal', type: 'string', required: true },
    ],
    tasks: [
      {
        id: 'architect',
        title_template: 'Architecture: {{goal}}',
        type: 'analysis',
        role: 'architect',
        capabilities_required: ['llm-api', 'role:architect'],
        input_template: params?.inputTemplate ?? {
          repo: '{{repo}}',
          goal: '{{goal}}',
          instruction: 'Design the architecture for: {{goal}}',
        },
      },
      {
        id: 'developer',
        title_template: 'Develop: {{goal}}',
        type: 'code',
        role: 'developer',
        depends_on: ['architect'],
        capabilities_required: ['llm-api', 'role:developer'],
        input_template: {
          repo: '{{repo}}',
          goal: '{{goal}}',
          instruction: 'Implement: {{goal}}',
        },
      },
      {
        id: 'reviewer',
        title_template: 'Review: {{goal}}',
        type: 'review',
        role: 'reviewer',
        depends_on: ['developer'],
        capabilities_required: ['llm-api', 'role:reviewer'],
        input_template: {
          repo: '{{repo}}',
          goal: '{{goal}}',
          instruction: 'Review implementation of: {{goal}}',
        },
      },
      {
        id: 'qa',
        title_template: 'QA: {{goal}}',
        type: 'test',
        role: 'qa',
        depends_on: ['reviewer'],
        capabilities_required: ['llm-api', 'role:qa'],
        input_template: {
          repo: '{{repo}}',
          goal: '{{goal}}',
          instruction: 'Validate and test: {{goal}}',
        },
      },
    ],
  };
}

/**
 * Maintenance template: triage → fix → verify → close
 *
 * Linear chain for bug-fix workflows.
 * Used by AP-5 (todo-app planted bugs).
 */
export function maintenanceTemplateSchema(): Record<string, unknown> {
  return {
    variables: [
      { name: 'repo', type: 'string', required: true },
      { name: 'issue', type: 'string', required: true },
      { name: 'description', type: 'string', required: true },
    ],
    tasks: [
      {
        id: 'triage',
        title_template: 'Triage: {{issue}}',
        type: 'analysis',
        role: 'architect',
        capabilities_required: ['llm-api', 'role:architect'],
        input_template: {
          repo: '{{repo}}',
          issue: '{{issue}}',
          description: '{{description}}',
          instruction: 'Diagnose the root cause of: {{description}}',
        },
      },
      {
        id: 'fix',
        title_template: 'Fix: {{issue}}',
        type: 'code',
        role: 'developer',
        depends_on: ['triage'],
        capabilities_required: ['llm-api', 'role:developer'],
        input_template: {
          repo: '{{repo}}',
          issue: '{{issue}}',
          instruction: 'Fix the bug: {{description}}',
        },
      },
      {
        id: 'verify',
        title_template: 'Verify: {{issue}}',
        type: 'test',
        role: 'qa',
        depends_on: ['fix'],
        capabilities_required: ['llm-api', 'role:qa'],
        input_template: {
          repo: '{{repo}}',
          issue: '{{issue}}',
          instruction: 'Verify the fix for: {{description}}',
        },
      },
      {
        id: 'close',
        title_template: 'Close: {{issue}}',
        type: 'docs',
        role: 'reviewer',
        depends_on: ['verify'],
        capabilities_required: ['llm-api', 'role:reviewer'],
        input_template: {
          repo: '{{repo}}',
          issue: '{{issue}}',
          instruction: 'Summarize resolution for: {{description}}',
        },
      },
    ],
  };
}

/**
 * Diamond dependency template for OT-1 cascade tests.
 *
 *   A → B
 *   A → C
 *   B,C → D
 */
export function diamondTemplateSchema(): Record<string, unknown> {
  return {
    tasks: [
      {
        id: 'A',
        title_template: 'Task A',
        type: 'analysis',
        role: 'architect',
        capabilities_required: ['llm-api'],
      },
      {
        id: 'B',
        title_template: 'Task B',
        type: 'code',
        role: 'developer',
        depends_on: ['A'],
        capabilities_required: ['llm-api'],
      },
      {
        id: 'C',
        title_template: 'Task C',
        type: 'code',
        role: 'developer',
        depends_on: ['A'],
        capabilities_required: ['llm-api'],
      },
      {
        id: 'D',
        title_template: 'Task D',
        type: 'review',
        role: 'reviewer',
        depends_on: ['B', 'C'],
        capabilities_required: ['llm-api'],
      },
    ],
  };
}

/**
 * Fan-out template: A → B, A → C (no D merge).
 */
export function fanOutTemplateSchema(): Record<string, unknown> {
  return {
    tasks: [
      {
        id: 'A',
        title_template: 'Task A',
        type: 'analysis',
        role: 'architect',
        capabilities_required: ['llm-api'],
      },
      {
        id: 'B',
        title_template: 'Task B',
        type: 'code',
        role: 'developer',
        depends_on: ['A'],
        capabilities_required: ['llm-api'],
      },
      {
        id: 'C',
        title_template: 'Task C',
        type: 'code',
        role: 'developer',
        depends_on: ['A'],
        capabilities_required: ['llm-api'],
      },
    ],
  };
}

/**
 * Linear 3-task template: A → B → C
 */
export function linearTemplateSchema(): Record<string, unknown> {
  return {
    tasks: [
      {
        id: 'A',
        title_template: 'Task A',
        type: 'analysis',
        role: 'architect',
        capabilities_required: ['llm-api'],
      },
      {
        id: 'B',
        title_template: 'Task B',
        type: 'code',
        role: 'developer',
        depends_on: ['A'],
        capabilities_required: ['llm-api'],
      },
      {
        id: 'C',
        title_template: 'Task C',
        type: 'review',
        role: 'reviewer',
        depends_on: ['B'],
        capabilities_required: ['llm-api'],
      },
    ],
  };
}
