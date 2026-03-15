import { describe, expect, it } from 'vitest';

import {
  defaultCheckpointName,
  parsePlaybookDefinition,
  readPlaybookRuntimePools,
} from '../../src/orchestration/playbook-model.js';
import { SchemaValidationFailedError } from '../../src/errors/domain-errors.js';

describe('playbook model runtime pools', () => {
  it('returns a legacy specialist pool when only shared runtime config exists', () => {
    const definition = parsePlaybookDefinition({
      process_instructions: 'Developer completes the work and hands off clearly.',
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
      process_instructions: 'Developer completes the work and hands off clearly.',
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

  it('requires process instructions and exposes checkpoints plus stages', () => {
    const definition = parsePlaybookDefinition({
      process_instructions:
        'Developer implements. Reviewer must review every code change. QA validates before completion.',
      roles: ['developer', 'reviewer', 'qa'],
      board: { entry_column_id: 'planned', columns: [{ id: 'planned', label: 'Planned' }] },
      checkpoints: [
        {
          name: 'implementation-complete',
          goal: 'Implementation is complete and ready for review.',
          human_gate: false,
          entry_criteria: 'Requirements are clear and work is underway.',
        },
      ],
      review_rules: [
        {
          from_role: 'developer',
          reviewed_by: 'reviewer',
          required: true,
          on_reject: {
            action: 'return_to_role',
            role: 'developer',
          },
        },
      ],
      approval_rules: [
        {
          on: 'completion',
          approved_by: 'human',
          required: true,
        },
      ],
      handoff_rules: [
        {
          from_role: 'developer',
          to_role: 'reviewer',
          required: true,
        },
      ],
      lifecycle: 'planned',
    });

    expect(definition.process_instructions).toContain('Reviewer must review');
    expect(definition.checkpoints).toHaveLength(1);
    expect(definition.stages).toHaveLength(1);
    expect(definition.stages[0]).toMatchObject({
      name: 'implementation-complete',
      goal: 'Implementation is complete and ready for review.',
      human_gate: false,
    });
    expect(definition.review_rules[0]?.reviewed_by).toBe('reviewer');
    expect(defaultCheckpointName(definition)).toBe('implementation-complete');
  });

  it('derives checkpoints from legacy stages when explicit checkpoints are absent', () => {
    const definition = parsePlaybookDefinition({
      process_instructions: 'Keep work moving through the requirements and implementation checkpoints.',
      roles: ['product-manager', 'developer'],
      board: { columns: [{ id: 'planned', label: 'Planned' }] },
      stages: [
        {
          name: 'requirements',
          goal: 'Requirements are clear.',
          human_gate: true,
        },
        {
          name: 'implementation',
          goal: 'Working code exists.',
        },
      ],
    });

    expect(definition.checkpoints).toEqual([
      {
        name: 'requirements',
        goal: 'Requirements are clear.',
        human_gate: true,
        entry_criteria: undefined,
      },
      {
        name: 'implementation',
        goal: 'Working code exists.',
        human_gate: false,
        entry_criteria: undefined,
      },
    ]);
  });

  it('rejects conflicting mandatory review rules for the same role transition', () => {
    expect(() =>
      parsePlaybookDefinition({
        process_instructions: 'All developer work is reviewed before completion.',
        roles: ['developer', 'reviewer', 'qa'],
        board: { columns: [{ id: 'planned', label: 'Planned' }] },
        review_rules: [
          {
            from_role: 'developer',
            reviewed_by: 'reviewer',
            required: true,
          },
          {
            from_role: 'developer',
            reviewed_by: 'qa',
            required: true,
          },
        ],
      }),
    ).toThrow(SchemaValidationFailedError);
  });

  it('derives fallback process instructions for legacy definitions', () => {
    const definition = parsePlaybookDefinition({
      roles: ['developer'],
      board: { columns: [{ id: 'planned', label: 'Planned' }] },
      stages: [{ name: 'implementation', goal: 'Working code exists.' }],
    });

    expect(definition.process_instructions).toContain('1. implementation: Working code exists.');
  });
});
