export function formatMcpErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }
  return normalizeMcpErrorText(error.message, fallback);
}

export function normalizeMcpErrorText(message: string, fallback: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return fallback;
  }
  const prefixedDetail = trimmed.match(/^HTTP\s+\d+\s*:\s*(.+)$/i)?.[1]?.trim();
  if (prefixedDetail) {
    return prefixedDetail;
  }
  if (/^HTTP\s+\d+$/i.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}
