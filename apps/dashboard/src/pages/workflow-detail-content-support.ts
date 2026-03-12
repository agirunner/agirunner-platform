export interface ProjectMemoryEntryPacket {
  typeLabel: string;
  summary: string;
  detail: string;
  badges: string[];
  hasStructuredDetail: boolean;
}

export function describeProjectMemoryEntry(value: unknown): ProjectMemoryEntryPacket {
  if (value === null || value === undefined || value === '') {
    return {
      typeLabel: 'Empty',
      summary: 'No stored value',
      detail: 'This memory key exists without a payload yet.',
      badges: [],
      hasStructuredDetail: false,
    };
  }

  if (typeof value === 'string') {
    return {
      typeLabel: 'Text',
      summary: truncateText(value, 96),
      detail: `${value.length} characters of reusable operator context.`,
      badges: [],
      hasStructuredDetail: false,
    };
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return {
      typeLabel: typeof value === 'number' ? 'Number' : 'Flag',
      summary: String(value),
      detail: 'Scalar memory value available to future board runs.',
      badges: [],
      hasStructuredDetail: false,
    };
  }

  if (Array.isArray(value)) {
    const preview = value
      .slice(0, 4)
      .map((entry) => summarizeArrayEntry(entry))
      .filter((entry) => entry.length > 0);
    return {
      typeLabel: 'List',
      summary: `${value.length} item${value.length === 1 ? '' : 's'} recorded`,
      detail:
        preview.length > 0
          ? `Includes ${preview.join(', ')}.`
          : 'List-style memory payload for downstream reuse.',
      badges: preview,
      hasStructuredDetail: true,
    };
  }

  const record = asRecord(value);
  const keys = Object.keys(record);
  const nestedKeys = keys.filter((key) => isComplexValue(record[key]));
  return {
    typeLabel: 'Structured',
    summary: `${keys.length} field${keys.length === 1 ? '' : 's'} captured`,
    detail:
      nestedKeys.length > 0
        ? `${nestedKeys.length} nested section${nestedKeys.length === 1 ? '' : 's'} available for drill-down.`
        : 'Flat structured memory payload ready for operator review.',
    badges: keys.slice(0, 4).map((key) => humanizeKey(key)),
    hasStructuredDetail: true,
  };
}

function summarizeArrayEntry(value: unknown): string {
  if (typeof value === 'string') {
    return truncateText(value, 24);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `${value.length} nested item${value.length === 1 ? '' : 's'}`;
  }
  const keys = Object.keys(asRecord(value));
  return keys.length > 0 ? humanizeKey(keys[0]) : '';
}

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function truncateText(value: string, limit: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit - 1)}…`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isComplexValue(value: unknown): boolean {
  return Array.isArray(value) || Object.keys(asRecord(value)).length > 0;
}
