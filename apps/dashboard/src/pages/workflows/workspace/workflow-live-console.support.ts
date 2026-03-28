const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function formatWorkflowActivitySourceLabel(sourceLabel: string, sourceKind: string): string {
  const normalizedLabel = readNonEmptyText(sourceLabel);
  if (normalizedLabel && !UUID_RE.test(normalizedLabel)) {
    return humanizeToken(normalizedLabel);
  }

  return humanizeToken(sourceKind);
}

export function normalizeWorkflowConsoleText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function readNonEmptyText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
