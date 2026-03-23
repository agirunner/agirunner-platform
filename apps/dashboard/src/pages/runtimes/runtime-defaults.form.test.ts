import { describe, expect, it } from 'vitest';

import {
  buildFormValues,
  planRuntimeDefaultSaveAction,
  shouldDeleteRuntimeDefaultRow,
} from './runtime-defaults.form.js';
import { FIELD_DEFINITIONS } from './runtime-defaults.schema.js';

describe('runtime defaults form', () => {
  it('clears advanced rows that only restate built-in defaults', () => {
    const values = buildFormValues([
      {
        id: 'seed-1',
        config_key: 'agent.specialist_context_preserve_memory_ops',
        config_value: '3',
        config_type: 'number',
        description: null,
      },
      {
        id: 'seed-2',
        config_key: 'agent.specialist_context_preserve_artifact_ops',
        config_value: '3',
        config_type: 'number',
        description: null,
      },
      {
        id: 'seed-3',
        config_key: 'lifecycle.destroy_stop_timeout_seconds',
        config_value: '1',
        config_type: 'number',
        description: null,
      },
      {
        id: 'seed-4',
        config_key: 'specialist_runtime_default_image',
        config_value: 'agirunner-runtime:local',
        config_type: 'string',
        description: null,
      },
    ]);

    expect(values['agent.specialist_context_preserve_memory_ops']).toBe('');
    expect(values['agent.specialist_context_preserve_artifact_ops']).toBe('');
    expect(values['lifecycle.destroy_stop_timeout_seconds']).toBe('');
    expect(values['specialist_runtime_default_image']).toBe('agirunner-runtime:local');
  });

  it('preserves seeded advanced rows when a blank form value only reflects the built-in default', () => {
    const field = FIELD_DEFINITIONS.find(
      (candidate) => candidate.key === 'agent.specialist_context_preserve_memory_ops',
    );

    expect(field).toBeDefined();
    expect(
      shouldDeleteRuntimeDefaultRow({
        field: field!,
        currentValue: '',
        existingValue: '3',
      }),
    ).toBe(false);
  });

  it('deletes a stored advanced override when the form is cleared back to inherit defaults', () => {
    const field = FIELD_DEFINITIONS.find(
      (candidate) => candidate.key === 'agent.specialist_context_preserve_memory_ops',
    );

    expect(field).toBeDefined();
    expect(
      shouldDeleteRuntimeDefaultRow({
        field: field!,
        currentValue: '',
        existingValue: '9',
      }),
    ).toBe(true);
  });

  it('treats blank inherited advanced defaults as a save no-op', () => {
    const field = FIELD_DEFINITIONS.find((candidate) => candidate.key === 'queue.max_concurrency');

    expect(field).toBeDefined();
    expect(
      planRuntimeDefaultSaveAction({
        field: field!,
        currentValue: '',
        existingValue: '2',
      }),
    ).toBe('noop');
  });

  it('treats explicit advanced built-in defaults as a save no-op when the seeded row already exists', () => {
    const field = FIELD_DEFINITIONS.find((candidate) => candidate.key === 'queue.max_concurrency');

    expect(field).toBeDefined();
    expect(
      planRuntimeDefaultSaveAction({
        field: field!,
        currentValue: '2',
        existingValue: '2',
      }),
    ).toBe('noop');
  });
});
