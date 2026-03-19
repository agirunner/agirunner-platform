const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MINUTES_PER_HOUR = 60;

export function formatElapsed(ms: number): string {
  const totalMinutes = Math.floor(ms / MS_PER_MINUTE);
  const hours = Math.floor(ms / MS_PER_HOUR);
  const remainingMinutes = totalMinutes - hours * MINUTES_PER_HOUR;

  if (hours === 0) {
    return `${totalMinutes}m`;
  }

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

export function isWorkflowLive(state: string): boolean {
  return state === 'active';
}
