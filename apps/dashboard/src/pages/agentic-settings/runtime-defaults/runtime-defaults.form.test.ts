import { describe, expect, it } from 'vitest';

import {
  buildFormValues,
  getFieldDefaultValue,
  planRuntimeDefaultSaveAction,
} from './runtime-defaults.form.js';
import { FIELD_DEFINITIONS } from './runtime-defaults.schema.js';

describe('runtime defaults form', () => {
  it('hydrates real values for every field even when no row exists yet', () => {
    const values = buildFormValues([]);

    expect(values['specialist_runtime_default_image']).toBe('');
    expect(values['agent.specialist_context_preserve_memory_ops']).toBe('3');
    expect(values['agent.specialist_context_preserve_artifact_ops']).toBe('3');
    expect(values['lifecycle.destroy_stop_timeout_seconds']).toBe('1');
  });

  it('preserves the stored runtime image version instead of collapsing back to a placeholder', () => {
    const values = buildFormValues([
      {
        id: 'seed-1',
        config_key: 'agent.specialist_context_preserve_memory_ops',
        config_value: '9',
        config_type: 'number',
        description: null,
      },
      {
        id: 'seed-2',
        config_key: 'specialist_runtime_default_image',
        config_value: 'ghcr.io/agirunner/agirunner-runtime:0.1.0-alpha.1',
        config_type: 'string',
        description: null,
      },
    ]);

    expect(values['agent.specialist_context_preserve_memory_ops']).toBe('9');
    expect(values['specialist_runtime_default_image']).toBe('ghcr.io/agirunner/agirunner-runtime:0.1.0-alpha.1');
  });

  it('upserts canonical defaults when a displayed field has no stored row yet', () => {
    const field = FIELD_DEFINITIONS.find(
      (candidate) => candidate.key === 'agent.specialist_context_preserve_memory_ops',
    );

    expect(field).toBeDefined();
    expect(
      planRuntimeDefaultSaveAction({
        field: field!,
        currentValue: getFieldDefaultValue(field!),
        existingValue: undefined,
      }),
    ).toBe('upsert');
  });

  it('treats unchanged canonical values as a save no-op', () => {
    const field = FIELD_DEFINITIONS.find((candidate) => candidate.key === 'global_max_specialists');

    expect(field).toBeDefined();
    expect(
      planRuntimeDefaultSaveAction({
        field: field!,
        currentValue: '20',
        existingValue: '20',
      }),
    ).toBe('noop');
  });

  it('upserts changed canonical values instead of relying on delete semantics', () => {
    const field = FIELD_DEFINITIONS.find((candidate) => candidate.key === 'global_max_specialists');

    expect(field).toBeDefined();
    expect(
      planRuntimeDefaultSaveAction({
        field: field!,
        currentValue: '25',
        existingValue: '20',
      }),
    ).toBe('upsert');
  });
});
