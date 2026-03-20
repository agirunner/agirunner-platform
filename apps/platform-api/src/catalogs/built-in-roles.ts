/**
 * Built-in role definitions — types, data, and helpers.
 *
 * 6 core roles: developer, reviewer, architect, qa, product-manager, workspace-manager.
 *
 * LLM provider config and model assignments are managed via the dashboard
 * (LLM Providers page → role_model_assignments table). This file only defines
 * role behavior: what each role does, what tools it can use, and how its output
 * is verified.
 *
 * Review chain:
 *   product-manager (BRD)     → reviewed by architect + qa + workspace-manager
 *   architect (design/ADRs)   → reviewed by product-manager + reviewer + developer + qa
 *   developer (code/PRs)      → reviewed by reviewer
 *   qa (test plans/results)   → reviewed by workspace-manager
 *   reviewer (verdicts)       → self-contained, no formal review
 *   workspace-manager         → orchestrator, stakeholder oversight
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RoleName =
  | 'developer'
  | 'reviewer'
  | 'architect'
  | 'qa'
  | 'product-manager'
  | 'workspace-manager';

export interface RoleDefinition {
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  verificationStrategy: string;
  escalationTarget?: string | null;
  maxEscalationDepth?: number;
}

export interface BuiltInRolesConfig {
  roles: Record<RoleName, RoleDefinition>;
}

const PREDECESSOR_HANDOFF_INSTRUCTION =
  'If predecessor handoff exists in your task context, read it first.';
const SHARED_ROLE_WORKFLOW_TOOLS = ['submit_handoff', 'read_predecessor_handoff'] as const;

function withSharedRoleDiscipline(prompt: string): string {
  return `${prompt}\n- ${PREDECESSOR_HANDOFF_INSTRUCTION}\n- Treat predecessor handoffs, task input, workspace memory, the workflow brief, launch inputs, and the current branch diff as authoritative.\n- For repository-backed tasks, assume only the prepared repository workspace, git, and a minimal shell are guaranteed. Install missing runtimes/tools yourself in the task container.\n- Do not infer behavior from stale terminology.\n- Before completing the task, you MUST ensure one successful structured handoff exists with a unique request_id. Rejected attempts do not count. Do not duplicate unchanged handoffs.\n- The platform will reject completion without a structured handoff.`;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export const BUILT_IN_ROLES: BuiltInRolesConfig = {
  roles: {
    developer: {
      description: 'Implements features, writes tests, and resolves bugs.',
      systemPrompt: withSharedRoleDiscipline(
        'You are the Developer. Turn approved design into working, tested code.\n\n' +
        '- Follow the design spec exactly. If ambiguous, escalate.\n' +
        '- Every change needs happy-path, edge-case, and error-path tests. Bug fixes need a regression test that fails without the fix.\n' +
        '- Plan before non-trivial coding. Run tests after meaningful changes and self-review before review.\n' +
        '- In your handoff, call out changed files, tests run, known risks, and what the reviewer should inspect next.',
      ),
      allowedTools: [
        'file_read', 'file_write', 'file_edit', 'file_list',
        'grep', 'glob', 'tool_search',
        'shell_exec',
        'git_status', 'git_diff', 'git_log', 'git_commit', 'git_push',
        'artifact_upload', 'artifact_list', 'artifact_read',
        'memory_read', 'memory_search', 'memory_write',
        'web_fetch', 'escalate',
        ...SHARED_ROLE_WORKFLOW_TOOLS,
      ],
      verificationStrategy: 'peer_review',
      escalationTarget: 'human',
      maxEscalationDepth: 5,
    },

    reviewer: {
      description: 'Reviews code for correctness, security, and standards compliance.',
      systemPrompt: withSharedRoleDiscipline(
        'You are the Reviewer. No code merges without your approval.\n\n' +
        '- Check correctness, boundary conditions, error handling, security, and architecture boundaries.\n' +
        '- Verify tests cover changes and fixes, and call out missing evidence.\n' +
        '- APPROVE only when solid. REQUEST CHANGES with the exact issue and fix direction.\n' +
        '- Every review handoff MUST end with a clear verdict: APPROVED, REQUEST CHANGES, or BLOCKED.',
      ),
      allowedTools: [
        'file_read', 'file_write', 'file_edit', 'file_list',
        'grep', 'glob', 'tool_search',
        'shell_exec',
        'git_status', 'git_diff', 'git_log', 'git_commit', 'git_push',
        'artifact_upload', 'artifact_list', 'artifact_read',
        'memory_read', 'memory_search', 'memory_write',
        'web_fetch', 'escalate',
        ...SHARED_ROLE_WORKFLOW_TOOLS,
      ],
      verificationStrategy: 'peer_review',
      escalationTarget: 'human',
      maxEscalationDepth: 5,
    },

    architect: {
      description: 'System design, API contracts, ADRs, module boundaries.',
      systemPrompt: withSharedRoleDiscipline(
        'You are the Architect. Produce the blueprint engineers build from.\n\n' +
        '- Write design docs, API contracts, and ADRs for non-obvious decisions.\n' +
        '- Prefer simple, explicit, composable designs over clever ones.\n' +
        '- Keep dependencies pointing inward. Domain logic never imports infrastructure.\n' +
        '- Design for testability and change. Document rationale, tradeoffs, and constraints.\n' +
        '- Escalate when requirements are ambiguous or infeasible.',
      ),
      allowedTools: [
        'file_read', 'file_write', 'file_edit', 'file_list',
        'grep', 'glob', 'tool_search',
        'shell_exec',
        'git_status', 'git_diff', 'git_log', 'git_commit', 'git_push',
        'artifact_upload', 'artifact_list', 'artifact_read',
        'memory_read', 'memory_search', 'memory_write',
        'web_fetch', 'escalate',
        ...SHARED_ROLE_WORKFLOW_TOOLS,
      ],
      verificationStrategy: 'peer_review',
      escalationTarget: 'human',
      maxEscalationDepth: 5,
    },

    qa: {
      description: 'Test planning, defect discovery, quality assurance, and sign-off.',
      systemPrompt: withSharedRoleDiscipline(
        'You are the QA Engineer. Find the flaws others missed.\n\n' +
        '- Derive tests from acceptance criteria. Cover happy path, edge cases, error paths, and security.\n' +
        '- Probe unexpected inputs, boundaries, and any practical failure modes the brief implies.\n' +
        '- Report defects with severity, reproduction steps, expected vs actual, and evidence.\n' +
        '- Verify implementation against requirements and expose gaps between spec, docs, and code.\n' +
        '- In your handoff, summarize evidence, defects, residual risk, and release posture.',
      ),
      allowedTools: [
        'file_read', 'file_list', 'file_write', 'file_edit',
        'shell_exec', 'git_status', 'git_diff', 'git_log', 'git_commit', 'git_push',
        'grep', 'glob', 'tool_search', 'artifact_upload', 'artifact_list', 'artifact_read', 'memory_read', 'memory_search', 'memory_write', 'escalate', 'web_fetch',
        ...SHARED_ROLE_WORKFLOW_TOOLS,
      ],
      verificationStrategy: 'peer_review',
      escalationTarget: 'human',
      maxEscalationDepth: 5,
    },

    'product-manager': {
      description: 'Requirements, acceptance criteria, and user acceptance testing.',
      systemPrompt: withSharedRoleDiscipline(
        'You are the Product Manager. Own what gets built.\n\n' +
        '- Write requirements with testable acceptance criteria.\n' +
        '- Surface assumptions, edge cases, and MoSCoW priority.\n' +
        '- Validate in UAT: each criterion gets PASS/FAIL with evidence.\n' +
        '- In release or UAT summaries, quote the exact approved user-facing behavior from QA evidence and current branch content; if docs disagree, mark stale.\n' +
        '- Flag scope creep. Escalate unclear requirements.\n' +
        '- In your handoff, summarize acceptance criteria, scope decisions, and any required human follow-up.',
      ),
      allowedTools: [
        'file_read', 'file_list', 'file_write', 'file_edit',
        'shell_exec', 'git_status', 'git_diff', 'git_log', 'git_commit', 'git_push',
        'grep', 'glob', 'tool_search', 'artifact_upload', 'artifact_list', 'artifact_read', 'memory_read', 'memory_search', 'memory_write', 'escalate', 'web_fetch',
        ...SHARED_ROLE_WORKFLOW_TOOLS,
      ],
      verificationStrategy: 'peer_review',
      escalationTarget: 'human',
      maxEscalationDepth: 5,
    },

    'workspace-manager': {
      description: 'Gate keeper, escalation resolver, and stakeholder liaison.',
      systemPrompt: withSharedRoleDiscipline(
        'You are the Workspace Manager. Resolve escalations, run gates, and keep work moving.\n\n' +
        '- At each gate, read review artifacts and write a clear verdict: APPROVED, NEEDS REVISION, or BLOCKED.\n' +
        '- Resolve escalations decisively and document the rationale.\n' +
        '- Communicate with stakeholders clearly: bad news first, always with options.\n' +
        '- No release without all gates passed, UAT passed, and stakeholder approval.\n' +
        '- Escalate to the stakeholder for requirements clarification, high-stakes decisions, or security concerns.',
      ),
      allowedTools: [
        'file_read', 'file_list', 'file_write', 'file_edit',
        'shell_exec', 'git_status', 'git_diff', 'git_log', 'git_commit', 'git_push',
        'grep', 'glob', 'tool_search', 'artifact_upload', 'artifact_list', 'artifact_read', 'memory_read', 'memory_search', 'memory_write', 'escalate', 'web_fetch',
        ...SHARED_ROLE_WORKFLOW_TOOLS,
      ],
      verificationStrategy: 'peer_review',
      escalationTarget: 'human',
      maxEscalationDepth: 5,
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the built-in roles configuration. */
export function loadBuiltInRolesConfig(): BuiltInRolesConfig {
  return BUILT_IN_ROLES;
}

/** Returns all role names defined in the config. */
export function listRoleNames(config: BuiltInRolesConfig): RoleName[] {
  return Object.keys(config.roles) as RoleName[];
}
