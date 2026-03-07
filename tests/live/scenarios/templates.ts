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
const ARCHITECTURE_DOCUMENT_PATH = 'handoffs/architect/architecture-design.md';
const IMPLEMENTATION_HANDOFF_PATH = 'handoffs/developer/implementation-handoff.md';
const REVIEW_REPORT_PATH = 'handoffs/reviewer/review-report.md';
const QA_REPORT_PATH = 'handoffs/qa/validation-report.md';

function sdlcTaskEnvironment(): Record<string, unknown> {
  return {
    repository_url: '{{repo}}',
    branch: '{{branch}}',
    git_user_name: '{{git_user_name}}',
    git_user_email: '{{git_user_email}}',
  };
}

function sdlcGitCredentials(): Record<string, unknown> {
  return {
    git_token: '{{git_token}}',
    git_ssh_private_key: '{{git_ssh_private_key}}',
    git_ssh_known_hosts: '{{git_ssh_known_hosts}}',
  };
}

function architectOutputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: [
      'architecture_summary',
      'design_decisions',
      'implementation_handoff',
      'design_document',
    ],
    properties: {
      architecture_summary: { type: 'string', minLength: 1 },
      design_decisions: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
      implementation_handoff: { type: 'string', minLength: 1 },
      design_document: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  };
}

function developerOutputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: [
      'implementation_summary',
      'files_changed',
      'branch',
      'change_diff',
      'implementation_handoff',
    ],
    properties: {
      implementation_summary: { type: 'string', minLength: 1 },
      files_changed: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
      branch: { type: 'string', minLength: 1 },
      change_diff: { type: 'string', minLength: 1 },
      implementation_handoff: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  };
}

function reviewerOutputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: ['review_outcome', 'review_summary', 'blocking_issues', 'review_report'],
    properties: {
      review_outcome: { enum: ['approved', 'changes_requested', 'rejected'] },
      review_summary: { type: 'string', minLength: 1 },
      blocking_issues: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
      review_report: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  };
}

function qaOutputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: ['qa_outcome', 'validation_summary', 'executed_checks', 'validation_report'],
    properties: {
      qa_outcome: { enum: ['passed', 'failed', 'blocked'] },
      validation_summary: { type: 'string', minLength: 1 },
      executed_checks: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
      validation_report: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  };
}

export function sdlcTemplateSchema(params?: {
  inputTemplate?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    variables: [
      { name: 'repo', type: 'string', required: true },
      { name: 'goal', type: 'string', required: true },
      { name: 'branch', type: 'string', required: false, default: 'main' },
      { name: 'git_token', type: 'string', required: false, default: '' },
      { name: 'git_ssh_private_key', type: 'string', required: false, default: '' },
      { name: 'git_ssh_known_hosts', type: 'string', required: false, default: '' },
      { name: 'git_user_name', type: 'string', required: false, default: 'Agirunner' },
      { name: 'git_user_email', type: 'string', required: false, default: 'agirunner@example.com' },
    ],
    tasks: [
      {
        id: 'architect',
        title_template: 'Architecture: {{goal}}',
        type: 'analysis',
        role: 'architect',
        capabilities_required: ['llm-api', 'role:architect'],
        role_config: {
          tools: ['file_read', 'file_list', 'git_status', 'git_diff'],
          system_prompt:
            'Return JSON only. Stay in design mode. Do not implement code, modify application source files, ' +
            'create commits, or push branches. Use only read-only analysis tools. Produce ' +
            'architecture_summary, design_decisions, implementation_handoff, and design_document. Set design_document ' +
            'to the markdown content for the design artifact; the platform persists it automatically at ' +
            `${ARCHITECTURE_DOCUMENT_PATH}. The developer stage consumes ` +
            'architecture_summary, design_decisions, implementation_handoff, and the persisted design_document ' +
            'from that path as its source of truth.',
          output_schema: architectOutputSchema(),
        },
        input_template: params?.inputTemplate ?? {
          repo: '{{repo}}',
          goal: '{{goal}}',
          credentials: sdlcGitCredentials(),
          instruction:
            'Design {{goal}} in {{repo}}. Do not implement, commit, or push. Produce a structured architecture ' +
            `handoff and set design_document to markdown content that the platform will persist at ${ARCHITECTURE_DOCUMENT_PATH} for the developer stage.`,
        },
        environment: sdlcTaskEnvironment(),
        output_state: {
          architecture_summary: 'inline',
          design_decisions: 'inline',
          implementation_handoff: 'inline',
          design_document: {
            mode: 'artifact',
            path: ARCHITECTURE_DOCUMENT_PATH,
            media_type: 'text/markdown; charset=utf-8',
            summary: 'Architecture and design artifact for downstream stages',
          },
        },
      },
      {
        id: 'developer',
        title_template: 'Develop: {{goal}}',
        type: 'code',
        role: 'developer',
        depends_on: ['architect'],
        capabilities_required: ['llm-api', 'role:developer'],
        role_config: {
          system_prompt:
            'Return JSON only. Read upstream_outputs.architect.architecture_summary, ' +
            'upstream_outputs.architect.design_decisions, upstream_outputs.architect.implementation_handoff, ' +
            `and upstream_outputs.architect.design_document from ${ARCHITECTURE_DOCUMENT_PATH}. Produce ` +
            'implementation_summary, files_changed, branch, change_diff, and implementation_handoff. Set ' +
            `implementation_handoff to markdown content that the platform will persist at ${IMPLEMENTATION_HANDOFF_PATH}. The reviewer stage ` +
            `consumes implementation_summary, files_changed, branch, change_diff, and ${IMPLEMENTATION_HANDOFF_PATH}; ` +
            `the QA stage also consumes ${IMPLEMENTATION_HANDOFF_PATH}.`,
          output_schema: developerOutputSchema(),
        },
        input_template: {
          repo: '{{repo}}',
          goal: '{{goal}}',
          credentials: sdlcGitCredentials(),
          instruction:
            'Implement {{goal}} in {{repo}} using the architect handoff and persisted design document as the ' +
            `source of truth. Set implementation_handoff to markdown content that the platform will persist at ${IMPLEMENTATION_HANDOFF_PATH} for ` +
            'reviewer and QA consumption.',
        },
        environment: sdlcTaskEnvironment(),
        context_template: {
          handoff_contract: {
            architect: [
              'architecture_summary',
              'design_decisions',
              'implementation_handoff',
              'design_document',
            ],
          },
        },
        output_state: {
          implementation_summary: 'inline',
          files_changed: 'inline',
          branch: {
            mode: 'git',
            summary: 'Branch that contains the implementation',
          },
          change_diff: {
            mode: 'diff',
            summary: 'Patch representing the implementation delta',
          },
          implementation_handoff: {
            mode: 'artifact',
            path: IMPLEMENTATION_HANDOFF_PATH,
            media_type: 'text/markdown; charset=utf-8',
            summary: 'Implementation handoff for review and QA',
          },
        },
      },
      {
        id: 'reviewer',
        title_template: 'Review: {{goal}}',
        type: 'review',
        role: 'reviewer',
        depends_on: ['developer'],
        capabilities_required: ['llm-api', 'role:reviewer'],
        role_config: {
          system_prompt:
            'Return JSON only. Review upstream_outputs.developer.implementation_summary, files_changed, ' +
            `branch, change_diff, and implementation_handoff from ${IMPLEMENTATION_HANDOFF_PATH}. Produce ` +
            `review_outcome, review_summary, blocking_issues, and review_report. Set review_report to markdown content that the platform will persist at ${REVIEW_REPORT_PATH}. ` +
            `The QA stage consumes review_outcome, review_summary, blocking_issues, and ${REVIEW_REPORT_PATH}.`,
          output_schema: reviewerOutputSchema(),
        },
        input_template: {
          repo: '{{repo}}',
          goal: '{{goal}}',
          credentials: sdlcGitCredentials(),
          instruction:
            'Review the developer implementation for {{goal}} in {{repo}}. Consume the implementation handoff ' +
            `from ${IMPLEMENTATION_HANDOFF_PATH} and set review_report to markdown content that the platform will persist at ${REVIEW_REPORT_PATH} for QA.`,
        },
        environment: sdlcTaskEnvironment(),
        context_template: {
          handoff_contract: {
            developer: [
              'implementation_summary',
              'files_changed',
              'branch',
              'change_diff',
              'implementation_handoff',
            ],
          },
        },
        output_state: {
          review_outcome: 'inline',
          review_summary: 'inline',
          blocking_issues: 'inline',
          review_report: {
            mode: 'artifact',
            path: REVIEW_REPORT_PATH,
            media_type: 'text/markdown; charset=utf-8',
            summary: 'Structured review report',
          },
        },
      },
      {
        id: 'qa',
        title_template: 'QA: {{goal}}',
        type: 'test',
        role: 'qa',
        depends_on: ['reviewer'],
        capabilities_required: ['llm-api', 'role:qa'],
        role_config: {
          system_prompt:
            'Return JSON only. Validate upstream_outputs.developer and upstream_outputs.reviewer. Consume the ' +
            `developer implementation handoff from ${IMPLEMENTATION_HANDOFF_PATH} and the reviewer report from ${REVIEW_REPORT_PATH}. ` +
            `Produce qa_outcome, validation_summary, executed_checks, and validation_report. Set validation_report to markdown content that the platform will persist at ${QA_REPORT_PATH} as the final stage output.`,
          output_schema: qaOutputSchema(),
        },
        input_template: {
          repo: '{{repo}}',
          goal: '{{goal}}',
          credentials: sdlcGitCredentials(),
          instruction:
            'Validate {{goal}} in {{repo}} using the developer handoff at ' +
            `${IMPLEMENTATION_HANDOFF_PATH} and the reviewer report at ${REVIEW_REPORT_PATH}. Set validation_report to markdown content that the platform will persist at ${QA_REPORT_PATH}.`,
        },
        environment: sdlcTaskEnvironment(),
        context_template: {
          handoff_contract: {
            developer: [
              'implementation_summary',
              'files_changed',
              'branch',
              'change_diff',
              'implementation_handoff',
            ],
            reviewer: ['review_outcome', 'review_summary', 'blocking_issues', 'review_report'],
          },
        },
        output_state: {
          qa_outcome: 'inline',
          validation_summary: 'inline',
          executed_checks: 'inline',
          validation_report: {
            mode: 'artifact',
            path: QA_REPORT_PATH,
            media_type: 'text/markdown; charset=utf-8',
            summary: 'QA validation report',
          },
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
