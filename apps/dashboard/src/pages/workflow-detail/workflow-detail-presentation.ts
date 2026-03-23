export interface ReviewPacketDescriptor {
  typeLabel: string;
  summary: string;
  detail: string;
  badges: string[];
  hasStructuredDetail: boolean;
}

export function describeReviewPacket(
  value: unknown,
  label = 'payload',
): ReviewPacketDescriptor {
  if (value === null || value === undefined || value === '') {
    return {
      typeLabel: 'Empty',
      summary: `No ${label} recorded`,
      detail: `This ${label} does not include additional structured detail.`,
      badges: [],
      hasStructuredDetail: false,
    };
  }

  if (typeof value === 'string') {
    return {
      typeLabel: 'Text',
      summary: truncateText(value, 96),
      detail: `${value.length} characters captured in this ${label}.`,
      badges: [],
      hasStructuredDetail: false,
    };
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return {
      typeLabel: typeof value === 'number' ? 'Number' : 'Flag',
      summary: String(value),
      detail: `Scalar ${label} value available without drill-down.`,
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
          : `List-style ${label} recorded for drill-down.`,
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
        ? `${nestedKeys.length} nested section${nestedKeys.length === 1 ? '' : 's'} available in this ${label}.`
        : `Flat structured ${label} ready for operator review.`,
    badges: keys.slice(0, 4).map((key) => humanizeKey(key)),
    hasStructuredDetail: keys.length > 0,
  };
}

export function toStructuredDetailViewData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return { items: value };
  }
  if (value && typeof value === 'object') {
    return value;
  }
  if (value === null || value === undefined || value === '') {
    return {};
  }
  return { value };
}

export function formatRelativeTimestamp(
  value: string | null | undefined,
  now = Date.now(),
): string {
  if (!value) {
    return '-';
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  const deltaSeconds = Math.round((now - timestamp) / 1000);
  const absSeconds = Math.abs(deltaSeconds);
  if (absSeconds < 60) {
    return deltaSeconds >= 0 ? `${absSeconds}s ago` : `in ${absSeconds}s`;
  }
  const absMinutes = Math.round(absSeconds / 60);
  if (absMinutes < 60) {
    return deltaSeconds >= 0 ? `${absMinutes}m ago` : `in ${absMinutes}m`;
  }
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) {
    return deltaSeconds >= 0 ? `${absHours}h ago` : `in ${absHours}h`;
  }
  const absDays = Math.round(absHours / 24);
  return deltaSeconds >= 0 ? `${absDays}d ago` : `in ${absDays}d`;
}

export function formatAbsoluteTimestamp(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toLocaleString();
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function mergeSelectableOptions(
  options: string[],
  currentValue: string | null | undefined,
): string[] {
  const normalizedCurrentValue = currentValue?.trim() ?? '';
  const merged = new Set(
    options
      .map((option) => option.trim())
      .filter((option) => option.length > 0),
  );
  if (normalizedCurrentValue.length > 0) {
    merged.add(normalizedCurrentValue);
  }
  return Array.from(merged).sort((left, right) => left.localeCompare(right));
}

export function summarizeIdentifier(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }
  if (value.length <= 16) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
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
