import { describe, expect, it } from 'vitest';

import {
  buildInstructionConfig,
  buildWorkflowConfigOverrides,
  countConfiguredWorkflowConfigOverrides,
  haveSameInstructionLayers,
  readWorkflowPolicyDefinition,
  summarizeInstructionLayerSelection,
  toggleInstructionLayer,
  validateWorkflowConfigEntryDrafts,
  validateWorkflowConfigOverrideDrafts,
} from './playbook-launch-workflow-policy.support.js';

describe('playbook launch workflow policy support', () => {
  it('reads structured workflow policy defaults and config override specs from the playbook', () => {
    const definition = readWorkflowPolicyDefinition({
      id: 'pb-1',
      name: 'Ship',
      slug: 'ship',
      outcome: 'Ship software',
      lifecycle: 'planned',
      version: 2,
        definition: {
          config: {
            tools: {
            web_fetch_timeout_seconds: 45,
          },
          runtime: {
            timeout_seconds: 45,
          },
        },
        config_policy: {
          constraints: {
            'tools.web_fetch_timeout_seconds': {
              min: 5,
              max: 120,
            },
            'runtime.timeout_seconds': {
              min: 10,
              max: 300,
            },
          },
        },
        default_instruction_config: {
          suppress_layers: ['workspace', 'task'],
        },
      },
    });

    expect(definition.configOverrideSpecs).toEqual([
      {
        path: 'runtime.timeout_seconds',
        label: 'Timeout Seconds',
        description:
          'Override runtime.timeout_seconds for this workflow without changing the playbook revision. Playbook default: 45. Constraint: minimum 10, maximum 300.',
        valueType: 'number',
        options: [],
        defaultValue: 45,
        min: 10,
        max: 300,
      },
      {
        path: 'tools.web_fetch_timeout_seconds',
        label: 'Web Fetch Timeout Seconds',
        description:
          'Override tools.web_fetch_timeout_seconds for this workflow without changing the playbook revision. Playbook default: 45. Constraint: minimum 5, maximum 120.',
        valueType: 'number',
        options: [],
        defaultValue: 45,
        min: 5,
        max: 120,
      },
    ]);
    expect(definition.defaultSuppressedLayers).toEqual(['workspace', 'task']);
  });

  it('builds nested config overrides from structured fields and dotted-path entries', () => {
    const overrides = buildWorkflowConfigOverrides({
      specs: [
        {
          path: 'tools.web_fetch_timeout_seconds',
          label: 'Web Fetch Timeout Seconds',
          description: '',
          valueType: 'number',
          options: [],
        },
      ],
      draftValues: {
        'tools.web_fetch_timeout_seconds': '60',
      },
      extraDrafts: [
        {
          id: 'entry-1',
          key: 'runtime.timeout_seconds',
          valueType: 'number',
          value: '120',
        },
        {
          id: 'entry-2',
          key: 'model_override.reasoning_config',
          valueType: 'json',
          value: '{"effort":"high"}',
        },
      ],
    });

    expect(overrides).toEqual({
      tools: {
        web_fetch_timeout_seconds: 60,
      },
      runtime: {
        timeout_seconds: 120,
      },
      model_override: {
        reasoning_config: {
          effort: 'high',
        },
      },
    });
  });

  it('validates structured config override fields against allowed values and bounds', () => {
    const validation = validateWorkflowConfigOverrideDrafts(
      [
        {
          path: 'tools.web_fetch_timeout_seconds',
          label: 'Web Fetch Timeout Seconds',
          description: '',
          valueType: 'number',
          options: [],
          min: 5,
          max: 120,
        },
        {
          path: 'runtime.timeout_seconds',
          label: 'Timeout Seconds',
          description: '',
          valueType: 'number',
          options: [],
          min: 10,
          max: 300,
        },
      ],
      {
        'tools.web_fetch_timeout_seconds': '3',
        'runtime.timeout_seconds': '5',
      },
    );

    expect(validation.fieldErrors).toEqual({
      'tools.web_fetch_timeout_seconds': 'Web Fetch Timeout Seconds must be at least 5.',
      'runtime.timeout_seconds': 'Timeout Seconds must be at least 10.',
    });
    expect(validation.isValid).toBe(false);
  });

  it('validates additional config entries and reserves known config paths for dedicated controls', () => {
    const validation = validateWorkflowConfigEntryDrafts(
      [
        {
          id: 'entry-1',
          key: 'tools.web_fetch_timeout_seconds',
          valueType: 'number',
          value: '60',
        },
        {
          id: 'entry-2',
          key: 'bad path',
          valueType: 'json',
          value: '{',
        },
      ],
      [
        {
          path: 'tools.web_fetch_timeout_seconds',
          label: 'Web Fetch Timeout Seconds',
          description: '',
          valueType: 'number',
          options: [],
        },
      ],
    );

    expect(validation.entryErrors).toEqual([
      {
        key: 'Use the dedicated structured field for this config path.',
      },
      {
        key: 'Use dot-separated path segments with letters, numbers, or underscores.',
        value: 'Enter valid JSON before launch.',
      },
    ]);
    expect(validation.isValid).toBe(false);
  });

  it('tracks custom instruction suppression and omits payloads when the selection matches defaults', () => {
    expect(
      buildInstructionConfig({
        suppressedLayers: ['workspace', 'task'],
        defaultSuppressedLayers: ['workspace', 'task'],
      }),
    ).toBeUndefined();
    expect(
      buildInstructionConfig({
        suppressedLayers: ['platform', 'task'],
        defaultSuppressedLayers: ['workspace', 'task'],
      }),
    ).toEqual({
      suppress_layers: ['platform', 'task'],
    });
    expect(
      summarizeInstructionLayerSelection({
        suppressedLayers: ['platform', 'task'],
        defaultSuppressedLayers: ['workspace', 'task'],
      }),
    ).toBe('Workflow launch will suppress platform, task.');
    expect(haveSameInstructionLayers(['workspace', 'task'], ['workspace', 'task'])).toBe(true);
  });

  it('counts configured overrides and toggles instruction layers with stable ordering', () => {
    expect(
      countConfiguredWorkflowConfigOverrides({
        specs: [
          {
            path: 'runtime.timeout_seconds',
            label: 'Timeout Seconds',
            description: '',
            valueType: 'number',
            options: [],
          },
        ],
        draftValues: {
          'runtime.timeout_seconds': '120',
        },
        extraDrafts: [
          {
            id: 'entry-1',
            key: 'tools.web_fetch_timeout_seconds',
            valueType: 'number',
            value: '60',
          },
          {
            id: 'entry-2',
            key: '',
            valueType: 'string',
            value: '',
          },
        ],
      }),
    ).toBe(2);
    expect(toggleInstructionLayer(['task'], 'platform', true)).toEqual(['platform', 'task']);
    expect(toggleInstructionLayer(['platform', 'task'], 'platform', false)).toEqual(['task']);
  });
});
