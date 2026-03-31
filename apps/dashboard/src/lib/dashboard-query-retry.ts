const MAX_TRANSIENT_RETRIES = 1;

export function shouldRetryDashboardQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_TRANSIENT_RETRIES) {
    return false;
  }

  const statusCode = readHttpStatusCode(error);
  if (statusCode === 401) {
    return false;
  }
  if (statusCode !== null && statusCode >= 400 && statusCode < 500) {
    return false;
  }

  return true;
}

function readHttpStatusCode(error: unknown): number | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const match = error.message.match(/\bHTTP (\d{3})\b/);
  return match ? Number.parseInt(match[1], 10) : null;
}
