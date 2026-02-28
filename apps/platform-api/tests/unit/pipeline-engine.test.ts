import { describe, expect, it } from 'vitest';

import { detectDependencyCycle, derivePipelineState, validateTemplateSchema } from '../../src/orchestration/pipeline-engine.js';
import { resolveTemplateVariables, substituteTemplateVariables } from '../../src/orchestration/template-variables.js';

describe('pipeline engine unit', () => {
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

  it('resolves variables with defaults and applies substitution recursively', () => {
    const variables = [
      { name: 'feature', type: 'string' as const, required: true },
      { name: 'language', type: 'string' as const, default: 'typescript' },
    ];

    const resolved = resolveTemplateVariables(variables, { feature: 'login' });
    const output = substituteTemplateVariables(
      {
        title: 'Implement ${feature}',
        nested: { language: '${language}' },
      },
      resolved,
    );

    expect(resolved).toEqual({ feature: 'login', language: 'typescript' });
    expect(output).toEqual({ title: 'Implement login', nested: { language: 'typescript' } });
  });

  it('derives pipeline state from task state set', () => {
    expect(derivePipelineState(['ready', 'pending'])).toBe('pending');
    expect(derivePipelineState(['running', 'pending'])).toBe('active');
    expect(derivePipelineState(['awaiting_approval', 'pending'])).toBe('paused');
    expect(derivePipelineState(['failed', 'running', 'pending'])).toBe('failed');
    expect(derivePipelineState(['completed', 'failed'])).toBe('failed');
    expect(derivePipelineState(['cancelled', 'cancelled'])).toBe('cancelled');
    expect(derivePipelineState(['completed', 'completed'])).toBe('completed');
  });
});
