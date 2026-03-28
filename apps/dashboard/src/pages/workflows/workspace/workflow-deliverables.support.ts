import type { DashboardWorkflowDeliverableTarget } from '../../../lib/api.js';

export interface DeliverableTargetAction {
  action_kind: 'dialog_preview' | 'external_link';
  href: string;
}

const IN_PLACE_TARGET_PATH_PATTERNS = [
  /^\/artifacts\/tasks\/[^/]+\/[^/]+$/,
  /^\/api\/v1\/tasks\/[^/]+\/artifacts\/[^/]+(?:\/content)?$/,
  /^\/api\/v1\/workflows\/[^/]+\/input-packets\/[^/]+\/files\/[^/]+\/content$/,
  /^\/api\/v1\/workflows\/[^/]+\/interventions\/[^/]+\/files\/[^/]+\/content$/,
];

export function resolveDeliverableTargetAction(
  target: DashboardWorkflowDeliverableTarget,
): DeliverableTargetAction {
  const href = rewriteDeprecatedArtifactPreviewUrl(target.url);

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
    const parsed = new URL(trimmed, 'http://dashboard.local');
    return parsed.pathname;
  } catch {
    return null;
  }
}

function rewriteDeprecatedArtifactPreviewUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return url;
  }

  try {
    const parsed = new URL(trimmed, 'http://dashboard.local');
    const match = parsed.pathname.match(/^\/artifacts\/tasks\/([^/]+)\/([^/]+)$/);
    if (!match) {
      return trimmed;
    }

    const [, taskId, artifactId] = match;
    parsed.pathname =
      `/api/v1/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/content`;

    return parsed.origin === 'http://dashboard.local'
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : parsed.toString();
  } catch {
    return url;
  }
}
