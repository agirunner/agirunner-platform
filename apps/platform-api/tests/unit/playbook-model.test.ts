import { describe, expect, it } from 'vitest';

import {
  parsePlaybookDefinition,
  readPlaybookRuntimePools,
} from '../../src/orchestration/playbook-model.js';

describe('playbook model runtime pools', () => {
  it('returns a legacy specialist pool when only shared runtime config exists', () => {
    const definition = parsePlaybookDefinition({
      roles: ['developer'],
      board: { columns: [{ id: 'planned', label: 'Planned' }] },
      runtime: {
        pool_mode: 'warm',
        max_runtimes: 2,
        image: 'agirunner-runtime:v1',
      },
    });

    expect(readPlaybookRuntimePools(definition)).toEqual([
      {
        pool_kind: 'specialist',
        config: {
          pool_mode: 'warm',
          max_runtimes: 2,
          priority: undefined,
          idle_timeout_seconds: undefined,
          grace_period_seconds: undefined,
          image: 'agirunner-runtime:v1',
          pull_policy: undefined,
          cpu: undefined,
          memory: undefined,
        },
      },
    ]);
  });

  it('applies shared runtime defaults to explicit orchestrator and specialist pools', () => {
    const definition = parsePlaybookDefinition({
      roles: ['developer'],
      board: { columns: [{ id: 'planned', label: 'Planned' }] },
      runtime: {
        pool_mode: 'cold',
        image: 'agirunner-runtime:shared',
        orchestrator_pool: {
          max_runtimes: 1,
        },
        specialist_pool: {
          pool_mode: 'warm',
          max_runtimes: 3,
        },
      },
    });

    expect(readPlaybookRuntimePools(definition)).toEqual([
      {
        pool_kind: 'orchestrator',
        config: {
          pool_mode: 'cold',
          max_runtimes: 1,
          priority: undefined,
          idle_timeout_seconds: undefined,
          grace_period_seconds: undefined,
          image: 'agirunner-runtime:shared',
          pull_policy: undefined,
          cpu: undefined,
          memory: undefined,
        },
      },
      {
        pool_kind: 'specialist',
        config: {
          pool_mode: 'warm',
          max_runtimes: 3,
          priority: undefined,
          idle_timeout_seconds: undefined,
          grace_period_seconds: undefined,
          image: 'agirunner-runtime:shared',
          pull_policy: undefined,
          cpu: undefined,
          memory: undefined,
        },
      },
    ]);
  });
});
