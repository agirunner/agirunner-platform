import { describe, expect, it } from 'vitest';

import { detectDependencyCycle, deriveWorkflowState, validateTemplateSchema } from '../../src/orchestration/workflow-engine.js';
import { resolveTemplateVariables, substituteTemplateVariables } from '../../src/orchestration/template-variables.js';

describe('workflow engine unit', () => {
  it('detects cycle path in template dependencies', () => {
    const cycle = detectDependencyCycle([
      { id: 'a', depends_on: ['c'] },
      { id: 'b', depends_on: ['a'] },
      { id: 'c', depends_on: ['b'] },
    ]);

    expect(cycle).toEqual(['a', 'c', 'b', 'a']);
  });

  it('rejects templates with cyclic dependency graph', () => {
    expect(() =>
      validateTemplateSchema({
        tasks: [
          { id: 'dev', title_template: 'dev', type: 'code', depends_on: ['test'] },
          { id: 'test', title_template: 'test', type: 'test', depends_on: ['dev'] },
        ],
      }),
    ).toThrow(/cycle/i);
  });

  it('rejects templates with 3-node cyclic dependency graph', () => {
    expect(() =>
      validateTemplateSchema({
        tasks: [
          { id: 'a', title_template: 'A', type: 'code', depends_on: ['c'] },
          { id: 'b', title_template: 'B', type: 'test', depends_on: ['a'] },
          { id: 'c', title_template: 'C', type: 'review', depends_on: ['b'] },
        ],
      }),
    ).toThrow(/cycle/i);
  });

  it('resolves variables with defaults and applies substitution recursively', () => {
    const variables = [
      { name: 'feature', type: 'string' as const, required: true },
      { name: 'language', type: 'string' as const, default: 'typescript' },
      { name: 'maxFiles', type: 'number' as const, default: 10 },
      { name: 'dryRun', type: 'boolean' as const, default: false },
      { name: 'metadata', type: 'json' as const, required: false },
    ];

    const resolved = resolveTemplateVariables(variables, { feature: 'login', dryRun: true });
    const output = substituteTemplateVariables(
      {
        title: 'Implement ${feature}',
        nested: { language: '${language}', dryRun: '${dryRun}' },
      },
      resolved,
    );

    expect(resolved).toEqual({
      feature: 'login',
      language: 'typescript',
      maxFiles: 10,
      dryRun: true,
    });
    expect(output).toEqual({ title: 'Implement login', nested: { language: 'typescript', dryRun: 'true' } });
  });

  it('substitutes double-brace template variables used by SDLC templates', () => {
    const resolved = resolveTemplateVariables(
      [
        { name: 'repo', type: 'string' as const, required: true },
        { name: 'goal', type: 'string' as const, required: true },
      ],
      { repo: 'playground-repo', goal: 'Add a settings page' },
    );

    const output = substituteTemplateVariables(
      {
        title: 'Architecture: {{goal}}',
        nested: {
          repo: '{{ repo }}',
          instruction: 'Implement {{goal}} in {{repo}}',
        },
      },
      resolved,
    );

    expect(output).toEqual({
      title: 'Architecture: Add a settings page',
      nested: {
        repo: 'playground-repo',
        instruction: 'Implement Add a settings page in playground-repo',
      },
    });
  });

  it('derives workflow state from task state set', () => {
    expect(deriveWorkflowState(['ready', 'pending'])).toBe('active');
    expect(deriveWorkflowState(['running', 'pending'])).toBe('active');
    expect(deriveWorkflowState(['awaiting_approval', 'pending'])).toBe('paused');
    expect(deriveWorkflowState(['awaiting_approval', 'ready'])).toBe('active');
    expect(deriveWorkflowState(['failed', 'running', 'pending'])).toBe('failed');
    expect(deriveWorkflowState(['completed', 'failed'])).toBe('failed');
    expect(deriveWorkflowState(['completed', 'cancelled'])).toBe('failed');
    expect(deriveWorkflowState(['cancelled', 'cancelled'])).toBe('cancelled');
    expect(deriveWorkflowState(['completed', 'completed'])).toBe('completed');
  });

  it('wraps flat templates into an implicit default workflow phase', () => {
    const schema = validateTemplateSchema({
      tasks: [{ id: 'build', title_template: 'Build', type: 'code' }],
    });

    expect(schema.workflow?.phases).toEqual([
      expect.objectContaining({
        name: 'default',
        gate: 'none',
        parallel: true,
        tasks: ['build'],
      }),
    ]);
  });

  it('rejects templates that mix depends_on and blocked_by aliases', () => {
    expect(() =>
      validateTemplateSchema({
        tasks: [
          { id: 'a', title_template: 'A', type: 'code', depends_on: [] },
          { id: 'b', title_template: 'B', type: 'test', blocked_by: ['a'] },
        ],
      }),
    ).toThrow(/cannot mix/i);
  });

  it('supports cross-phase dependency references and sequential phases', () => {
    const schema = validateTemplateSchema({
      tasks: [
        { id: 'spec', title_template: 'Spec', type: 'docs' },
        { id: 'build', title_template: 'Build', type: 'code', depends_on: ['plan.spec'] },
        { id: 'verify', title_template: 'Verify', type: 'test' },
      ],
      workflow: {
        phases: [
          { name: 'plan', tasks: ['spec'] },
          { name: 'execute', tasks: ['build', 'verify'], parallel: false },
        ],
      },
    });

    expect(schema.workflow?.phases.map((phase) => phase.name)).toEqual(['plan', 'execute']);
    expect(schema.tasks.find((task) => task.id === 'build')?.depends_on).toEqual(['plan.spec']);
    expect(schema.tasks.find((task) => task.id === 'verify')?.depends_on).toEqual(['build']);
  });
});
