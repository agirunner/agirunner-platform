import type {
  DashboardCustomizationBuildResponse,
  DashboardCustomizationExportResponse,
  DashboardCustomizationGate,
  DashboardCustomizationLinkResponse,
  DashboardCustomizationStatusResponse,
  DashboardCustomizationValidateResponse,
} from '../../lib/api.js';

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

export function statusBadgeVariant(status: string): 'success' | 'secondary' | 'destructive' {
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

export function describeRuntimePosture(status: DashboardCustomizationStatusResponse): string {
  const derived = deriveStatusFromState(status);
  if (derived === 'linked') {
    return 'Active runtime image matches a configured digest.';
  }
  if (derived === 'valid') {
    return 'Runtime image service is reachable, but the configured digest is not fully linked.';
  }
  return 'Runtime image needs recovery before operators can trust rollout state.';
}

export function describeRuntimeNextAction(status: DashboardCustomizationStatusResponse): string {
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
      detail:
        'Confirm the manifest packet before making the next runtime change so rollout context stays intact.',
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
      headline: 'Runtime image service is reachable, but linkage still needs confirmation.',
      detail:
        'Treat this as a pre-rollout checkpoint. Finish digest linkage before trusting rollback or rollout decisions.',
      steps: [
        'Inspect the manifest packet to verify the runtime image inputs that produced the current image.',
        'Link the configured digest before rollout or rollback decisions.',
        'Delay further runtime default changes until the digest mismatch is resolved.',
      ],
      tone: 'valid',
    };
  }
  return {
    headline: 'Runtime needs recovery before further configuration changes.',
    detail:
      'Do recovery work first so operators do not compound a broken runtime state with new defaults.',
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
            ? 'One runtime image packet is available for inspection.'
            : `${entries.length} runtime image packets are available for inspection.`,
    },
    {
      label: 'Current posture',
      value: derivedStatus ?? 'unknown',
      detail: status
        ? describeRuntimePosture(status)
        : 'Runtime image status is not available right now.',
    },
    {
      label: 'Recovery path',
      value: derivedStatus
        ? describeBuildRecoveryPath(derivedStatus)
        : 'Inspect runtime image service health',
      detail: status
        ? describeRuntimeNextAction(status)
        : 'Reconnect the runtime image service before trusting rollout or rollback posture.',
    },
  ];
}

export interface BuildOutcome {
  headline: string;
  detail: string;
  linkReady: boolean;
  tone: 'linked' | 'valid' | 'failed';
}

export interface ValidationOutcome {
  headline: string;
  valid: boolean;
  errors: Array<{ field: string; message: string; remediation: string }>;
}

export interface LinkOutcome {
  headline: string;
  detail: string;
  tone: 'linked' | 'valid' | 'failed';
}

export interface ExportOutcome {
  headline: string;
  detail: string;
  hasContent: boolean;
}

export function describeBuildState(state: string): string {
  if (state === 'success') return 'Build completed successfully and is ready for linkage.';
  if (state === 'building') return 'Build is in progress.';
  if (state === 'failed') return 'Build failed. Inspect errors before retrying.';
  if (state === 'queued') return 'Build is queued and waiting to start.';
  return `Build is in state: ${state}.`;
}

export function describeGatesSummary(gates?: DashboardCustomizationGate[]): string {
  if (!gates || gates.length === 0) return 'No gates recorded.';
  const passed = gates.filter((g) => g.status === 'passed').length;
  const failed = gates.filter((g) => g.status === 'failed').length;
  const pending = gates.length - passed - failed;
  const parts: string[] = [];
  if (passed > 0) parts.push(`${passed} passed`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (pending > 0) parts.push(`${pending} pending`);
  return parts.join(' \u2022 ');
}

export function describeBuildOutcome(build: DashboardCustomizationBuildResponse): BuildOutcome {
  if (build.error) {
    return {
      headline: 'Build failed.',
      detail: build.error,
      linkReady: false,
      tone: 'failed',
    };
  }
  if (build.link_ready) {
    return {
      headline: 'Build completed and ready to link.',
      detail: `Digest ${formatDigestLabel(build.digest)} is ready for linkage.`,
      linkReady: true,
      tone: 'valid',
    };
  }
  if (build.link_blocked_reason) {
    return {
      headline: 'Build completed but linkage is blocked.',
      detail: build.link_blocked_reason,
      linkReady: false,
      tone: 'failed',
    };
  }
  return {
    headline: describeBuildState(build.state),
    detail: `Digest: ${formatDigestLabel(build.digest)}.`,
    linkReady: false,
    tone: 'valid',
  };
}

export function describeValidationOutcome(
  result: DashboardCustomizationValidateResponse,
): ValidationOutcome {
  if (result.valid) {
    return {
      headline: 'Manifest is valid. Ready to build.',
      valid: true,
      errors: [],
    };
  }
  return {
    headline: `Manifest has ${result.errors?.length ?? 0} validation error(s).`,
    valid: false,
    errors: (result.errors ?? []).map((e) => ({
      field: e.field_path,
      message: e.message,
      remediation: e.remediation,
    })),
  };
}

export function describeLinkOutcome(result: DashboardCustomizationLinkResponse): LinkOutcome {
  if (result.linked) {
    return {
      headline: 'Build linked successfully.',
      detail: `Active digest is now ${formatDigestLabel(result.active_digest)}.`,
      tone: 'linked',
    };
  }
  if (result.link_blocked_reason) {
    return {
      headline: 'Linkage blocked.',
      detail: result.link_blocked_reason,
      tone: 'failed',
    };
  }
  return {
    headline: `Link state: ${result.state}.`,
    detail: result.error ?? 'Linkage did not complete.',
    tone: 'failed',
  };
}

export function describeExportOutcome(result: DashboardCustomizationExportResponse): ExportOutcome {
  if (result.error) {
    return {
      headline: 'Export failed.',
      detail: result.error,
      hasContent: false,
    };
  }
  const format = result.format ?? 'json';
  const type = result.artifact_type ?? 'manifest';
  return {
    headline: `Exported ${type} as ${format}.`,
    detail: result.redaction_applied
      ? 'Sensitive values were redacted in the export output.'
      : 'Export completed without redactions.',
    hasContent: !!result.content,
  };
}
