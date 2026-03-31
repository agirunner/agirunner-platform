import { describe, expect, it } from 'vitest';

import { validateOutputSchema } from '../../../src/services/task-completion-side-effects.js';

describe('validateOutputSchema', () => {
  it('returnsNoErrorsWhenOutputMatchesSchema', () => {
    const schema = {
      required: ['name', 'score'],
      properties: {
        name: { type: 'string' },
        score: { type: 'number' },
      },
    };
    const output = { name: 'test', score: 42 };

    expect(validateOutputSchema(output, schema)).toEqual([]);
  });

  it('reportsMissingRequiredFields', () => {
    const schema = {
      required: ['name', 'score'],
      properties: {
        name: { type: 'string' },
        score: { type: 'number' },
      },
    };
    const output = { name: 'test' };

    const errors = validateOutputSchema(output, schema);
    expect(errors).toContain('Missing required field: score');
  });

  it('reportsTypeMismatches', () => {
    const schema = {
      properties: {
        count: { type: 'number' },
        active: { type: 'boolean' },
        tags: { type: 'array' },
        config: { type: 'object' },
      },
    };
    const output = { count: 'not-a-number', active: 'yes', tags: 'not-array', config: null };

    const errors = validateOutputSchema(output, schema);
    expect(errors).toHaveLength(4);
    expect(errors).toContain('Field count must be a number');
    expect(errors).toContain('Field active must be a boolean');
    expect(errors).toContain('Field tags must be an array');
    expect(errors).toContain('Field config must be an object');
  });

  it('returnsErrorWhenOutputIsNotAnObject', () => {
    const schema = { required: ['x'] };

    const errors = validateOutputSchema('hello', schema);
    expect(errors).toContain('Output must be an object');
  });

  it('returnsNoErrorsWhenSchemaIsEmpty', () => {
    expect(validateOutputSchema({ any: 'data' }, {})).toEqual([]);
  });

  it('returnsNoErrorsWhenSchemaIsNull', () => {
    expect(validateOutputSchema({ any: 'data' }, null as never)).toEqual([]);
  });

  it('allowsExtraFieldsNotInSchema', () => {
    const schema = {
      required: ['name'],
      properties: { name: { type: 'string' } },
    };
    const output = { name: 'test', extraField: 123 };

    expect(validateOutputSchema(output, schema)).toEqual([]);
  });

  it('skipsTypeCheckForMissingOptionalFields', () => {
    const schema = {
      properties: { optional: { type: 'string' } },
    };
    const output = {};

    expect(validateOutputSchema(output, schema)).toEqual([]);
  });

  it('validatesStringType', () => {
    const schema = {
      properties: { name: { type: 'string' } },
    };

    expect(validateOutputSchema({ name: 42 }, schema)).toContain('Field name must be a string');
    expect(validateOutputSchema({ name: 'ok' }, schema)).toEqual([]);
  });
});
