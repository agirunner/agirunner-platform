import { describe, expect, it } from 'vitest';

import {
  activeColumnId,
  blockedColumnId,
  defaultStageName,
  defaultColumnId,
  parsePlaybookDefinition,
  readPlaybookRuntimePools,
} from '../../../src/orchestration/playbook-model.js';
import { SchemaValidationFailedError } from '../../../src/errors/domain-errors.js';

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

  it('parses stage-only definitions and does not expose checkpoint config', () => {
    const definition = parsePlaybookDefinition({
      process_instructions: 'Move work through requirements and implementation.',
      roles: ['product-manager', 'developer'],
      board: { columns: [{ id: 'planned', label: 'Planned' }] },
      stages: [
        {
          name: 'requirements',
          goal: 'Requirements are clear.',
        },
        {
          name: 'implementation',
          goal: 'Working code exists.',
          guidance: 'Deliver tested code and a clear handoff.',
        },
      ],
    });

    expect(definition.process_instructions).toContain('Move work through requirements');
    expect(definition.stages).toEqual([
      {
        name: 'requirements',
        goal: 'Requirements are clear.',
      },
      {
        name: 'implementation',
        goal: 'Working code exists.',
        guidance: 'Deliver tested code and a clear handoff.',
      },
    ]);
    expect(definition.parameters).toEqual(undefined);
    expect(defaultStageName(definition)).toBe('requirements');
    expect('checkpoints' in definition).toBe(false);
  });

  it('parses only the minimal playbook launch input contract', () => {
    const definition = parsePlaybookDefinition({
      process_instructions: 'Collect the required launch goal and deliver the outcome.',
      roles: ['developer'],
      board: { columns: [{ id: 'planned', label: 'Planned' }] },
      stages: [{ name: 'delivery', goal: 'Ship the requested outcome.' }],
      parameters: [
        { slug: 'workflow_goal', title: 'Workflow Goal', required: true },
        { slug: 'acceptance_notes', title: 'Acceptance Notes', required: false },
      ],
    });

    expect(definition.parameters).toEqual([
      { slug: 'workflow_goal', title: 'Workflow Goal', required: true },
      { slug: 'acceptance_notes', title: 'Acceptance Notes', required: false },
    ]);
  });

  it('rejects deleted governance fields and stage human_gate config', () => {
    expect(() =>
      parsePlaybookDefinition({
        process_instructions: 'Developer implements, reviewer reviews, human signs off.',
        roles: ['developer', 'reviewer'],
        board: { columns: [{ id: 'planned', label: 'Planned' }] },
        stages: [
          {
            name: 'implementation',
            goal: 'Working code exists.',
            human_gate: true,
          },
        ],
        checkpoints: [{ name: 'review', goal: 'Review is complete.' }],
        assessment_rules: [{ subject_role: 'developer', assessed_by: 'reviewer', required: true }],
        approval_rules: [{ on: 'completion', approved_by: 'human', required: true }],
        handoff_rules: [{ from_role: 'developer', to_role: 'reviewer', required: true }],
        branch_policies: [{ branch_key: 'release', termination_policy: 'stop_branch_only' }],
      }),
    ).toThrow(SchemaValidationFailedError);
  });

  it('rejects deprecated playbook launch input fields', () => {
    expect(() =>
      parsePlaybookDefinition({
        process_instructions: 'Collect the workflow goal and complete the work.',
        roles: ['developer'],
        board: { columns: [{ id: 'planned', label: 'Planned' }] },
        stages: [{ name: 'delivery', goal: 'Ship the requested outcome.' }],
        parameters: [
          {
            slug: 'workflow_goal',
            title: 'Workflow Goal',
            required: true,
            type: 'string',
          },
        ],
      }),
    ).toThrow(SchemaValidationFailedError);
  });

  it('rejects multiple blocked board columns', () => {
    expect(() =>
      parsePlaybookDefinition({
        process_instructions: 'Move work forward and record blockers clearly.',
        roles: ['developer'],
        board: {
          columns: [
            { id: 'planned', label: 'Planned' },
            { id: 'blocked_a', label: 'Blocked A', is_blocked: true },
            { id: 'blocked_b', label: 'Blocked B', is_blocked: true },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
      }),
    ).toThrow(SchemaValidationFailedError);
  });

  it('rejects multiple terminal board columns', () => {
    expect(() =>
      parsePlaybookDefinition({
        process_instructions: 'Move work forward and close it in one terminal lane.',
        roles: ['developer'],
        board: {
          columns: [
            { id: 'planned', label: 'Planned' },
            { id: 'blocked', label: 'Blocked', is_blocked: true },
            { id: 'done', label: 'Done', is_terminal: true },
            { id: 'cancelled', label: 'Cancelled', is_terminal: true },
          ],
        },
      }),
    ).toThrow(SchemaValidationFailedError);
  });

  it('rejects entry columns that point at blocked or terminal lanes', () => {
    expect(() =>
      parsePlaybookDefinition({
        process_instructions: 'Start work in the authored intake lane.',
        roles: ['developer'],
        board: {
          entry_column_id: 'blocked',
          columns: [
            { id: 'planned', label: 'Planned' },
            { id: 'blocked', label: 'Blocked', is_blocked: true },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
      }),
    ).toThrow(SchemaValidationFailedError);
  });

  it('derives fallback process instructions for legacy definitions with stages only', () => {
    const definition = parsePlaybookDefinition({
      roles: ['developer'],
      board: { columns: [{ id: 'planned', label: 'Planned' }] },
      stages: [{ name: 'implementation', goal: 'Working code exists.' }],
    });

    expect(definition.process_instructions).toContain('1. implementation: Working code exists.');
  });

  it('applies the canonical default board when board config is omitted', () => {
    const definition = parsePlaybookDefinition({
      process_instructions: 'Move work forward and close it responsibly.',
      roles: ['developer'],
      stages: [{ name: 'delivery', goal: 'Working output exists.' }],
    });

    expect(definition.board).toEqual({
      entry_column_id: 'inbox',
      columns: [
        { id: 'inbox', label: 'Inbox', description: '' },
        { id: 'active', label: 'Active', description: '' },
        { id: 'blocked', label: 'Blocked', description: '', is_blocked: true },
        { id: 'done', label: 'Done', description: '', is_terminal: true },
      ],
    });
    expect(defaultColumnId(definition)).toBe('inbox');
    expect(activeColumnId(definition)).toBe('active');
    expect(blockedColumnId(definition)).toBe('blocked');
  });
});
