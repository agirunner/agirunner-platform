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
        'Developer implements. Reviewer must assess every code change. QA validates before completion.',
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
      assessment_rules: [
        {
          subject_role: 'developer',
          assessed_by: 'reviewer',
          checkpoint: 'implementation-complete',
          required: true,
          outcome_actions: {
            request_changes: {
              action: 'route_to_role',
              role: 'developer',
            },
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
          checkpoint: 'implementation-complete',
          required: true,
        },
      ],
      lifecycle: 'planned',
    });

    expect(definition.process_instructions).toContain('Reviewer must assess');
    expect(definition.checkpoints).toHaveLength(1);
    expect(definition.stages).toHaveLength(1);
    expect(definition.stages[0]).toMatchObject({
      name: 'implementation-complete',
      goal: 'Implementation is complete and ready for review.',
      human_gate: false,
    });
    expect(definition.assessment_rules[0]?.assessed_by).toBe('reviewer');
    expect(definition.assessment_rules[0]?.checkpoint).toBe('implementation-complete');
    expect(definition.handoff_rules[0]?.checkpoint).toBe('implementation-complete');
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

  it('allows multiple required assessment rules for the same subject role', () => {
    const definition = parsePlaybookDefinition({
      process_instructions: 'All developer work is assessed before completion.',
      roles: ['developer', 'reviewer', 'qa'],
      board: { columns: [{ id: 'planned', label: 'Planned' }] },
      assessment_rules: [
        {
          subject_role: 'developer',
          assessed_by: 'reviewer',
          required: true,
        },
        {
          subject_role: 'developer',
          assessed_by: 'qa',
          required: true,
        },
      ],
    });

    expect(definition.assessment_rules.map((rule) => rule.assessed_by)).toEqual(['reviewer', 'qa']);
  });

  it('rejects legacy authored review_rules payloads', () => {
    expect(() =>
      parsePlaybookDefinition({
        process_instructions: 'All developer work is assessed before completion.',
        roles: ['developer', 'reviewer'],
        board: { columns: [{ id: 'planned', label: 'Planned' }] },
        review_rules: [
          {
            from_role: 'developer',
            reviewed_by: 'reviewer',
            required: true,
          },
        ],
      }),
    ).toThrow(SchemaValidationFailedError);
  });

  it('allows the same role to route differently at different checkpoints', () => {
    const definition = parsePlaybookDefinition({
      process_instructions: 'Route product management differently at requirements and release.',
      roles: ['product-manager', 'architect', 'human'],
      board: { columns: [{ id: 'planned', label: 'Planned' }] },
      checkpoints: [
        { name: 'requirements', goal: 'Requirements are approved.' },
        { name: 'release', goal: 'Release is approved.' },
      ],
      handoff_rules: [
        {
          from_role: 'product-manager',
          to_role: 'architect',
          checkpoint: 'requirements',
          required: true,
        },
      ],
      approval_rules: [
        {
          on: 'checkpoint',
          checkpoint: 'release',
          approved_by: 'human',
          required: true,
        },
      ],
    });

    expect(definition.handoff_rules[0]?.checkpoint).toBe('requirements');
    expect(definition.approval_rules[0]?.checkpoint).toBe('release');
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
