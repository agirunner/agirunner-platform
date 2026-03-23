import { describe, expect, it } from 'vitest';

import {
  validateRoleOverrideDrafts,
  validateStructuredEntries,
} from './playbook-launch-entry-validation.js';

describe('playbook launch entry validation', () => {
  it('validates structured entries inline before launch', () => {
    expect(
      validateStructuredEntries([
        { id: 'a', key: '', valueType: 'string', value: 'abc' },
        { id: 'b', key: 'trace_id', valueType: 'json', value: '{' },
        { id: 'c', key: 'trace_id', valueType: 'number', value: '10' },
        { id: 'd', key: 'empty', valueType: 'string', value: '' },
        { id: 'e', key: '', valueType: 'string', value: '' },
      ]),
    ).toEqual({
      entryErrors: [
        { key: 'Add a key or remove this row.', value: undefined },
        {
          key: 'Keys must be unique within this section.',
          value: 'Enter valid JSON before launch.',
        },
        { key: 'Keys must be unique within this section.', value: undefined },
        { key: undefined, value: 'Add a value or remove this row.' },
        {},
      ],
      blockingIssues: [
        'Add a key or remove this row.',
        'Keys must be unique within this section.',
        'Enter valid JSON before launch.',
        'Add a value or remove this row.',
      ],
      isValid: false,
    });
  });

  it('validates workflow model override rows and nested reasoning entries', () => {
    expect(
      validateRoleOverrideDrafts([
        {
          id: 'a',
          role: 'architect',
          provider: '',
          model: 'gpt-5.4',
          reasoningEntries: [],
        },
        {
          id: 'b',
          role: 'architect',
          provider: 'OpenAI',
          model: '',
          reasoningEntries: [
            {
              id: 'reasoning-1',
              key: 'effort',
              valueType: 'json',
              value: '{',
            },
          ],
        },
      ]),
    ).toEqual({
      draftErrors: [
        {
          role: 'Each role can only have one override.',
          provider: 'Choose a provider or remove this override.',
          model: undefined,
          reasoning: {
            entryErrors: [],
            blockingIssues: [],
            isValid: true,
          },
        },
        {
          role: 'Each role can only have one override.',
          provider: undefined,
          model: 'Choose a model or remove this override.',
          reasoning: {
            entryErrors: [
              {
                key: undefined,
                value: 'Enter valid JSON before launch.',
              },
            ],
            blockingIssues: ['Enter valid JSON before launch.'],
            isValid: false,
          },
        },
      ],
      blockingIssues: [
        'Each role can only have one override.',
        'Choose a provider or remove this override.',
        'Choose a model or remove this override.',
        'Enter valid JSON before launch.',
      ],
      isValid: false,
    });
  });
});
