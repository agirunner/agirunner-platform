import type { LogEntry } from '../../lib/api.js';

function readPayloadString(
  payload: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = payload?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function getCanonicalStageName(entry: LogEntry): string | null {
  if (entry.stage_name && entry.stage_name.trim() !== '') {
    return entry.stage_name;
  }
  return readPayloadString(entry.payload, 'stage_name');
}

export function getCanonicalStageNames(entries: LogEntry[]): string[] {
  const names = new Set<string>();

  for (const entry of entries) {
    const stageName = getCanonicalStageName(entry);
    if (stageName) {
      names.add(stageName);
    }
  }

  return Array.from(names);
}
