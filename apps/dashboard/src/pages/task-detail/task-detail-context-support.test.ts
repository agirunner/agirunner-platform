import { describe, expect, it } from 'vitest';

import {
  buildActivationCheckpointPacket,
  buildClarificationPacket,
  buildContinuityHighlightFacts,
  buildEscalationPacket,
  buildExecutionPacket,
  buildPreviewFacts,
} from './task-detail-context-support.js';

describe('task detail context support', () => {
  it('summarizes clarification coverage for the operator packet', () => {
    expect(
      buildClarificationPacket({
        answers: { scope: 'operator review', owner: 'release lead' },
        history: [
          {
            answered_at: '2026-03-10T16:20:00Z',
            answered_by: 'ops-admin',
          },
        ],
      }),
    ).toEqual({
      summary: '2 captured answers across 1 clarification round.',
      facts: [
        { label: 'Captured answers', value: '2' },
        { label: 'Clarification rounds', value: '1' },
        { label: 'Latest responder', value: 'ops-admin' },
        { label: 'Latest response', value: '2026-03-10T16:20:00Z' },
      ],
    });
  });

  it('summarizes escalation response posture for operator review', () => {
    expect(
      buildEscalationPacket({
        escalationResponse: { decision: 'Proceed in maintenance window' },
        reviewSignals: {
          escalationAwaitingHuman: true,
          escalationTarget: 'release manager',
          escalationReason: 'Need change window approval',
        },
      }),
    ).toEqual({
      summary:
        'A human escalation response is recorded, and the step is still waiting on follow-up.',
      facts: [
        { label: 'Awaiting human', value: 'Yes' },
        { label: 'Escalation target', value: 'release manager' },
        { label: 'Escalation reason', value: 'Need change window approval' },
        { label: 'Response fields', value: '1' },
      ],
    });
  });

  it('builds execution evidence counts and readable preview facts', () => {
    expect(
      buildExecutionPacket({
        verification: { approved: true, checks: ['lint', 'tests'] },
        metrics: { token_count: 1440 },
        runtimeContext: { environment: 'staging', repo: { name: 'agirunner' } },
      }),
    ).toEqual({
      summary:
        '2 verification fields, 1 execution metric, and 2 runtime context fields are available for deeper review.',
      facts: [
        { label: 'Verification fields', value: '2' },
        { label: 'Execution metrics', value: '1' },
        { label: 'Agent context fields', value: '2' },
        { label: 'Most detailed source', value: 'Verification' },
      ],
    });

    expect(
      buildPreviewFacts({
        assessment_prompt: 'Validate rollback notes',
        attempts: 3,
        checks: ['lint', 'tests'],
        repo: { name: 'agirunner' },
      }),
    ).toEqual([
      { label: 'assessment prompt', value: 'Validate rollback notes' },
      { label: 'attempts', value: '3' },
      { label: 'checks', value: '2 items' },
      { label: 'repo', value: '1 field' },
    ]);
  });

  it('surfaces continuity highlights and activation checkpoint facts', () => {
    expect(
      buildContinuityHighlightFacts({
        metrics: {
          effective_context_strategy: 'activation_checkpoint',
          activation_finish_checkpoint_writes: 1,
          activation_finish_memory_writes: 2,
        },
        activationCheckpoint: {
          trigger: 'task.completed',
          next_expected_event: 'specialist_completed',
          recent_memory_keys: ['repo_root'],
        },
      }),
    ).toEqual([
      { label: 'Context strategy', value: 'activation_checkpoint' },
      { label: 'Activation checkpoints', value: '1' },
      { label: 'Activation memory writes', value: '2' },
      { label: 'Checkpoint trigger', value: 'task.completed' },
    ]);

    expect(
      buildActivationCheckpointPacket({
        trigger: 'task.completed',
        next_expected_event: 'specialist_completed',
        important_ids: ['task-1', 'work-item-1'],
        recent_memory_keys: ['repo_root'],
      }),
    ).toEqual({
      summary:
        'Latest orchestrator activation checkpoint captures 2 important ids and records the next expected event.',
      facts: [
        { label: 'Checkpoint trigger', value: 'task.completed' },
        { label: 'Next expected event', value: 'specialist_completed' },
        { label: 'Important ids', value: '2' },
        { label: 'Recent memory keys', value: '1' },
      ],
    });
  });
});
