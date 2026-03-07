import { describe, expect, it } from 'vitest';

import {
  buildResolvedConfigView,
  resolveInstructionConfig,
  resolvePipelineConfig,
} from '../../src/services/config-hierarchy-service.js';

describe('config hierarchy service', () => {
  it('deep merges template, project, and run layers while preserving source snapshots', () => {
    const resolved = resolvePipelineConfig(
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
      resolvePipelineConfig(
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
      resolvePipelineConfig(
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
    const resolved = resolvePipelineConfig(
      { config: { runtime: { timeout: 30, mode: 'safe' } } },
      { config: { runtime: { timeout: 45 } } },
      { runtime: { timeout: 50 } },
    );

    expect(buildResolvedConfigView(resolved.resolved, resolved.layers, true)).toEqual({
      runtime: {
        timeout: { value: 50, source: 'run' },
        mode: { value: 'safe', source: 'template' },
      },
    });
  });

  it('replaces template instruction defaults when a run-level instruction config is present', () => {
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
