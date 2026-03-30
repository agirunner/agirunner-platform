interface StartupLogger {
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

interface PoolErrorEmitter {
  on(event: 'error', handler: (error: Error) => void): void;
}

const RETRYABLE_DATABASE_ERROR_CODES = new Set([
  '57P01',
  '57P03',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENOTFOUND',
]);

export function registerPoolErrorLogging(
  pool: PoolErrorEmitter,
  logger: StartupLogger,
  label = 'database pool',
): void {
  pool.on('error', (error) => {
    logger.error({ err: error }, `${label} error`);
  });
}

export function isRetryableDatabaseStartupError(error: unknown): boolean {
  const code = readErrorCode(error);
  if (code && RETRYABLE_DATABASE_ERROR_CODES.has(code)) {
    return true;
  }

  const message = readErrorMessage(error).toLowerCase();
  return (
    message.includes('getaddrinfo eai_again')
    || message.includes('terminating connection due to administrator command')
    || message.includes('connection terminated unexpectedly')
  );
}

export async function runDatabaseStartupWithRetry<T>(
  operation: () => Promise<T>,
  options: {
    logger: StartupLogger;
    label: string;
    retries?: number;
    delayMs?: number;
  },
): Promise<T> {
  const maxAttempts = Math.max(options.retries ?? 8, 1);
  const delayMs = Math.max(options.delayMs ?? 1_000, 0);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableDatabaseStartupError(error) || attempt === maxAttempts) {
        throw error;
      }
      options.logger.warn(
        {
          err: error,
          attempt,
          max_attempts: maxAttempts,
          retry_delay_ms: delayMs,
        },
        `${options.label} failed during startup; retrying`,
      );
      await wait(delayMs);
    }
  }

  throw new Error(`${options.label} exhausted startup retries`);
}

export async function runDatabaseListenerStartupWithRetry(
  operation: () => Promise<void>,
  options: {
    logger: StartupLogger;
    label: string;
    retries?: number;
    delayMs?: number;
  },
): Promise<void> {
  await runDatabaseStartupWithRetry(operation, options);
}

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null;
  }
  return typeof error.code === 'string' && error.code.trim().length > 0
    ? error.code
    : null;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : '';
}

async function wait(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
