import { describe, expect, it } from 'vitest';

import {
  groupTasksByPhase,
  parseOverrideInput,
  readPipelinePhases,
  readPipelineRunSummary,
} from './pipeline-detail-support.js';

describe('pipeline detail workflow support', () => {
  it('reads phases from the normalized pipeline payload', () => {
    const phases = readPipelinePhases({
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

  it('reads run summary from pipeline metadata', () => {
    const summary = readPipelineRunSummary({
      metadata: {
        run_summary: {
          kind: 'run_summary',
          pipeline_id: 'pipe-1',
        },
      },
    });

    expect(summary).toEqual({ kind: 'run_summary', pipeline_id: 'pipe-1' });
  });
});
