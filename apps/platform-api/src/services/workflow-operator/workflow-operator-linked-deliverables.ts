import { sanitizeOptionalText } from './workflow-operator-record-sanitization.js';

const UUID_SOURCE = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const CANONICAL_INTERNAL_REFERENCE_PATTERN = new RegExp(
  `^(task|work_item|workflow):\\s*(${UUID_SOURCE})$`,
  'i',
);
const OPTIONAL_WORKFLOW_PREFIX = '(?:workflow\\s+)?';

const SHORTHAND_INTERNAL_REFERENCE_PATTERNS = [
  { kind: 'task', pattern: new RegExp(`^${OPTIONAL_WORKFLOW_PREFIX}task\\s*:?\\s*(${UUID_SOURCE})$`, 'i') },
  {
    kind: 'work_item',
    pattern: new RegExp(`^${OPTIONAL_WORKFLOW_PREFIX}work(?:[ _-]?item)\\s*:?\\s*(${UUID_SOURCE})$`, 'i'),
  },
  { kind: 'workflow', pattern: new RegExp(`^workflow\\s*:?\\s*(${UUID_SOURCE})$`, 'i') },
] as const;

export function normalizeInternalReferenceTargetPath(path: string | null | undefined): string | null {
  const normalizedPath = sanitizeOptionalText(path);
  if (!normalizedPath) {
    return null;
  }

  const canonicalMatch = normalizedPath.match(CANONICAL_INTERNAL_REFERENCE_PATTERN);
  if (canonicalMatch) {
    return `${canonicalMatch[1]!.toLowerCase()}:${canonicalMatch[2]!.toLowerCase()}`;
  }

  for (const candidate of SHORTHAND_INTERNAL_REFERENCE_PATTERNS) {
    const shorthandMatch = normalizedPath.match(candidate.pattern);
    if (shorthandMatch) {
      return `${candidate.kind}:${shorthandMatch[1]!.toLowerCase()}`;
    }
  }

  return normalizedPath;
}

export function isInternalReferenceLinkedDeliverable(
  deliverable: { primaryTarget: Record<string, unknown> },
): boolean {
  const normalizedPath = normalizeInternalReferenceTargetPath(readPrimaryTargetPath(deliverable.primaryTarget));
  return Boolean(
    normalizedPath
    && (normalizedPath.startsWith('task:') || normalizedPath.startsWith('work_item:') || normalizedPath.startsWith('workflow:')),
  );
}

export function normalizeLinkedDeliverablePrimaryTarget<T extends { primaryTarget: Record<string, unknown> }>(
  deliverable: T,
): T {
  const currentPath = readPrimaryTargetPath(deliverable.primaryTarget);
  const normalizedPath = normalizeInternalReferenceTargetPath(currentPath);
  if (!normalizedPath || normalizedPath === currentPath) {
    return deliverable;
  }
  return {
    ...deliverable,
    primaryTarget: {
      ...asRecord(deliverable.primaryTarget),
      path: normalizedPath,
    },
  };
}

function readPrimaryTargetPath(target: Record<string, unknown>): string | null {
  return sanitizeOptionalText(asRecord(target).path);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
