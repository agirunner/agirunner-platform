/**
 * Built-in template definitions — static data for default templates seeded on first run.
 */

const ALL_TOOLS = [
  'file_read', 'file_write', 'file_list', 'file_edit',
  'shell_exec', 'git_status', 'git_diff', 'git_log', 'git_commit', 'git_push',
  'artifact_upload', 'escalate', 'web_fetch', 'web_search',
];

const REPO_ENV = { branch: '{{branch}}', repository_url: '{{repo}}' };
const GIT_CREDS = { git_token: '{{git_token}}' };

export interface BuiltInTemplate {
  name: string;
  slug: string;
  description: string;
  schema: Record<string, unknown>;
}

export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  // ---------------------------------------------------------------------------
  // Legacy 4-role pipeline (kept for backwards compatibility)
  // ---------------------------------------------------------------------------
  {
    name: 'SDLC 4-Role Pipeline',
    slug: 'sdlc-4-role',
    description:
      'Simple 4-role SDLC pipeline: architect \u2192 developer \u2192 reviewer \u2192 QA. ' +
      'No review gates — each phase flows directly to the next.',
    schema: {
      variables: [
        { name: 'goal', type: 'string', required: true, description: 'What the workflow should build or accomplish' },
        { name: 'repo', type: 'string', required: true, description: 'Git repository URL' },
        { name: 'branch', type: 'string', required: true, default: 'main', description: 'Git branch to work on' },
        { name: 'git_token', type: 'string', required: false, default: '', description: 'Git access token for private repositories' },
      ],
      tasks: [
        {
          id: 'architect',
          role: 'architect',
          type: 'analysis',
          auto_retry: false,
          depends_on: [],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'Goal: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Write a DESIGN.md with: overview, architecture, file structure, implementation plan.',
              'Upload DESIGN.md as an artifact. Commit and push all files.',
            ].join('\n'),
          },
          title_template: 'Design: {{goal}}',
          requires_approval: false,
        },
        {
          id: 'developer',
          role: 'developer',
          type: 'code',
          auto_retry: false,
          depends_on: ['design.architect'],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'Goal: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Read DESIGN.md. Implement the application with tests.',
              'Run tests, verify build. Commit and push.',
            ].join('\n'),
          },
          title_template: 'Build: {{goal}}',
          requires_approval: false,
        },
        {
          id: 'reviewer',
          role: 'reviewer',
          type: 'review',
          auto_retry: false,
          depends_on: ['implement.developer'],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'Review the implementation of: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Read DESIGN.md for intent. Review all code for correctness, security, standards.',
              'Write REVIEW.md with verdict. Upload as artifact. Commit and push.',
            ].join('\n'),
          },
          title_template: 'Review: {{goal}}',
          requires_approval: false,
        },
        {
          id: 'qa',
          role: 'qa',
          type: 'test',
          auto_retry: false,
          depends_on: ['review.reviewer'],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'Validate the implementation of: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Run tests, verify behavior, check coverage.',
              'Write QA-REPORT.md with verdict (PASS/FAIL). Upload as artifact. Commit and push.',
            ].join('\n'),
          },
          title_template: 'QA: {{goal}}',
          requires_approval: false,
        },
      ],
      runtime: {
        pool_mode: 'warm',
        max_runtimes: 1,
        priority: 0,
        idle_timeout_seconds: 300,
        grace_period_seconds: 180,
        image: 'agirunner-runtime:local',
        pull_policy: 'if-not-present',
        cpu: '1.0',
        memory: '512m',
      },
      workflow: {
        phases: [
          { name: 'design', gate: 'none', tasks: ['architect'], parallel: false },
          { name: 'implement', gate: 'none', tasks: ['developer'], parallel: false },
          { name: 'review', gate: 'none', tasks: ['reviewer'], parallel: false },
          { name: 'qa', gate: 'none', tasks: ['qa'], parallel: false },
        ],
      },
    },
  },

  // ---------------------------------------------------------------------------
  // Full SDLC with review gates and human approvals
  // ---------------------------------------------------------------------------
  {
    name: 'Full SDLC Pipeline',
    slug: 'sdlc-full',
    description:
      'Complete SDLC with 6 roles, cross-role reviews, and human approval gates. ' +
      'Product Manager \u2192 Architect \u2192 Developer \u2192 Reviewer \u2192 QA \u2192 UAT, ' +
      'with parallel review phases and Project Manager orchestration.',
    schema: {
      variables: [
        { name: 'goal', type: 'string', required: true, description: 'What the workflow should build or accomplish' },
        { name: 'repo', type: 'string', required: true, description: 'Git repository URL' },
        { name: 'branch', type: 'string', required: true, default: 'main', description: 'Git branch to work on' },
        { name: 'git_token', type: 'string', required: false, default: '', description: 'Git access token for private repositories' },
      ],
      tasks: [
        // =====================================================================
        // Phase 1: Requirements — Product Manager writes BRD
        // =====================================================================
        {
          id: 'write-brd',
          role: 'product-manager',
          type: 'docs',
          auto_retry: false,
          depends_on: [],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'Goal: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Write a Business Requirements Document (BRD) covering:',
              '1. Purpose and scope',
              '2. Functional requirements (FR-001, FR-002, ...)',
              '3. Non-functional requirements (NFR-001, ...)',
              '4. Acceptance criteria in Given/When/Then format (AC-001, ...)',
              '5. MoSCoW prioritization (Must/Should/Could/Won\'t)',
              '6. Risks and dependencies',
              '',
              'Use RFC 2119 keywords (MUST, SHOULD, MAY) for obligation levels.',
              'Write to docs/requirements/brd.md. Upload as artifact. Commit and push.',
            ].join('\n'),
          },
          title_template: 'Requirements: {{goal}}',
          requires_approval: false,
        },

        // =====================================================================
        // Phase 2: Requirements Review — Architect + QA review BRD in parallel
        // =====================================================================
        {
          id: 'review-brd-feasibility',
          role: 'architect',
          type: 'review',
          auto_retry: false,
          depends_on: ['requirements.write-brd'],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'Review the BRD for: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Read docs/requirements/brd.md.',
              'Assess TECHNICAL FEASIBILITY:',
              '- Can we build this with available technology?',
              '- Are there infrastructure implications?',
              '- Are non-functional requirements achievable?',
              '- Identify any requirements that are technically infeasible or need refinement.',
              '',
              'Write your review to docs/reviews/brd-feasibility-review.md.',
              'Upload as artifact. Commit and push.',
            ].join('\n'),
          },
          title_template: 'Review BRD feasibility: {{goal}}',
          requires_approval: false,
        },
        {
          id: 'review-brd-testability',
          role: 'qa',
          type: 'review',
          auto_retry: false,
          depends_on: ['requirements.write-brd'],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'Review the BRD for: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Read docs/requirements/brd.md.',
              'Assess TESTABILITY:',
              '- Is every acceptance criterion specific, measurable, and testable?',
              '- Can each requirement be verified with automated or manual tests?',
              '- Are there missing edge cases or boundary conditions?',
              '- Flag any vague or untestable criteria.',
              '',
              'Write your review to docs/reviews/brd-testability-review.md.',
              'Upload as artifact. Commit and push.',
            ].join('\n'),
          },
          title_template: 'Review BRD testability: {{goal}}',
          requires_approval: false,
        },

        // =====================================================================
        // Phase 3: Requirements Gate — PM consolidates, human approves
        // =====================================================================
        {
          id: 'approve-requirements',
          role: 'project-manager',
          type: 'orchestration',
          auto_retry: false,
          depends_on: [
            'requirements-review.review-brd-feasibility',
            'requirements-review.review-brd-testability',
          ],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'Consolidate requirements reviews for: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Read:',
              '- docs/requirements/brd.md (the BRD)',
              '- docs/reviews/brd-feasibility-review.md (Architect feedback)',
              '- docs/reviews/brd-testability-review.md (QA feedback)',
              '',
              'Consolidate all feedback into a single assessment:',
              '1. Are requirements complete and unambiguous?',
              '2. Are there unresolved feasibility or testability concerns?',
              '3. Is the BRD ready for stakeholder approval, or does Product Manager need to revise?',
              '',
              'Write your assessment to docs/reviews/requirements-gate-assessment.md.',
              'Include a clear recommendation: READY FOR APPROVAL or NEEDS REVISION.',
              'Upload as artifact. Commit and push.',
            ].join('\n'),
          },
          title_template: 'Gate: Requirements approval for {{goal}}',
          requires_approval: true,
        },

        // =====================================================================
        // Phase 4: Design — Architect writes system design
        // =====================================================================
        {
          id: 'write-design',
          role: 'architect',
          type: 'analysis',
          auto_retry: false,
          depends_on: ['requirements-gate.approve-requirements'],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'Design the system for: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Read docs/requirements/brd.md for approved requirements.',
              '',
              'Produce a comprehensive design covering:',
              '1. Overview and architecture',
              '2. Data model',
              '3. API design (OpenAPI spec if applicable)',
              '4. Module structure and boundaries',
              '5. Error handling strategy',
              '6. Security considerations',
              '7. Non-functional requirements approach',
              '8. Technology choices with justification',
              '9. Open questions and risks',
              '',
              'Write ADRs for non-obvious decisions (docs/design/adr/adr-NNN.md).',
              'Write main design to docs/design/design.md.',
              'Upload as artifact. Commit and push.',
            ].join('\n'),
          },
          title_template: 'Design: {{goal}}',
          requires_approval: false,
        },

        // =====================================================================
        // Phase 5: Design Review — 4 roles review in parallel
        // =====================================================================
        {
          id: 'review-design-requirements',
          role: 'product-manager',
          type: 'review',
          auto_retry: false,
          depends_on: ['design.write-design'],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'Review the design for: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Read docs/design/design.md and docs/requirements/brd.md.',
              'Assess REQUIREMENTS COVERAGE:',
              '- Does the design address every functional requirement?',
              '- Are all acceptance criteria achievable with this design?',
              '- Is anything missing or misinterpreted?',
              '',
              'Write to docs/reviews/design-requirements-review.md.',
              'Upload as artifact. Commit and push.',
            ].join('\n'),
          },
          title_template: 'Review design (requirements): {{goal}}',
          requires_approval: false,
        },
        {
          id: 'review-design-security',
          role: 'reviewer',
          type: 'review',
          auto_retry: false,
          depends_on: ['design.write-design'],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'Review the design for: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Read docs/design/design.md.',
              'Assess SECURITY POSTURE:',
              '- Attack surface analysis',
              '- Authentication and authorization model',
              '- Data exposure and sensitive data handling',
              '- Input validation strategy',
              '- Dependency security concerns',
              '',
              'Write to docs/reviews/design-security-review.md.',
              'Upload as artifact. Commit and push.',
            ].join('\n'),
          },
          title_template: 'Review design (security): {{goal}}',
          requires_approval: false,
        },
        {
          id: 'review-design-implementability',
          role: 'developer',
          type: 'review',
          auto_retry: false,
          depends_on: ['design.write-design'],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'Review the design for: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Read docs/design/design.md.',
              'Assess IMPLEMENTABILITY:',
              '- Can I actually build this as specified?',
              '- Are module boundaries clear and practical?',
              '- Are there dependency or tooling concerns?',
              '- Are there ambiguous areas that need clarification before coding?',
              '',
              'Write to docs/reviews/design-implementability-review.md.',
              'Upload as artifact. Commit and push.',
            ].join('\n'),
          },
          title_template: 'Review design (implementability): {{goal}}',
          requires_approval: false,
        },
        {
          id: 'review-design-verifiability',
          role: 'qa',
          type: 'review',
          auto_retry: false,
          depends_on: ['design.write-design'],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'Review the design for: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Read docs/design/design.md.',
              'Assess VERIFIABILITY:',
              '- Are there testable interfaces?',
              '- Can behavior be observed and measured externally?',
              '- Is the design testable in isolation (unit) and as a system (integration)?',
              '- What test infrastructure will be needed?',
              '',
              'Write to docs/reviews/design-verifiability-review.md.',
              'Upload as artifact. Commit and push.',
            ].join('\n'),
          },
          title_template: 'Review design (verifiability): {{goal}}',
          requires_approval: false,
        },

        // =====================================================================
        // Phase 6: Design Gate — PM consolidates design reviews
        // =====================================================================
        {
          id: 'approve-design',
          role: 'project-manager',
          type: 'orchestration',
          auto_retry: false,
          depends_on: [
            'design-review.review-design-requirements',
            'design-review.review-design-security',
            'design-review.review-design-implementability',
            'design-review.review-design-verifiability',
          ],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'Consolidate design reviews for: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Read all design review documents in docs/reviews/design-*-review.md.',
              'Read docs/design/design.md.',
              '',
              'Consolidate feedback:',
              '1. Are there unresolved security, feasibility, or requirements coverage concerns?',
              '2. Does the Architect need to revise the design?',
              '3. Is the design ready for implementation?',
              '',
              'Write to docs/reviews/design-gate-assessment.md.',
              'Include: APPROVED or NEEDS REVISION with specific action items.',
              'Upload as artifact. Commit and push.',
            ].join('\n'),
          },
          title_template: 'Gate: Design approval for {{goal}}',
          requires_approval: false,
        },

        // =====================================================================
        // Phase 7: Implementation — Developer builds it
        // =====================================================================
        {
          id: 'implement',
          role: 'developer',
          type: 'code',
          auto_retry: false,
          depends_on: ['design-gate.approve-design'],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'Implement: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Read docs/design/design.md for the approved architecture.',
              'Read docs/requirements/brd.md for acceptance criteria.',
              '',
              'Implementation requirements:',
              '1. Create feature branch: feature/<issue>-<description>',
              '2. Implement according to design spec',
              '3. Write unit tests (coverage >= 80%)',
              '4. Write integration tests for module boundaries',
              '5. Run all tests — they must pass',
              '6. Run linter — no errors',
              '7. Self-review before marking complete',
              '8. Commit and push. Open a PR if possible.',
              '',
              'Follow coding standards: max 40-line functions, 300-line files, 3 nesting levels.',
              'No hardcoded secrets. Validate all input. Parameterized queries only.',
            ].join('\n'),
          },
          title_template: 'Implement: {{goal}}',
          requires_approval: false,
        },

        // =====================================================================
        // Phase 8: Code Review — Reviewer reviews the implementation
        // =====================================================================
        {
          id: 'review-code',
          role: 'reviewer',
          type: 'review',
          auto_retry: false,
          depends_on: ['implement.implement'],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'Review the implementation of: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Read docs/design/design.md for intended architecture.',
              '',
              'Review checklist:',
              '- Correctness: logic, error handling, boundary conditions, data integrity',
              '- Security: no secrets, input validated, deps pinned, no injection vectors',
              '- Standards: coding conventions, commit format, PR description, module boundaries',
              '- Tests: exist for all changes, regression tests for fixes, coverage >= 80%',
              '- Architecture: SOLID principles, no code smells, complexity matches problem',
              '- Performance: no N+1, no unbounded collections, no hot-path waste',
              '',
              'Verdict: APPROVED or REQUEST CHANGES.',
              'Write to docs/reviews/code-review.md with [SEVERITY | CONFIDENCE] for each finding.',
              'Upload as artifact. Commit and push.',
            ].join('\n'),
          },
          title_template: 'Code review: {{goal}}',
          requires_approval: false,
        },

        // =====================================================================
        // Phase 9: QA Testing — QA validates everything
        // =====================================================================
        {
          id: 'test',
          role: 'qa',
          type: 'test',
          auto_retry: false,
          depends_on: ['code-review.review-code'],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'QA validation for: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Read docs/requirements/brd.md for acceptance criteria.',
              'Read docs/design/design.md for expected behavior.',
              'Read docs/reviews/code-review.md for any noted concerns.',
              '',
              '1. Write test plan in docs/testing/test-plan.md',
              '2. Execute test plan — every case, every path',
              '3. Exploratory testing: unexpected inputs, concurrency, error recovery',
              '4. Spec compliance: gap analysis against BRD requirements',
              '5. Implementation completeness: no TODO/FIXME, no stubs, no hardcoded values',
              '6. Record results: PASS/FAIL with evidence',
              '',
              'Write results to docs/testing/test-results.md.',
              'Write QA sign-off to docs/testing/qa-signoff.md.',
              'Upload as artifacts. Commit and push.',
            ].join('\n'),
          },
          title_template: 'QA: {{goal}}',
          requires_approval: false,
        },

        // =====================================================================
        // Phase 10: QA Gate — PM reviews QA results, human approves
        // =====================================================================
        {
          id: 'approve-qa',
          role: 'project-manager',
          type: 'orchestration',
          auto_retry: false,
          depends_on: ['qa.test'],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'Review QA results for: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Read:',
              '- docs/testing/test-plan.md',
              '- docs/testing/test-results.md',
              '- docs/testing/qa-signoff.md',
              '',
              'Verify:',
              '1. Test plan covers all acceptance criteria from BRD',
              '2. All P0/P1 defects resolved',
              '3. Regression suite passed',
              '4. QA sign-off is justified by evidence',
              '',
              'Write to docs/reviews/qa-gate-assessment.md.',
              'Include: PROCEED TO UAT or NEEDS REWORK.',
              'Upload as artifact. Commit and push.',
            ].join('\n'),
          },
          title_template: 'Gate: QA approval for {{goal}}',
          requires_approval: true,
        },

        // =====================================================================
        // Phase 11: UAT — Product Manager validates against acceptance criteria
        // =====================================================================
        {
          id: 'run-uat',
          role: 'product-manager',
          type: 'test',
          auto_retry: false,
          depends_on: ['qa-gate.approve-qa'],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'User Acceptance Testing for: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Read docs/requirements/brd.md for acceptance criteria.',
              '',
              'For EVERY acceptance criterion:',
              '1. Execute the scenario as specified',
              '2. Record PASS or FAIL with evidence',
              '3. For failures: create a detailed issue description',
              '',
              'Write UAT results to docs/uat/uat-results.md.',
              'Upload as artifact. Commit and push.',
            ].join('\n'),
          },
          title_template: 'UAT: {{goal}}',
          requires_approval: false,
        },

        // =====================================================================
        // Phase 12: Release Gate — PM prepares release, human approves
        // =====================================================================
        {
          id: 'prepare-release',
          role: 'project-manager',
          type: 'orchestration',
          auto_retry: false,
          depends_on: ['uat.run-uat'],
          environment: REPO_ENV,
          role_config: { tools: ALL_TOOLS },
          input_template: {
            credentials: GIT_CREDS,
            description: [
              'Prepare release for: {{goal}}',
              'Repository: {{repo}} (branch: {{branch}})',
              '',
              'Read docs/uat/uat-results.md for UAT verdict.',
              '',
              'Verify all gates passed:',
              '1. Requirements approved',
              '2. Design approved',
              '3. Code review passed',
              '4. QA signed off',
              '5. UAT passed — all acceptance criteria met',
              '',
              'Prepare:',
              '- Release notes in docs/releases/release-notes.md',
              '- Verify README and documentation are current',
              '- Tag version if appropriate',
              '',
              'Write final assessment to docs/reviews/release-assessment.md.',
              'Include: READY FOR RELEASE or BLOCKED (with reasons).',
              'Upload as artifact. Commit and push.',
            ].join('\n'),
          },
          title_template: 'Gate: Release approval for {{goal}}',
          requires_approval: true,
        },
      ],
      runtime: {
        pool_mode: 'warm',
        max_runtimes: 2,
        priority: 0,
        idle_timeout_seconds: 300,
        grace_period_seconds: 180,
        image: 'agirunner-runtime:local',
        pull_policy: 'if-not-present',
        cpu: '1.0',
        memory: '512m',
      },
      workflow: {
        phases: [
          // Requirements
          { name: 'requirements', gate: 'all_complete', tasks: ['write-brd'], parallel: false },
          { name: 'requirements-review', gate: 'all_complete', tasks: ['review-brd-feasibility', 'review-brd-testability'], parallel: true },
          { name: 'requirements-gate', gate: 'manual', tasks: ['approve-requirements'], parallel: false },

          // Design
          { name: 'design', gate: 'all_complete', tasks: ['write-design'], parallel: false },
          { name: 'design-review', gate: 'all_complete', tasks: ['review-design-requirements', 'review-design-security', 'review-design-implementability', 'review-design-verifiability'], parallel: true },
          { name: 'design-gate', gate: 'all_complete', tasks: ['approve-design'], parallel: false },

          // Build
          { name: 'implement', gate: 'all_complete', tasks: ['implement'], parallel: false },
          { name: 'code-review', gate: 'all_complete', tasks: ['review-code'], parallel: false },

          // Verify
          { name: 'qa', gate: 'all_complete', tasks: ['test'], parallel: false },
          { name: 'qa-gate', gate: 'manual', tasks: ['approve-qa'], parallel: false },

          // Accept & Release
          { name: 'uat', gate: 'all_complete', tasks: ['run-uat'], parallel: false },
          { name: 'release', gate: 'manual', tasks: ['prepare-release'], parallel: false },
        ],
      },
    },
  },
];
