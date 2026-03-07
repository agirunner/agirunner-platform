import { describe, expect, it } from 'vitest';

import {
  groupTasksByPhase,
  parseMemoryValue,
  parseOverrideInput,
  readProjectMemoryEntries,
  readWorkflowPhases,
  readWorkflowRunSummary,
} from './workflow-detail-support.js';

describe('workflow detail workflow support', () => {
  it('reads phases from the normalized workflow payload', () => {
    const phases = readWorkflowPhases({
      phases: [
        {
          name: 'planning',
          status: 'gate_waiting',
          gate: 'manual',
          gate_status: 'awaiting_approval',
          progress: { completed_tasks: 1, total_tasks: 1 },
        },
      ],
    });

    expect(phases).toEqual([
      {
        name: 'planning',
        status: 'gate_waiting',
        gate: 'manual',
        gate_status: 'awaiting_approval',
        completed_tasks: 1,
        total_tasks: 1,
      },
    ]);
  });

  it('groups tasks by workflow phase and preserves unassigned tasks', () => {
    const groups = groupTasksByPhase(
      [
        { id: 'a', title: 'Plan', state: 'completed', depends_on: [], metadata: { workflow_phase: 'planning' } },
        { id: 'b', title: 'Build', state: 'ready', depends_on: [], metadata: { workflow_phase: 'build' } },
        { id: 'c', title: 'Loose', state: 'ready', depends_on: [] },
      ],
      [
        { name: 'planning', status: 'completed', gate: 'manual', gate_status: 'approved', completed_tasks: 1, total_tasks: 1 },
        { name: 'build', status: 'active', gate: 'none', gate_status: 'none', completed_tasks: 0, total_tasks: 1 },
      ],
    );

    expect(groups).toEqual([
      expect.objectContaining({ phaseName: 'planning', tasks: [expect.objectContaining({ id: 'a' })] }),
      expect.objectContaining({ phaseName: 'build', tasks: [expect.objectContaining({ id: 'b' })] }),
      expect.objectContaining({ phaseName: 'unassigned', tasks: [expect.objectContaining({ id: 'c' })] }),
    ]);
  });

  it('parses clarification override input as a JSON object only', () => {
    expect(parseOverrideInput('{\"clarification_answers\":{\"scope\":\"v1\"}}')).toEqual({
      value: { clarification_answers: { scope: 'v1' } },
      error: undefined,
    });
    expect(parseOverrideInput('[]').error).toBe('Override input must be a JSON object.');
    expect(parseOverrideInput('{oops').error).toBe('Override input must be valid JSON.');
  });

  it('reads run summary from workflow metadata', () => {
    const summary = readWorkflowRunSummary({
      metadata: {
        run_summary: {
          kind: 'run_summary',
          workflow_id: 'pipe-1',
        },
      },
    });

    expect(summary).toEqual({ kind: 'run_summary', workflow_id: 'pipe-1' });
  });

  it('parses project memory value as JSON for dashboard editing', () => {
    expect(parseMemoryValue('{"summary":"updated"}')).toEqual({
      value: { summary: 'updated' },
      error: undefined,
    });
    expect(parseMemoryValue('').error).toBe('Memory value must not be empty.');
    expect(parseMemoryValue('{oops').error).toBe('Memory value must be valid JSON.');
  });

  it('reads project memory entries in sorted order', () => {
    expect(
      readProjectMemoryEntries({
        memory: {
          zeta: { value: 2 },
          alpha: { value: 1 },
        },
      }),
    ).toEqual([
      { key: 'alpha', value: { value: 1 } },
      { key: 'zeta', value: { value: 2 } },
    ]);
  });
});
