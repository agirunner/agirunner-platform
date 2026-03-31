import { describe, expect, it } from 'vitest';

import {
  createStructuredParameterEntry,
  readStructuredParameterEditorState,
  serializeStructuredParameterEntries,
  validateStructuredParameterDefaultValue,
  validateStructuredParameterEntries,
} from './playbook-authoring-structured-controls.support.js';

describe('playbook authoring structured controls support', () => {
  it('hydrates object defaults into structured field rows', () => {
    const state = readStructuredParameterEditorState(
      'object',
      '{\n  "branch": "main",\n  "attempts": 3,\n  "enabled": true\n}',
    );

    expect(state).toEqual({
      entries: [
        expect.objectContaining({ key: 'branch', valueType: 'string', value: 'main' }),
        expect.objectContaining({ key: 'attempts', valueType: 'number', value: '3' }),
        expect.objectContaining({ key: 'enabled', valueType: 'boolean', value: 'true' }),
      ],
    });
  });

  it('hydrates array defaults into structured item rows', () => {
    const state = readStructuredParameterEditorState(
      'array',
      '[\n  "main",\n  3,\n  {"branch":"release"}\n]',
    );

    expect(state).toEqual({
      entries: [
        expect.objectContaining({ key: '', valueType: 'string', value: 'main' }),
        expect.objectContaining({ key: '', valueType: 'number', value: '3' }),
        expect.objectContaining({
          key: '',
          valueType: 'json',
          value: '{\n  "branch": "release"\n}',
        }),
      ],
    });
  });

  it('reports source errors for invalid structured defaults', () => {
    expect(readStructuredParameterEditorState('object', 'not-json')).toEqual({
      entries: [],
      sourceError:
        'This object default is no longer valid structured data. Clear it or rebuild it with field rows.',
    });
    expect(readStructuredParameterEditorState('array', '{"branch":"main"}')).toEqual({
      entries: [],
      sourceError:
        'This list default is no longer valid structured data. Clear it or rebuild it with item rows.',
    });
  });

  it('validates duplicate keys and invalid typed values', () => {
    const duplicateObjectEntries = [
      {
        ...createStructuredParameterEntry(),
        key: 'branch',
        valueType: 'string' as const,
        value: 'main',
      },
      {
        ...createStructuredParameterEntry(),
        key: 'Branch',
        valueType: 'number' as const,
        value: 'NaN',
      },
    ];

    expect(validateStructuredParameterEntries('object', duplicateObjectEntries)).toEqual({
      entryErrors: [
        { key: 'Field names must be unique.' },
        {
          key: 'Field names must be unique.',
          value: 'Enter a valid number.',
        },
      ],
      blockingIssues: ['Field names must be unique.', 'Enter a valid number.'],
      isValid: false,
    });
  });

  it('serializes valid structured entries into persisted json defaults', () => {
    const objectEntries = [
      {
        ...createStructuredParameterEntry(),
        key: 'branch',
        valueType: 'string' as const,
        value: 'main',
      },
      {
        ...createStructuredParameterEntry(),
        key: 'attempts',
        valueType: 'number' as const,
        value: '3',
      },
      {
        ...createStructuredParameterEntry(),
        key: 'enabled',
        valueType: 'boolean' as const,
        value: 'true',
      },
    ];
    const arrayEntries = [
      { ...createStructuredParameterEntry(), key: '', valueType: 'string' as const, value: 'main' },
      {
        ...createStructuredParameterEntry(),
        key: '',
        valueType: 'json' as const,
        value: '{"branch":"release"}',
      },
    ];

    expect(serializeStructuredParameterEntries('object', objectEntries)).toBe(
      '{\n  "branch": "main",\n  "attempts": 3,\n  "enabled": true\n}',
    );
    expect(serializeStructuredParameterEntries('array', arrayEntries)).toBe(
      '[\n  "main",\n  {\n    "branch": "release"\n  }\n]',
    );
  });

  it('validates persisted object and list defaults before submit', () => {
    expect(validateStructuredParameterDefaultValue('object', '{"branch":"main"}')).toBeUndefined();
    expect(validateStructuredParameterDefaultValue('array', '["main"]')).toBeUndefined();
    expect(validateStructuredParameterDefaultValue('object', '["main"]')).toBe(
      'Object defaults must be valid structured object data.',
    );
    expect(validateStructuredParameterDefaultValue('array', '{"branch":"main"}')).toBe(
      'Array defaults must be valid structured list data.',
    );
  });
});
