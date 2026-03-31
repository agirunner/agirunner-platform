export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function firstDefinedString(values: Array<string | null>): string | null {
  for (const value of values) {
    if (value) {
      return value;
    }
  }
  return null;
}

export function truncateSummary(value: string, max = 35): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

export function readOptionalInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function humanize(value: string): string {
  return value
    .split(/[_.\-/\s]+/g)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function humanizeSentence(value: string): string {
  const words = value
    .split(/[_.\-/\s]+/g)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());

  if (words.length === 0) {
    return '';
  }

  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

export function tokenizeLabel(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0 && token !== 'mcp');
}

export function startsWithTokens(value: string[], prefix: string[]): boolean {
  if (prefix.length === 0 || prefix.length > value.length) {
    return false;
  }
  return prefix.every((token, index) => value[index] === token);
}

export function endsWithTokens(value: string[], suffix: string[]): boolean {
  if (suffix.length === 0 || suffix.length > value.length) {
    return false;
  }
  const startIndex = value.length - suffix.length;
  return suffix.every((token, index) => value[startIndex + index] === token);
}

export function lowercaseFirst(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return value.charAt(0).toLowerCase() + value.slice(1);
}

export function isActionWord(value: string): boolean {
  return new Set([
    'fail',
    'complete',
    'start',
    'approve',
    'reject',
    'retry',
    'cancel',
    'pause',
    'resume',
    'claim',
    'register',
    'revoke',
    'create',
    'delete',
    'update',
    'patch',
  ]).has(value.toLowerCase());
}

export function singularize(value: string): string {
  const normalized = value.toLowerCase();
  return normalized.endsWith('s') ? normalized.slice(0, -1) : normalized;
}
