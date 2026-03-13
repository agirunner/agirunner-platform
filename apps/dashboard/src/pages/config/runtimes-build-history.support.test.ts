import { describe, expect, it } from 'vitest';

import {
  buildRuntimeHistorySummaryCards,
  buildRuntimeRecoveryBrief,
  buildHistoryFromStatus,
  describeBuildRecoveryPath,
  describeRuntimeNextAction,
  describeRuntimePosture,
  deriveStatusFromState,
  formatDigestAsImage,
  formatDigestLabel,
  statusBadgeVariant,
} from './runtimes-build-history.support.js';

describe('runtimes build history support', () => {
  it('formats digest labels and runtime image tags for operator scanning', () => {
    expect(formatDigestAsImage('sha256:1234567890abcdef1234')).toBe('runtime:sha256:123456789...');
    expect(formatDigestLabel('sha256:1234567890abcdef1234')).toBe('sha256:12345…ef1234');
    expect(formatDigestLabel(undefined)).toBe('No digest reported');
  });

  it('derives posture, next action, and recovery path from runtime status', () => {
    const linkedStatus = {
      state: 'ready',
      active_digest: 'sha256:aaaabbbbcccc',
      configured_digest: 'sha256:aaaabbbbcccc',
    };
    const failedStatus = {
      state: 'failed',
      active_digest: null,
      configured_digest: 'sha256:ddddeeeeffff',
    };

    expect(deriveStatusFromState(linkedStatus as never)).toBe('linked');
    expect(describeRuntimePosture(linkedStatus as never)).toBe(
      'Active runtime image matches a configured digest.',
    );
    expect(describeRuntimeNextAction(linkedStatus as never)).toBe(
      'Inspect the manifest packet before making the next runtime change.',
    );
    expect(deriveStatusFromState(failedStatus as never)).toBe('failed');
    expect(describeBuildRecoveryPath('failed')).toBe(
      'Inspect the manifest and rebuild or relink the runtime image.',
    );
    expect(statusBadgeVariant('failed')).toBe('destructive');
  });

  it('builds operator-readable history entries from runtime status', () => {
    const entries = buildHistoryFromStatus({
      state: 'active',
      active_digest: 'sha256:aaaabbbbcccc',
      configured_digest: 'sha256:aaaabbbbcccc',
    } as never);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      buildId: 'bld-sha256',
      status: 'linked',
      recoveryPath: 'No recovery needed.',
    });
  });

  it('builds a recovery brief and history summary cards for operator decision making', () => {
    const status = {
      state: 'failed',
      active_digest: null,
      configured_digest: 'sha256:ddddeeeeffff',
    };

    expect(buildRuntimeRecoveryBrief(status as never)).toEqual({
      headline: 'Runtime needs recovery before further configuration changes.',
      detail:
        'Do recovery work first so operators do not compound a broken runtime state with new defaults.',
      steps: [
        'Inspect the manifest packet and build history together to confirm what failed.',
        'Rebuild or relink the runtime image before rollout work continues.',
        'Do not change runtime defaults again until recovery completes.',
      ],
      tone: 'failed',
    });

    expect(buildRuntimeHistorySummaryCards(status as never, [])).toEqual([
      {
        label: 'Recorded builds',
        value: '0',
        detail: 'No linked or reconstructed builds recorded yet.',
      },
      {
        label: 'Current posture',
        value: 'failed',
        detail: 'Runtime image needs recovery before operators can trust rollout state.',
      },
      {
        label: 'Recovery path',
        value: 'Inspect the manifest and rebuild or relink the runtime image.',
        detail: 'Inspect the manifest and rebuild or relink the runtime image before rollout.',
      },
    ]);
  });
});
