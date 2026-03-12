import { describe, expect, it } from 'vitest';

import {
  buildResolvedConfigView,
  overlayModelOverride,
  readModelOverride,
  resolveInstructionConfig,
  resolveWorkflowConfig,
} from '../../src/services/config-hierarchy-service.js';

describe('config hierarchy service', () => {
  it('deep merges playbook, project, and run layers while preserving source snapshots', () => {
    const resolved = resolveWorkflowConfig(
      {
        config: {
          runtime: { timeout: 30, mode: 'safe' },
          tools: ['git'],
        },
      },
      {
        config: {
          runtime: { timeout: 45 },
        },
      },
      {
        runtime: { timeout: 50 },
        tools: ['git', 'shell'],
      },
    );

    expect(resolved.resolved).toEqual({
      runtime: { timeout: 50, mode: 'safe' },
      tools: ['git', 'shell'],
    });
    expect(resolved.layers.project).toEqual({
      runtime: { timeout: 45 },
    });
  });

  it('rejects locked and constrained overrides', () => {
    expect(() =>
      resolveWorkflowConfig(
        {
          config: { runtime: { timeout: 30, mode: 'safe' } },
          config_policy: {
            locked: ['runtime.mode'],
            constraints: {
              'runtime.timeout': { min: 10, max: 60 },
            },
          },
        },
        {},
        { runtime: { mode: 'fast' } },
      ),
    ).toThrow(/locked field 'runtime.mode'/i);

    expect(() =>
      resolveWorkflowConfig(
        {
          config: { runtime: { timeout: 30 } },
          config_policy: {
            constraints: {
              'runtime.timeout': { min: 10, max: 60 },
            },
          },
        },
        {},
        { runtime: { timeout: 5 } },
      ),
    ).toThrow(/must be >= 10/i);
  });

  it('annotates resolved values with their winning source when requested', () => {
    const resolved = resolveWorkflowConfig(
      { config: { runtime: { timeout: 30, mode: 'safe' } } },
      { config: { runtime: { timeout: 45 } } },
      { runtime: { timeout: 50 } },
    );

    expect(buildResolvedConfigView(resolved.resolved, resolved.layers, true)).toEqual({
      runtime: {
        timeout: { value: 50, source: 'run' },
        mode: { value: 'safe', source: 'playbook' },
      },
    });
  });

  it('merges model overrides from project settings and workflow run overrides into config layers', () => {
    const resolved = resolveWorkflowConfig(
      { config: { runtime: { timeout: 30 } } },
      {
        model_override: {
          model_id: '00000000-0000-0000-0000-000000000001',
          reasoning_config: { effort: 'medium' },
        },
      },
      {
        model_override: {
          model_id: '00000000-0000-0000-0000-000000000002',
        },
      },
    );

    expect(resolved.layers.project).toEqual({
      model_override: {
        model_id: '00000000-0000-0000-0000-000000000001',
        reasoning_config: { effort: 'medium' },
      },
    });
    expect(resolved.layers.run).toEqual({
      model_override: {
        model_id: '00000000-0000-0000-0000-000000000002',
      },
    });
    expect(resolved.resolved).toEqual({
      runtime: { timeout: 30 },
      model_override: {
        model_id: '00000000-0000-0000-0000-000000000002',
        reasoning_config: { effort: 'medium' },
      },
    });
  });

  it('validates model override schema and overlays field-by-field', () => {
    expect(() => readModelOverride({ bad: true }, 'model_override')).toThrow(/Invalid model_override/i);

    expect(
      overlayModelOverride(
        {
          model_id: '00000000-0000-0000-0000-000000000001',
          reasoning_config: { effort: 'low' },
        },
        {
          reasoning_config: { effort: 'high' },
        },
      ),
    ).toEqual({
      model_id: '00000000-0000-0000-0000-000000000001',
      reasoning_config: { effort: 'high' },
    });
  });

  it('replaces playbook instruction defaults when a run-level instruction config is present', () => {
    expect(
      resolveInstructionConfig(
        {
          default_instruction_config: {
            suppress_layers: ['platform'],
          },
        },
        undefined,
      ),
    ).toEqual({ suppress_layers: ['platform'] });

    expect(
      resolveInstructionConfig(
        {
          default_instruction_config: {
            suppress_layers: ['platform'],
          },
        },
        { suppress_layers: [] },
      ),
    ).toEqual({ suppress_layers: [] });
  });
});
