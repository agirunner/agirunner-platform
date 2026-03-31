import { ValidationError } from '../../errors/domain-errors.js';

const TASK_LOCAL_HANDOFF_PATH_PATTERNS = [
  /(?:^|[\s"'`(])(output\/[^\s"'`),\]]+)/i,
  /(?:^|[\s"'`(])(repo\/[^\s"'`),\]]+)/i,
  /(\/tmp\/workspace\/[^\s"'`),\]]+)/i,
];

export function normalizeTaskLocalHandoffReferences<T extends Record<string, unknown>>(
  payload: T,
): {
  payload: T;
  wasRepaired: boolean;
} {
  const artifactIds = Array.isArray(payload.artifact_ids) ? payload.artifact_ids : [];
  const canRepairOutputPath = artifactIds.length > 0 || containsStableArtifactLogicalPath(payload);
  const normalization = normalizeTaskLocalHandoffValue(payload, canRepairOutputPath);
  return {
    payload: normalization.value as T,
    wasRepaired: normalization.wasRepaired,
  };
}

export function assertNoTaskLocalHandoffPaths(value: unknown) {
  const offendingPath = findTaskLocalHandoffPath(value);
  if (!offendingPath) {
    return;
  }
  throw new ValidationError(
    `Structured handoffs must not reference task-local path "${offendingPath}". Persist output to artifacts/repo/memory and reference artifact ids/logical paths, repo-relative paths, memory keys, and workflow/task ids instead`,
  );
}

function containsStableArtifactLogicalPath(value: unknown): boolean {
  if (typeof value === 'string') {
    return /\bartifact:[^\s"'`),\]]+/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsStableArtifactLogicalPath(entry));
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  return Object.values(value as Record<string, unknown>).some((entry) => containsStableArtifactLogicalPath(entry));
}

function normalizeTaskLocalHandoffValue(
  value: unknown,
  canRepairOutputPath: boolean,
): {
  value: unknown;
  wasRepaired: boolean;
} {
  if (typeof value === 'string') {
    return normalizeTaskLocalHandoffText(value, canRepairOutputPath);
  }
  if (Array.isArray(value)) {
    let wasRepaired = false;
    const next = value.map((entry) => {
      const normalized = normalizeTaskLocalHandoffValue(entry, canRepairOutputPath);
      wasRepaired = wasRepaired || normalized.wasRepaired;
      return normalized.value;
    });
    return { value: next, wasRepaired };
  }
  if (!value || typeof value !== 'object') {
    return { value, wasRepaired: false };
  }
  let wasRepaired = false;
  const next = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      const normalized = normalizeTaskLocalHandoffValue(entry, canRepairOutputPath);
      wasRepaired = wasRepaired || normalized.wasRepaired;
      return [key, normalized.value];
    }),
  );
  return { value: next, wasRepaired };
}

function normalizeTaskLocalHandoffText(
  text: string,
  canRepairOutputPath: boolean,
): {
  value: string;
  wasRepaired: boolean;
} {
  let wasRepaired = false;
  let value = text.replace(
    /(^|[\s"'`(])\/tmp\/workspace\/repo\/([^\s"'`),\]]+)/gi,
    (_match, prefix: string, repoPath: string) => {
      wasRepaired = true;
      return `${prefix}${repoPath}`;
    },
  );
  value = value.replace(
    /(^|[\s"'`(])repo\/([^\s"'`),\]]+)/gi,
    (_match, prefix: string, repoPath: string) => {
      wasRepaired = true;
      return `${prefix}${repoPath}`;
    },
  );
  if (!canRepairOutputPath) {
    return { value, wasRepaired };
  }
  value = value.replace(
    /(^|[\s"'`(])(?:\/tmp\/workspace\/)?output\/([^\s"'`),\]]+)/gi,
    (_match, prefix: string, outputPath: string) => {
      wasRepaired = true;
      return `${prefix}uploaded artifact ${outputPath}`;
    },
  );
  return { value, wasRepaired };
}

function findTaskLocalHandoffPath(value: unknown): string | null {
  if (typeof value === 'string') {
    return extractTaskLocalHandoffPath(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const offendingPath = findTaskLocalHandoffPath(entry);
      if (offendingPath) {
        return offendingPath;
      }
    }
    return null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    const offendingPath = findTaskLocalHandoffPath(entry);
    if (offendingPath) {
      return offendingPath;
    }
  }
  return null;
}

function extractTaskLocalHandoffPath(text: string): string | null {
  for (const pattern of TASK_LOCAL_HANDOFF_PATH_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}
