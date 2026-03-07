import assert from 'node:assert/strict';
import test from 'node:test';

import { sdlcTemplateSchema } from '../scenarios/templates.js';

test('Generic SDLC Playground template defines explicit staged output contracts', () => {
  const schema = sdlcTemplateSchema();
  const variables = (schema.variables ?? []) as Array<Record<string, unknown>>;
  const tasks = (schema.tasks ?? []) as Array<Record<string, unknown>>;

  assert.equal(tasks.length, 4);

  const architect = tasks.find((task) => task.id === 'architect');
  const developer = tasks.find((task) => task.id === 'developer');
  const reviewer = tasks.find((task) => task.id === 'reviewer');
  const qa = tasks.find((task) => task.id === 'qa');

  assert.ok(architect);
  assert.ok(developer);
  assert.ok(reviewer);
  assert.ok(qa);
  assert.deepEqual(
    variables.map((variable) => variable.name),
    [
      'repo',
      'goal',
      'branch',
      'git_token',
      'git_ssh_private_key',
      'git_ssh_known_hosts',
      'git_user_name',
      'git_user_email',
    ],
  );
  assert.deepEqual((architect.environment as Record<string, unknown>), {
    repository_url: '{{repo}}',
    branch: '{{branch}}',
    git_user_name: '{{git_user_name}}',
    git_user_email: '{{git_user_email}}',
  });
  assert.deepEqual(((architect.input_template as Record<string, unknown>).credentials as Record<string, unknown>), {
    git_token: '{{git_token}}',
    git_ssh_private_key: '{{git_ssh_private_key}}',
    git_ssh_known_hosts: '{{git_ssh_known_hosts}}',
  });

  assert.deepEqual((architect.output_state as Record<string, unknown>).design_document, {
    mode: 'artifact',
    path: 'handoffs/architect/architecture-design.md',
    media_type: 'text/markdown; charset=utf-8',
    summary: 'Architecture and design artifact for downstream stages',
  });
  assert.equal(
    ((architect.role_config as Record<string, unknown>).output_schema as Record<string, unknown>).type,
    'object',
  );
  assert.deepEqual((architect.role_config as Record<string, unknown>).tools, [
    'file_read',
    'file_list',
    'git_status',
    'git_diff',
  ]);
  assert.match(
    String((architect.role_config as Record<string, unknown>).system_prompt),
    /Do not implement code, modify application source files, create commits, or push branches/,
  );
  assert.match(
    String((architect.role_config as Record<string, unknown>).system_prompt),
    /Set design_document to the markdown content/,
  );
  assert.match(
    String((architect.role_config as Record<string, unknown>).system_prompt),
    /handoffs\/architect\/architecture-design\.md/,
  );

  assert.deepEqual((developer.output_state as Record<string, unknown>).branch, {
    mode: 'git',
    summary: 'Branch that contains the implementation',
  });
  assert.deepEqual((developer.output_state as Record<string, unknown>).change_diff, {
    mode: 'diff',
    summary: 'Patch representing the implementation delta',
  });
  assert.deepEqual((developer.output_state as Record<string, unknown>).implementation_handoff, {
    mode: 'artifact',
    path: 'handoffs/developer/implementation-handoff.md',
    media_type: 'text/markdown; charset=utf-8',
    summary: 'Implementation handoff for review and QA',
  });
  assert.deepEqual((developer.context_template as Record<string, unknown>).handoff_contract, {
    architect: [
      'architecture_summary',
      'design_decisions',
      'implementation_handoff',
      'design_document',
    ],
  });
  assert.match(
    String((developer.role_config as Record<string, unknown>).system_prompt),
    /handoffs\/developer\/implementation-handoff\.md/,
  );
  assert.match(
    String((developer.role_config as Record<string, unknown>).system_prompt),
    /reviewer stage consumes/,
  );
  assert.deepEqual((developer.environment as Record<string, unknown>), {
    repository_url: '{{repo}}',
    branch: '{{branch}}',
    git_user_name: '{{git_user_name}}',
    git_user_email: '{{git_user_email}}',
  });

  assert.deepEqual((reviewer.output_state as Record<string, unknown>).review_report, {
    mode: 'artifact',
    path: 'handoffs/reviewer/review-report.md',
    media_type: 'text/markdown; charset=utf-8',
    summary: 'Structured review report',
  });
  assert.match(
    String((reviewer.role_config as Record<string, unknown>).system_prompt),
    /handoffs\/reviewer\/review-report\.md/,
  );
  assert.match(
    String((reviewer.role_config as Record<string, unknown>).system_prompt),
    /QA stage consumes/,
  );
  assert.deepEqual((qa.output_state as Record<string, unknown>).validation_report, {
    mode: 'artifact',
    path: 'handoffs/qa/validation-report.md',
    media_type: 'text/markdown; charset=utf-8',
    summary: 'QA validation report',
  });
  assert.match(
    String((qa.role_config as Record<string, unknown>).system_prompt),
    /handoffs\/developer\/implementation-handoff\.md/,
  );
  assert.match(
    String((qa.role_config as Record<string, unknown>).system_prompt),
    /handoffs\/reviewer\/review-report\.md/,
  );
  assert.deepEqual((qa.environment as Record<string, unknown>), {
    repository_url: '{{repo}}',
    branch: '{{branch}}',
    git_user_name: '{{git_user_name}}',
    git_user_email: '{{git_user_email}}',
  });
  assert.deepEqual((qa.context_template as Record<string, unknown>).handoff_contract, {
    developer: [
      'implementation_summary',
      'files_changed',
      'branch',
      'change_diff',
      'implementation_handoff',
    ],
    reviewer: ['review_outcome', 'review_summary', 'blocking_issues', 'review_report'],
  });
});
