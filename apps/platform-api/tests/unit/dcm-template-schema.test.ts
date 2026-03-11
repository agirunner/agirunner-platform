import { describe, expect, it } from 'vitest';

import { validateTemplateSchema } from '../../src/orchestration/workflow-engine.js';

function minimalTemplate(overrides: Record<string, unknown> = {}) {
  return {
    tasks: [
      { id: 'task1', title_template: 'Task 1', type: 'code' },
    ],
    ...overrides,
  };
}

describe('DCM template schema validation', () => {
  describe('runtime section', () => {
    it('accepts template without runtime section', () => {
      const result = validateTemplateSchema(minimalTemplate());
      expect(result.runtime).toBeUndefined();
    });

    it('accepts valid runtime section with all fields', () => {
      const result = validateTemplateSchema(minimalTemplate({
        runtime: {
          pool_mode: 'warm',
          max_runtimes: 2,
          priority: 10,
          idle_timeout_seconds: 300,
          grace_period_seconds: 180,
          image: 'agirunner-runtime:v1.0',
          pull_policy: 'always',
          cpu: '1.0',
          memory: '512m',
        },
      }));

      expect(result.runtime).toEqual({
        pool_mode: 'warm',
        max_runtimes: 2,
        priority: 10,
        idle_timeout_seconds: 300,
        grace_period_seconds: 180,
        image: 'agirunner-runtime:v1.0',
        pull_policy: 'always',
        cpu: '1.0',
        memory: '512m',
      });
    });

    it('accepts runtime section with partial fields', () => {
      const result = validateTemplateSchema(minimalTemplate({
        runtime: { pool_mode: 'cold', max_runtimes: 3 },
      }));

      expect(result.runtime?.pool_mode).toBe('cold');
      expect(result.runtime?.max_runtimes).toBe(3);
    });

    it('rejects invalid pool_mode', () => {
      expect(() => validateTemplateSchema(minimalTemplate({
        runtime: { pool_mode: 'hot' },
      }))).toThrow(/pool_mode/);
    });

    it('rejects negative max_runtimes', () => {
      expect(() => validateTemplateSchema(minimalTemplate({
        runtime: { max_runtimes: -1 },
      }))).toThrow(/max_runtimes/);
    });

    it('rejects zero max_runtimes', () => {
      expect(() => validateTemplateSchema(minimalTemplate({
        runtime: { max_runtimes: 0 },
      }))).toThrow(/max_runtimes/);
    });

    it('rejects non-integer max_runtimes', () => {
      expect(() => validateTemplateSchema(minimalTemplate({
        runtime: { max_runtimes: 1.5 },
      }))).toThrow(/max_runtimes/);
    });

    it('rejects negative priority', () => {
      expect(() => validateTemplateSchema(minimalTemplate({
        runtime: { priority: -1 },
      }))).toThrow(/priority/);
    });

    it('rejects negative idle_timeout_seconds', () => {
      expect(() => validateTemplateSchema(minimalTemplate({
        runtime: { idle_timeout_seconds: -10 },
      }))).toThrow(/idle_timeout_seconds/);
    });

    it('rejects negative grace_period_seconds', () => {
      expect(() => validateTemplateSchema(minimalTemplate({
        runtime: { grace_period_seconds: -5 },
      }))).toThrow(/grace_period_seconds/);
    });

    it('rejects empty image string', () => {
      expect(() => validateTemplateSchema(minimalTemplate({
        runtime: { image: '' },
      }))).toThrow(/image/);
    });

    it('rejects invalid pull_policy', () => {
      expect(() => validateTemplateSchema(minimalTemplate({
        runtime: { pull_policy: 'sometimes' },
      }))).toThrow(/pull_policy/);
    });

    it('accepts all valid pull_policy values', () => {
      for (const policy of ['always', 'if-not-present', 'never']) {
        const result = validateTemplateSchema(minimalTemplate({
          runtime: { pull_policy: policy },
        }));
        expect(result.runtime?.pull_policy).toBe(policy);
      }
    });

    it('rejects non-object runtime section', () => {
      expect(() => validateTemplateSchema(minimalTemplate({
        runtime: 'invalid',
      }))).toThrow(/runtime.*object/i);
    });
  });

});
