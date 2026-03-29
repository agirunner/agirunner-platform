import type { DashboardWorkflowDeliverableTarget } from '../../../lib/api.js';

export interface DeliverableTargetAction {
  action_kind: 'dialog_preview' | 'external_link';
  href: string;
}

const DASHBOARD_ORIGIN = 'http://dashboard.local';
const IN_PLACE_TARGET_PATH_PATTERNS = [
  /^\/artifacts\/tasks\/[^/]+\/[^/]+$/,
  /^\/api\/v1\/tasks\/[^/]+\/artifacts\/[^/]+(?:\/preview|\/permalink)?$/,
  /^\/api\/v1\/workflows\/[^/]+\/input-packets\/[^/]+\/files\/[^/]+\/content$/,
  /^\/api\/v1\/workflows\/[^/]+\/interventions\/[^/]+\/files\/[^/]+\/content$/,
];
const DEPRECATED_NAVIGATION_PARAM_NAMES = ['return_to', 'return_source'];

export function sanitizeDeliverableTarget(
  target: Partial<DashboardWorkflowDeliverableTarget> | null | undefined,
): DashboardWorkflowDeliverableTarget {
  return {
    target_kind: readTargetText(target?.target_kind),
    label: readTargetText(target?.label),
    url: readTargetText(target?.url),
    path: readOptionalTargetText(target?.path),
    repo_ref: readOptionalTargetText(target?.repo_ref),
    artifact_id: readOptionalTargetText(target?.artifact_id),
  };
}

export function sanitizeDeliverableTargets(value: unknown): DashboardWorkflowDeliverableTarget[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) =>
      sanitizeDeliverableTarget(
        entry && typeof entry === 'object'
          ? entry as Partial<DashboardWorkflowDeliverableTarget>
          : null,
      ))
    .filter(hasMeaningfulDeliverableTarget);
}

export function hasMeaningfulDeliverableTarget(target: DashboardWorkflowDeliverableTarget): boolean {
  return target.target_kind.length > 0
    || target.label.length > 0
    || target.url.length > 0
    || Boolean(target.path)
    || Boolean(target.repo_ref)
    || Boolean(target.artifact_id);
}

export function resolveDeliverableTargetAction(
  target: DashboardWorkflowDeliverableTarget,
): DeliverableTargetAction {
  const href = normalizeDeliverableTargetUrl(target.url);

  if (isInPlaceArtifactPreviewTarget(href)) {
    return {
      action_kind: 'dialog_preview',
      href,
    };
  }

  return {
    action_kind: 'external_link',
    href,
  };
}

export function isInPlaceArtifactPreviewTarget(url: string): boolean {
  const normalizedPath = readNormalizedPath(url);
  return normalizedPath !== null && IN_PLACE_TARGET_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath));
}

function readNormalizedPath(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = new URL(trimmed, DASHBOARD_ORIGIN);
    return parsed.pathname;
  } catch {
    return null;
  }
}

function normalizeDeliverableTargetUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return url;
  }

  try {
    const parsed = new URL(trimmed, DASHBOARD_ORIGIN);
    rewriteDeprecatedArtifactPreviewPath(parsed);
    if (isInPlaceArtifactPreviewTarget(parsed.toString())) {
      stripDeprecatedNavigationParams(parsed);
    }
    return serializeTargetUrl(parsed);
  } catch {
    return url;
  }
}

function rewriteDeprecatedArtifactPreviewPath(parsed: URL): void {
  const match = parsed.pathname.match(/^\/artifacts\/tasks\/([^/]+)\/([^/]+)$/);
  if (!match) {
    return;
  }

  const [, taskId, artifactId] = match;
  parsed.pathname =
    `/api/v1/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/preview`;
}

function stripDeprecatedNavigationParams(parsed: URL): void {
  for (const paramName of DEPRECATED_NAVIGATION_PARAM_NAMES) {
    parsed.searchParams.delete(paramName);
  }
}

function serializeTargetUrl(parsed: URL): string {
  return parsed.origin === DASHBOARD_ORIGIN
    ? `${parsed.pathname}${parsed.search}${parsed.hash}`
    : parsed.toString();
}

function readTargetText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readOptionalTargetText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
