export function formatLogRelativeTime(iso: string, now = Date.now()): string {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) {
    return 'Unknown time';
  }

  const deltaSeconds = Math.round((now - timestamp) / 1000);
  const absSeconds = Math.abs(deltaSeconds);
  if (absSeconds < 5) {
    return 'just now';
  }
  if (absSeconds < 60) {
    return deltaSeconds >= 0 ? `${absSeconds}s ago` : `in ${absSeconds}s`;
  }

  const absMinutes = Math.floor(absSeconds / 60);
  if (absMinutes < 60) {
    return deltaSeconds >= 0 ? `${absMinutes}m ago` : `in ${absMinutes}m`;
  }

  const absHours = Math.floor(absMinutes / 60);
  if (absHours < 24) {
    return deltaSeconds >= 0 ? `${absHours}h ago` : `in ${absHours}h`;
  }

  const absDays = Math.floor(absHours / 24);
  return deltaSeconds >= 0 ? `${absDays}d ago` : `in ${absDays}d`;
}
