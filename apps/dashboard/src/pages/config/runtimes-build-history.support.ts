import type { DashboardCustomizationStatusResponse } from '../../lib/api.js';

export interface BuildHistoryEntry {
  buildId: string;
  status: 'linked' | 'valid' | 'failed';
  image: string | null;
  date: string;
  recoveryPath: string;
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
