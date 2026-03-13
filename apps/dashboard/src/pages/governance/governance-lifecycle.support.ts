const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatAbsoluteTimestamp(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) {
    return 'Never';
  }
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function formatDateLabel(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) {
    return '-';
  }
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function formatRelativeTimestamp(
  value: string | null | undefined,
  now = new Date(),
): string {
  const date = parseDate(value);
  if (!date) {
    return 'Never';
  }

  const diffMs = now.getTime() - date.getTime();
  if (Math.abs(diffMs) < MINUTE_MS) {
    return 'Just now';
  }

  if (Math.abs(diffMs) < HOUR_MS) {
    const minutes = Math.max(1, Math.round(Math.abs(diffMs) / MINUTE_MS));
    return diffMs >= 0 ? `${minutes}m ago` : `In ${minutes}m`;
  }

  if (Math.abs(diffMs) < DAY_MS) {
    const hours = Math.max(1, Math.round(Math.abs(diffMs) / HOUR_MS));
    return diffMs >= 0 ? `${hours}h ago` : `In ${hours}h`;
  }

  if (Math.abs(diffMs) < 30 * DAY_MS) {
    const days = Math.max(1, Math.round(Math.abs(diffMs) / DAY_MS));
    return diffMs >= 0 ? `${days}d ago` : `In ${days}d`;
  }

  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function formatExpiryLabel(value: string | null | undefined, now = new Date()): string {
  const date = parseDate(value);
  if (!date) {
    return 'No expiry';
  }

  const diffMs = date.getTime() - now.getTime();
  if (Math.abs(diffMs) < DAY_MS) {
    return diffMs >= 0 ? 'Today' : 'Expired today';
  }

  const days = Math.max(1, Math.round(Math.abs(diffMs) / DAY_MS));
  if (diffMs < 0) {
    return `Expired ${days}d ago`;
  }
  if (diffMs < 30 * DAY_MS) {
    return `In ${days}d`;
  }
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function isWithinDays(
  value: string | null | undefined,
  days: number,
  now = new Date(),
): boolean {
  const date = parseDate(value);
  if (!date) {
    return false;
  }
  const diffMs = date.getTime() - now.getTime();
  return diffMs >= 0 && diffMs <= days * DAY_MS;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
