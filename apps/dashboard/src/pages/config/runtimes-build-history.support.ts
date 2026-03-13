import type { DashboardCustomizationStatusResponse } from '../../lib/api.js';

export interface BuildHistoryEntry {
  buildId: string;
  status: 'linked' | 'valid' | 'failed';
  image: string | null;
  date: string;
  recoveryPath: string;
}

export interface RuntimeRecoveryBrief {
  headline: string;
  detail: string;
  steps: string[];
  tone: 'linked' | 'valid' | 'failed';
}

export interface RuntimeHistorySummaryCard {
  label: string;
  value: string;
  detail: string;
}

export function formatDigestAsImage(digest: string | undefined): string | null {
  if (!digest) {
    return null;
  }
  const short = digest.length > 16 ? `${digest.slice(0, 16)}...` : digest;
  return `runtime:${short}`;
}

export function formatDigestLabel(digest: string | null | undefined): string {
  if (!digest) {
    return 'No digest reported';
  }
  return digest.length > 20 ? `${digest.slice(0, 12)}…${digest.slice(-6)}` : digest;
}

export function statusBadgeVariant(
  status: string,
): 'success' | 'secondary' | 'destructive' {
  if (status === 'linked') {
    return 'success';
  }
  if (status === 'valid') {
    return 'secondary';
  }
  return 'destructive';
}

export function deriveStatusFromState(
  runtimeStatus: DashboardCustomizationStatusResponse,
): 'linked' | 'valid' | 'failed' {
  if (runtimeStatus.active_digest && runtimeStatus.configured_digest) {
    return 'linked';
  }
  if (runtimeStatus.state === 'ready' || runtimeStatus.state === 'active') {
    return 'valid';
  }
  return 'failed';
}

export function describeRuntimePosture(
  status: DashboardCustomizationStatusResponse,
): string {
  const derived = deriveStatusFromState(status);
  if (derived === 'linked') {
    return 'Active runtime image matches a configured digest.';
  }
  if (derived === 'valid') {
    return 'Runtime is reachable, but the configured digest is not fully linked.';
  }
  return 'Runtime image needs recovery before operators can trust rollout state.';
}

export function describeRuntimeNextAction(
  status: DashboardCustomizationStatusResponse,
): string {
  const derived = deriveStatusFromState(status);
  if (derived === 'linked') {
    return 'Inspect the manifest packet before making the next runtime change.';
  }
  if (derived === 'valid') {
    return 'Compare the configured digest and active digest before rollout or rollback decisions.';
  }
  return 'Inspect the manifest and rebuild or relink the runtime image before rollout.';
}

export function buildHistoryFromStatus(
  status: DashboardCustomizationStatusResponse | undefined,
): BuildHistoryEntry[] {
  if (!status?.active_digest && !status?.configured_digest) {
    return [];
  }

  const derivedStatus = status ? deriveStatusFromState(status) : 'valid';
  const digest = status?.active_digest ?? status?.configured_digest;

  return [
    {
      buildId: digest ? `bld-${digest.slice(0, 6)}` : 'bld-current',
      status: derivedStatus,
      image: formatDigestAsImage(digest),
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      recoveryPath: describeBuildRecoveryPath(derivedStatus),
    },
  ];
}

export function describeBuildRecoveryPath(status: 'linked' | 'valid' | 'failed'): string {
  if (status === 'linked') {
    return 'No recovery needed.';
  }
  if (status === 'valid') {
    return 'Link the configured digest before rollout or rollback.';
  }
  return 'Inspect the manifest and rebuild or relink the runtime image.';
}

export function buildRuntimeRecoveryBrief(
  status: DashboardCustomizationStatusResponse,
): RuntimeRecoveryBrief {
  const derived = deriveStatusFromState(status);
  if (derived === 'linked') {
    return {
      headline: 'Runtime image is linked and ready for inspection.',
      detail: 'Confirm the manifest packet before making the next runtime change so rollout context stays intact.',
      steps: [
        'Inspect the manifest packet and confirm the base image and customization inputs.',
        'Compare the active digest with the next runtime change before rollout.',
        'Use build history to confirm no recovery work is pending.',
      ],
      tone: 'linked',
    };
  }
  if (derived === 'valid') {
    return {
      headline: 'Runtime is reachable, but linkage still needs confirmation.',
      detail: 'Treat this as a pre-rollout checkpoint. Finish digest linkage before trusting rollback or rollout decisions.',
      steps: [
        'Inspect the manifest packet to verify the runtime inputs that produced the current image.',
        'Link the configured digest before rollout or rollback decisions.',
        'Delay further runtime-default changes until the digest mismatch is resolved.',
      ],
      tone: 'valid',
    };
  }
  return {
    headline: 'Runtime needs recovery before further configuration changes.',
    detail: 'Do recovery work first so operators do not compound a broken runtime state with new defaults.',
    steps: [
      'Inspect the manifest packet and build history together to confirm what failed.',
      'Rebuild or relink the runtime image before rollout work continues.',
      'Do not change runtime defaults again until recovery completes.',
    ],
    tone: 'failed',
  };
}

export function buildRuntimeHistorySummaryCards(
  status: DashboardCustomizationStatusResponse | undefined,
  entries: BuildHistoryEntry[],
): RuntimeHistorySummaryCard[] {
  const derivedStatus = status ? deriveStatusFromState(status) : undefined;
  return [
    {
      label: 'Recorded builds',
      value: String(entries.length),
      detail:
        entries.length === 0
          ? 'No linked or reconstructed builds recorded yet.'
          : entries.length === 1
            ? 'One runtime build packet is available for inspection.'
            : `${entries.length} runtime build packets are available for inspection.`,
    },
    {
      label: 'Current posture',
      value: derivedStatus ?? 'unknown',
      detail: status ? describeRuntimePosture(status) : 'Runtime status is not available right now.',
    },
    {
      label: 'Recovery path',
      value: derivedStatus ? describeBuildRecoveryPath(derivedStatus) : 'Inspect runtime service health',
      detail: status
        ? describeRuntimeNextAction(status)
        : 'Reconnect runtime status before trusting rollout or rollback posture.',
    },
  ];
}
