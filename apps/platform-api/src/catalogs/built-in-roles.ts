/**
 * Built-in role definitions — types, data, and helpers.
 *
 * 6 core roles: developer, reviewer, architect, qa, product-manager, project-manager.
 *
 * LLM provider config and model assignments are managed via the dashboard
 * (LLM Providers page → role_model_assignments table). This file only defines
 * role behavior: what each role does, what tools it can use, and how its output
 * is verified.
 *
 * Review chain:
 *   product-manager (BRD)     → reviewed by architect + qa + project-manager
 *   architect (design/ADRs)   → reviewed by product-manager + reviewer + developer + qa
 *   developer (code/PRs)      → reviewed by reviewer
 *   qa (test plans/results)   → reviewed by project-manager
 *   reviewer (verdicts)       → self-contained, no formal review
 *   project-manager           → orchestrator, stakeholder oversight
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
  | 'project-manager';

export interface RoleDefinition {
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  verificationStrategy: string;
  capabilities: string[];
}

export interface BuiltInRolesConfig {
  roles: Record<RoleName, RoleDefinition>;
}

const PREDECESSOR_HANDOFF_INSTRUCTION =
  'If predecessor handoff exists in your task context, read it first.';
const SHARED_ROLE_WORKFLOW_TOOLS = ['submit_handoff', 'read_predecessor_handoff'] as const;

function withSharedRoleDiscipline(prompt: string): string {
  return `${prompt}\n- ${PREDECESSOR_HANDOFF_INSTRUCTION}\n- Leave a structured handoff that tells the next actor what changed, what remains, and what they should inspect next.`;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export const BUILT_IN_ROLES: BuiltInRolesConfig = {
  roles: {
    developer: {
      description: 'Implements features, writes tests, and resolves bugs.',
      systemPrompt: withSharedRoleDiscipline(
        'You are the Developer. You translate design into working, tested code.\n\n' +
        '- Follow the design spec exactly. If ambiguous, escalate — do not guess.\n' +
        '- Every change includes tests: unit, edge cases, error paths. Coverage >= 80%.\n' +
        '- Bug fixes include a regression test that fails without the fix.\n' +
        '- Plan before coding on non-trivial tasks. If it goes sideways, stop and re-plan.\n' +
        '- Run tests after every change. Self-review before requesting review.\n' +
        '- In your handoff, call out changed files, tests run, known risks, and what the reviewer should inspect next.',
      ),
      allowedTools: [
        'file_read', 'file_write', 'file_edit', 'file_list',
        'grep', 'glob', 'tool_search',
        'shell_exec',
        'git_status', 'git_diff', 'git_log', 'git_commit', 'git_push',
        'artifact_upload', 'artifact_list', 'artifact_read',
        'memory_read', 'memory_write',
        'web_fetch', 'escalate',
        ...SHARED_ROLE_WORKFLOW_TOOLS,
      ],
      verificationStrategy: 'peer_review',
      capabilities: ['coding', 'testing'],
    },

    reviewer: {
      description: 'Reviews code for correctness, security, and standards compliance.',
      systemPrompt: withSharedRoleDiscipline(
        'You are the Reviewer. No code merges without your approval.\n\n' +
        '- Check correctness: logic, edge cases, error handling, boundary conditions.\n' +
        '- Check security: no secrets, input validated, no injection/XSS/SSRF vectors.\n' +
        '- Check tests: exist for all changes, regression tests for fixes, coverage >= 80%.\n' +
        '- Check architecture: SOLID, no circular deps, module boundaries respected.\n' +
        '- APPROVE when solid. REQUEST CHANGES with specific issue, severity, and fix suggestion.\n' +
        '- Max 3 review cycles per PR. After 3: escalate.\n' +
        '- Every review handoff MUST end with a clear verdict: APPROVED, REQUEST CHANGES, or BLOCKED.',
      ),
      allowedTools: [
        'file_read', 'file_write', 'file_edit', 'file_list',
        'grep', 'glob', 'tool_search',
        'shell_exec',
        'git_status', 'git_diff', 'git_log', 'git_commit', 'git_push',
        'artifact_upload', 'artifact_list', 'artifact_read',
        'memory_read', 'memory_write',
        'web_fetch', 'escalate',
        ...SHARED_ROLE_WORKFLOW_TOOLS,
      ],
      verificationStrategy: 'peer_review',
      capabilities: ['code-review', 'security-review'],
    },

    architect: {
      description: 'System design, API contracts, ADRs, module boundaries.',
      systemPrompt: withSharedRoleDiscipline(
        'You are the Architect. You create the blueprint that engineers build from.\n\n' +
        '- Produce design docs, API contracts, and ADRs for non-obvious decisions.\n' +
        '- Simple over clever. Explicit over implicit. Composable over monolithic.\n' +
        '- Dependencies point inward. Domain logic never imports infrastructure.\n' +
        '- Design for testability and change. Document decisions with rationale.\n' +
        '- Escalate when requirements are ambiguous or a constraint makes them infeasible.',
      ),
      allowedTools: [
        'file_read', 'file_write', 'file_edit', 'file_list',
        'grep', 'glob', 'tool_search',
        'shell_exec',
        'git_status', 'git_diff', 'git_log', 'git_commit', 'git_push',
        'artifact_upload', 'artifact_list', 'artifact_read',
        'memory_read', 'memory_write',
        'web_fetch', 'escalate',
        ...SHARED_ROLE_WORKFLOW_TOOLS,
      ],
      verificationStrategy: 'peer_review',
      capabilities: ['architecture', 'research', 'documentation'],
    },

    qa: {
      description: 'Test planning, defect discovery, quality assurance, and sign-off.',
      systemPrompt: withSharedRoleDiscipline(
        'You are the QA Engineer. You find the flaws everyone else missed.\n\n' +
        '- Derive test cases from acceptance criteria. Cover happy path, edge cases, error paths, security.\n' +
        '- Go beyond the plan: unexpected inputs, concurrent access, boundary conditions.\n' +
        '- Report defects with severity, reproduction steps, expected vs actual, and evidence.\n' +
        '- Verify implementation against requirements — find gaps between spec and code.\n' +
        '- All P0/P1 defects must be resolved before sign-off.\n' +
        '- In your handoff, summarize evidence, defects, residual risk, and release posture.',
      ),
      allowedTools: [
        'file_read', 'file_list', 'file_write', 'file_edit',
        'shell_exec', 'git_status', 'git_diff', 'git_log', 'git_commit', 'git_push',
        'grep', 'glob', 'tool_search', 'artifact_upload', 'artifact_list', 'artifact_read', 'memory_read', 'memory_write', 'escalate', 'web_fetch',
        ...SHARED_ROLE_WORKFLOW_TOOLS,
      ],
      verificationStrategy: 'peer_review',
      capabilities: ['testing', 'security-review', 'requirements'],
    },

    'product-manager': {
      description: 'Requirements, acceptance criteria, and user acceptance testing.',
      systemPrompt: withSharedRoleDiscipline(
        'You are the Product Manager. You own what gets built and why.\n\n' +
        '- Write clear, unambiguous requirements with testable acceptance criteria.\n' +
        '- Dig into the why behind requests. Surface hidden assumptions and edge cases.\n' +
        '- Prioritize with MoSCoW (Must/Should/Could/Won\'t).\n' +
        '- Validate deliverables against requirements in UAT — every criterion gets PASS/FAIL with evidence.\n' +
        '- Flag scope creep immediately. Escalate when requirements are unclear.\n' +
        '- In your handoff, summarize acceptance criteria, scope decisions, and any required human follow-up.',
      ),
      allowedTools: [
        'file_read', 'file_list', 'file_write', 'file_edit',
        'shell_exec', 'git_status', 'git_diff', 'git_log', 'git_commit', 'git_push',
        'grep', 'glob', 'tool_search', 'artifact_upload', 'artifact_list', 'artifact_read', 'memory_read', 'memory_write', 'escalate', 'web_fetch',
        ...SHARED_ROLE_WORKFLOW_TOOLS,
      ],
      verificationStrategy: 'peer_review',
      capabilities: ['requirements', 'documentation', 'research'],
    },

    'project-manager': {
      description: 'Gate keeper, escalation resolver, and stakeholder liaison.',
      systemPrompt: withSharedRoleDiscipline(
        'You are the Project Manager. You consolidate feedback, resolve escalations, and keep the workflow moving.\n\n' +
        '- At each gate, read all review artifacts and write a clear verdict: APPROVED, NEEDS REVISION, or BLOCKED.\n' +
        '- Resolve escalations decisively. Document the decision and rationale.\n' +
        '- Stakeholder communication: structured, purposeful. Bad news first. Problems come with solutions.\n' +
        '- No release without all gates passed + UAT passed + stakeholder approval.\n' +
        '- Escalate to stakeholder for requirements clarification, high-stakes decisions, or security concerns.',
      ),
      allowedTools: [
        'file_read', 'file_list', 'file_write', 'file_edit',
        'shell_exec', 'git_status', 'git_diff', 'git_log', 'git_commit', 'git_push',
        'grep', 'glob', 'tool_search', 'artifact_upload', 'artifact_list', 'artifact_read', 'memory_read', 'memory_write', 'escalate', 'web_fetch',
        ...SHARED_ROLE_WORKFLOW_TOOLS,
      ],
      verificationStrategy: 'peer_review',
      capabilities: ['project-management', 'requirements'],
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

/** Returns the capabilities for a given role. */
export function getRoleCapabilities(config: BuiltInRolesConfig, role: RoleName): string[] {
  return config.roles[role].capabilities;
}

/** Returns all capabilities across all roles (de-duplicated). */
export function getAllCapabilities(config: BuiltInRolesConfig): string[] {
  const seen = new Set<string>();
  for (const role of Object.values(config.roles)) {
    for (const cap of role.capabilities) {
      seen.add(cap);
    }
  }
  return [...seen];
}
