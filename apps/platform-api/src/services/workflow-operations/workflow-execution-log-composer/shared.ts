import type { LogRow } from '../../../logging/log-service.js';

export function compareLogRowsByCreatedAt(left: LogRow, right: LogRow): number {
  const leftTimestamp = normalizeTimestamp(left.created_at);
  const rightTimestamp = normalizeTimestamp(right.created_at);
  if (leftTimestamp === rightTimestamp) {
    return left.id.localeCompare(right.id);
  }
  return leftTimestamp.localeCompare(rightTimestamp);
}

export function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return '';
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readHumanizedString(value: unknown): string | null {
  const parsed = readString(value);
  return parsed ? humanizeToken(parsed) : null;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(readString).filter((entry): entry is string => entry !== null);
}

export function readOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readFirstString(values: Array<string | null>): string | null {
  for (const value of values) {
    if (value) {
      return value;
    }
  }
  return null;
}

export function dedupeIds(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    ),
  );
}

export function capitalizeSentence(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

export function truncate(value: string | null, maxLength: number): string | null {
  if (!value) {
    return null;
  }
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

export function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
