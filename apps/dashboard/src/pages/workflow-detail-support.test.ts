import { describe, expect, it } from 'vitest';

import {
  deriveWorkflowRoleOptions,
  groupTasksByStage,
  readProjectMemoryEntries,
  readPacketNestedKeys,
  readPacketScalarFacts,
  readWorkflowRunSummary,
  summarizeConfigLayers,
} from './workflow-detail-support.js';

describe('workflow detail workflow support', () => {
  it('groups tasks by explicit stage names and preserves unassigned tasks', () => {
    const groups = groupTasksByStage(
      [
        { id: 'a', title: 'Plan', state: 'completed', depends_on: [], stage_name: 'planning' },
        { id: 'b', title: 'Build', state: 'ready', depends_on: [], stage_name: 'build' },
        { id: 'c', title: 'Loose', state: 'ready', depends_on: [] },
      ],
      ['planning', 'build'],
    );

    expect(groups).toEqual([
      expect.objectContaining({ stageName: 'planning', tasks: [expect.objectContaining({ id: 'a' })] }),
      expect.objectContaining({ stageName: 'build', tasks: [expect.objectContaining({ id: 'b' })] }),
      expect.objectContaining({ stageName: 'unassigned', tasks: [expect.objectContaining({ id: 'c' })] }),
    ]);
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

  it('derives bounded role choices from current workflow data instead of free-form text', () => {
    expect(
      deriveWorkflowRoleOptions({
        tasks: [
          { id: 'task-1', title: 'Plan', state: 'ready', depends_on: [], role: 'architect' },
          { id: 'task-2', title: 'Build', state: 'ready', depends_on: [], role: 'developer' },
        ],
        workItems: [
          {
            id: 'wi-1',
            workflow_id: 'wf-1',
            title: 'Implement',
            stage_name: 'implementation',
            column_id: 'active',
            priority: 'high',
            owner_role: 'reviewer',
          },
        ],
        effectiveModels: {
          orchestrator: {
            source: 'workflow',
            resolved: null,
            fallback: false,
          },
        },
        workflowModelOverrides: {
          qa: { provider: 'openai', model: 'gpt-5.4' },
        },
      }),
    ).toEqual(['architect', 'developer', 'orchestrator', 'qa', 'reviewer']);
  });

  it('extracts scalar facts, nested packet keys, and config layer summaries for review packets', () => {
    expect(
      readPacketScalarFacts({
        workflow_id: 'wf-1',
        lifecycle: 'continuous',
        config: { retries: 2 },
        active: true,
      }),
    ).toEqual([
      { label: 'active', value: 'true' },
      { label: 'lifecycle', value: 'continuous' },
      { label: 'workflow id', value: 'wf-1' },
    ]);

    expect(
      readPacketNestedKeys({
        workflow_id: 'wf-1',
        config: { retries: 2 },
        memory: { summary: 'note' },
      }),
    ).toEqual(['config', 'memory']);

    expect(
      summarizeConfigLayers({
        playbook: { orchestrator: {}, defaults: {} },
        workflow: { overrides: {} },
      }),
    ).toEqual([
      { name: 'playbook', fieldCount: 2, keys: ['defaults', 'orchestrator'] },
      { name: 'workflow', fieldCount: 1, keys: ['overrides'] },
    ]);
  });
});
