import { describe, expect, it } from 'vitest';

import { buildFormValues } from './runtime-defaults.form.js';

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
});
