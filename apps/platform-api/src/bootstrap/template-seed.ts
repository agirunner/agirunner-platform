import type pg from 'pg';

import { DEFAULT_TENANT_ID } from '../db/seed.js';

const DEFAULT_SDLC_SLUG = 'sdlc-4-role';

const ALL_TOOLS = [
  'file_read',
  'file_write',
  'file_list',
  'file_edit',
  'shell_exec',
  'git_status',
  'git_diff',
  'git_commit',
  'git_push',
  'artifact_upload',
  'web_fetch',
  'web_search',
  'code_lint',
  'code_typecheck',
  'code_build',
];

function sdlcTemplateSchema() {
  return {
    tasks: [
      {
        id: 'architect',
        role: 'architect',
        type: 'analysis',
        auto_retry: false,
        depends_on: [],
        environment: {
          branch: '{{branch}}',
          repository_url: '{{repo}}',
        },
        role_config: {
          tools: ALL_TOOLS,
          system_prompt:
            'You are a software architect. You design systems, set up project structure, and install any needed tools. You have full shell access in an isolated container. Install whatever toolchains and dependencies you need.',
        },
        input_template: {
          credentials: { git_token: '{{git_token}}' },
          description: [
            'You are the ARCHITECT. Goal: {{goal}}',
            '',
            'Repository: {{repo}}',
            'Branch: {{branch}}',
            '',
            'INSTRUCTIONS:',
            '1. Install any tools you need using shell_exec',
            '2. Create a feature branch if needed',
            '3. Initialize the project structure',
            '4. Write a DESIGN.md with: overview, architecture, file structure, implementation plan',
            '5. Upload DESIGN.md as an artifact using artifact_upload',
            '6. git add, commit, and push all files',
            '',
            'COMPLETION: Once all files are committed, pushed, and DESIGN.md is uploaded as artifact, your task is COMPLETE.',
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
        environment: {
          branch: '{{branch}}',
          repository_url: '{{repo}}',
        },
        role_config: {
          tools: ALL_TOOLS,
          system_prompt:
            'You are a senior developer. Write clean, tested code. Install any tools you need. Always run tests before committing.',
        },
        input_template: {
          credentials: { git_token: '{{git_token}}' },
          description: [
            'You are the DEVELOPER. Goal: {{goal}}',
            '',
            'Repository: {{repo}}',
            'Branch: {{branch}}',
            '',
            'INSTRUCTIONS:',
            '1. Install any tools you need using shell_exec',
            '2. Pull latest changes',
            '3. Read DESIGN.md for architecture',
            '4. Implement the application with proper structure',
            '5. Write unit tests',
            '6. Run tests to verify they pass',
            '7. Run build to verify compilation',
            '8. Write IMPLEMENTATION-NOTES.md describing what you built',
            '9. Upload IMPLEMENTATION-NOTES.md as artifact using artifact_upload',
            '10. git commit and push all files',
            '',
            'COMPLETION: Once code compiles, tests pass, files are committed/pushed, and notes uploaded as artifact, your task is COMPLETE.',
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
        environment: {
          branch: '{{branch}}',
          repository_url: '{{repo}}',
        },
        role_config: {
          tools: ALL_TOOLS,
          system_prompt:
            'You are a code reviewer. Be thorough but constructive. Focus on correctness, security, and maintainability. Install any tools you need for analysis.',
        },
        input_template: {
          credentials: { git_token: '{{git_token}}' },
          description: [
            'You are the CODE REVIEWER. Goal: Review the implementation of: {{goal}}',
            '',
            'Repository: {{repo}}',
            'Branch: {{branch}}',
            '',
            'INSTRUCTIONS:',
            '1. Install any tools you need using shell_exec',
            '2. Pull latest changes',
            '3. Read DESIGN.md to understand intent',
            '4. Read all implementation files',
            '5. Run tests and any linting/analysis tools',
            '6. Check for: correctness, code quality, test coverage, edge cases',
            '7. Write REVIEW.md with verdict, strengths, issues, recommendations',
            '8. Upload REVIEW.md as artifact using artifact_upload',
            '9. git commit and push REVIEW.md',
            '',
            'COMPLETION: Once REVIEW.md is committed, pushed, and uploaded as artifact, your task is COMPLETE.',
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
        environment: {
          branch: '{{branch}}',
          repository_url: '{{repo}}',
        },
        role_config: {
          tools: ALL_TOOLS,
          system_prompt:
            'You are a QA engineer. Execute tests, verify behavior, and document results thoroughly. Install any tools you need.',
        },
        input_template: {
          credentials: { git_token: '{{git_token}}' },
          description: [
            'You are the QA ENGINEER. Goal: Validate the implementation of: {{goal}}',
            '',
            'Repository: {{repo}}',
            'Branch: {{branch}}',
            '',
            'INSTRUCTIONS:',
            '1. Install any tools you need using shell_exec',
            '2. Pull latest changes',
            '3. Read DESIGN.md and REVIEW.md for context',
            '4. Run the test suite and verify all tests pass',
            '5. Build and run the application to verify correct output',
            '6. Write QA-REPORT.md with: test results, coverage, edge cases, final verdict (PASS/FAIL)',
            '7. Upload QA-REPORT.md as artifact using artifact_upload',
            '8. git commit and push QA-REPORT.md',
            '',
            'COMPLETION: Once QA-REPORT.md is committed, pushed, and uploaded as artifact, your task is COMPLETE.',
          ].join('\n'),
        },
        title_template: 'QA: {{goal}}',
        requires_approval: false,
      },
    ],
    runtime: {
      pool_mode: 'warm' as const,
      max_runtimes: 1,
      priority: 0,
      idle_timeout_seconds: 300,
      grace_period_seconds: 180,
      image: 'agirunner-runtime:local',
      pull_policy: 'if-not-present' as const,
      cpu: '1.0',
      memory: '512m',
    },
    task_container: {
      pool_mode: 'cold' as const,
      warm_pool_size: 0,
      image: '',
      pull_policy: 'if-not-present' as const,
      cpu: '0.5',
      memory: '256m',
    },
    workflow: {
      phases: [
        { name: 'design', gate: 'none', tasks: ['architect'], parallel: false },
        { name: 'implement', gate: 'none', tasks: ['developer'], parallel: false },
        { name: 'review', gate: 'none', tasks: ['reviewer'], parallel: false },
        { name: 'qa', gate: 'none', tasks: ['qa'], parallel: false },
      ],
    },
  };
}

export async function seedDefaultTemplates(pool: pg.Pool): Promise<void> {
  const existing = await pool.query(
    `SELECT id FROM templates WHERE tenant_id = $1 AND slug = $2 LIMIT 1`,
    [DEFAULT_TENANT_ID, DEFAULT_SDLC_SLUG],
  );

  if (existing.rowCount && existing.rowCount > 0) {
    return;
  }

  await pool.query(
    `INSERT INTO templates (tenant_id, name, slug, description, version, is_built_in, is_published, schema)
     VALUES ($1, $2, $3, $4, 1, true, true, $5)`,
    [
      DEFAULT_TENANT_ID,
      'SDLC 4-Role Pipeline',
      DEFAULT_SDLC_SLUG,
      'Standard 4-role SDLC pipeline: architect → developer → reviewer → QA. All roles have full tool access and install their own toolchains.',
      JSON.stringify(sdlcTemplateSchema()),
    ],
  );

  console.info('[template-seed] Default SDLC template seeded.');
}
