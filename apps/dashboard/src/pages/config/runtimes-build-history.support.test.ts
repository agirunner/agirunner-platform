import { describe, expect, it } from 'vitest';

import {
  buildRuntimeHistorySummaryCards,
  buildRuntimeRecoveryBrief,
  buildHistoryFromStatus,
  describeBuildOutcome,
  describeBuildRecoveryPath,
  describeBuildState,
  describeExportOutcome,
  describeGatesSummary,
  describeLinkOutcome,
  describeRuntimeNextAction,
  describeRuntimePosture,
  describeValidationOutcome,
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

  it('describes build states for operator scanning', () => {
    expect(describeBuildState('success')).toContain('completed');
    expect(describeBuildState('building')).toContain('progress');
    expect(describeBuildState('failed')).toContain('failed');
    expect(describeBuildState('queued')).toContain('queued');
    expect(describeBuildState('unknown-state')).toContain('unknown-state');
  });

  it('summarizes gate results for operator scanning', () => {
    expect(describeGatesSummary(undefined)).toBe('No gates recorded.');
    expect(describeGatesSummary([])).toBe('No gates recorded.');
    expect(
      describeGatesSummary([
        { name: 'vuln-scan', status: 'passed' },
        { name: 'sbom', status: 'passed' },
        { name: 'signature', status: 'failed', message: 'invalid' },
      ]),
    ).toBe('2 passed \u2022 1 failed');
  });

  it('describes build outcomes including link readiness and blocked builds', () => {
    const linkReady = describeBuildOutcome({
      state: 'success',
      link_ready: true,
      digest: 'sha256:aabbccdd',
      manifest: { template: 'python', base_image: 'python:3.12' },
    } as never);
    expect(linkReady.linkReady).toBe(true);
    expect(linkReady.tone).toBe('valid');
    expect(linkReady.headline).toContain('ready to link');

    const failed = describeBuildOutcome({
      state: 'failed',
      link_ready: false,
      error: 'Image build timed out.',
      manifest: { template: 'node', base_image: 'node:22' },
    } as never);
    expect(failed.linkReady).toBe(false);
    expect(failed.tone).toBe('failed');
    expect(failed.detail).toBe('Image build timed out.');

    const blocked = describeBuildOutcome({
      state: 'success',
      link_ready: false,
      link_blocked_reason: 'Gate failure prevents linkage.',
      manifest: { template: 'node', base_image: 'node:22' },
    } as never);
    expect(blocked.linkReady).toBe(false);
    expect(blocked.tone).toBe('failed');
    expect(blocked.headline).toContain('blocked');
  });

  it('describes validation outcomes with field-level error details', () => {
    const valid = describeValidationOutcome({
      valid: true,
      manifest: { template: 'python', base_image: 'python:3.12' },
    });
    expect(valid.valid).toBe(true);
    expect(valid.errors).toHaveLength(0);

    const invalid = describeValidationOutcome({
      valid: false,
      manifest: { template: 'python', base_image: '' },
      errors: [
        {
          field_path: 'base_image',
          rule_id: 'required',
          message: 'Base image is required.',
          remediation: 'Set a base image.',
        },
      ],
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toHaveLength(1);
    expect(invalid.errors[0]).toEqual({
      field: 'base_image',
      message: 'Base image is required.',
      remediation: 'Set a base image.',
    });
  });

  it('describes link outcomes for successful and blocked linkage', () => {
    const linked = describeLinkOutcome({
      state: 'linked',
      linked: true,
      active_digest: 'sha256:aabbccdd',
    } as never);
    expect(linked.tone).toBe('linked');
    expect(linked.headline).toContain('linked successfully');

    const blocked = describeLinkOutcome({
      state: 'blocked',
      linked: false,
      link_blocked_reason: 'Gate failure.',
    } as never);
    expect(blocked.tone).toBe('failed');
    expect(blocked.detail).toBe('Gate failure.');
  });

  it('describes export outcomes including redaction and error states', () => {
    const success = describeExportOutcome({
      artifact_type: 'manifest',
      format: 'json',
      redaction_applied: true,
      scan_passed: true,
    });
    expect(success.headline).toContain('manifest');
    expect(success.detail).toContain('redacted');

    const failed = describeExportOutcome({
      redaction_applied: false,
      scan_passed: false,
      error: 'Export service unavailable.',
    });
    expect(failed.headline).toContain('failed');
    expect(failed.hasContent).toBe(false);
  });
});
