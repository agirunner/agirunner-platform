import type { DatabaseQueryable } from '../../db/database.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface DeliverableArtifactTargetRow {
  summary_brief: string | null;
  primary_target_json: Record<string, unknown>;
  secondary_targets_json: Record<string, unknown>[] | null;
  content_preview_json: Record<string, unknown>;
}

export async function sanitizeDeliverableArtifactTargets<T extends DeliverableArtifactTargetRow>(
  db: DatabaseQueryable,
  tenantId: string,
  rows: T[],
): Promise<T[]> {
  const artifactIds = collectArtifactIds(rows);
  if (artifactIds.length === 0) {
    return rows;
  }

  const result = await db.query<{ id: string }>(
    `SELECT id
       FROM workflow_artifacts
      WHERE tenant_id = $1
        AND id = ANY($2::uuid[])`,
    [tenantId, artifactIds],
  );
  const existingIds = new Set(result.rows.map((row) => row.id));

  return rows.flatMap((row) => {
    const sanitized = sanitizeRowTargets(row, existingIds);
    return sanitized ? [sanitized] : [];
  });
}

function collectArtifactIds(rows: DeliverableArtifactTargetRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const target of [row.primary_target_json, ...(row.secondary_targets_json ?? [])]) {
      const artifactId = readArtifactId(target);
      if (artifactId) {
        ids.add(artifactId);
      }
    }
  }
  return [...ids];
}

function sanitizeRowTargets<T extends DeliverableArtifactTargetRow>(
  row: T,
  existingIds: Set<string>,
): T | null {
  const secondaryTargets = (row.secondary_targets_json ?? [])
    .map((target) => sanitizeTarget(target, existingIds))
    .filter((target): target is Record<string, unknown> => target !== null);
  const primaryTarget =
    sanitizeTarget(row.primary_target_json, existingIds) ?? secondaryTargets.shift() ?? {};

  if (hasMeaningfulTarget(primaryTarget) || secondaryTargets.length > 0 || hasFallbackContent(row)) {
    return {
      ...row,
      primary_target_json: primaryTarget,
      secondary_targets_json: secondaryTargets,
    };
  }

  return null;
}

function sanitizeTarget(
  target: Record<string, unknown>,
  existingIds: Set<string>,
): Record<string, unknown> | null {
  const artifactId = readArtifactId(target);
  if (!artifactId) {
    return target;
  }
  return existingIds.has(artifactId) ? target : null;
}

function readArtifactId(target: Record<string, unknown>): string | null {
  const value = target.artifact_id;
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

function hasMeaningfulTarget(target: Record<string, unknown>): boolean {
  return Object.values(target).some((value) => {
    if (typeof value === 'string') {
      return value.trim().length > 0;
    }
    return value !== null && value !== undefined;
  });
}

function hasFallbackContent(row: DeliverableArtifactTargetRow): boolean {
  if (typeof row.summary_brief === 'string' && row.summary_brief.trim().length > 0) {
    return true;
  }
  return Object.values(row.content_preview_json).some((value) => {
    if (typeof value === 'string') {
      return value.trim().length > 0;
    }
    return value !== null && value !== undefined;
  });
}
