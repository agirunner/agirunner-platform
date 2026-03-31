export function partitionDateFor(createdAt: string | null | undefined): string {
  const value = createdAt ? new Date(createdAt) : new Date();
  if (Number.isNaN(value.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

export function isMissingExecutionLogPartitionError(error: unknown): boolean {
  const databaseError = getDatabaseErrorDetails(error);
  if (!databaseError) {
    return false;
  }
  return databaseError.message.includes('no partition of relation "execution_logs" found for row');
}

export function isDuplicateExecutionLogPartitionError(error: unknown): boolean {
  const databaseError = getDatabaseErrorDetails(error);
  if (!databaseError) {
    return false;
  }
  return (
    databaseError.code === '42P07' ||
    databaseError.code === '42710' ||
    databaseError.message.includes('already exists')
  );
}

function getDatabaseErrorDetails(error: unknown): { message: string; code?: string } | null {
  if (error instanceof Error) {
    return { message: error.message, code: (error as Error & { code?: string }).code };
  }
  if (!error || typeof error !== 'object') {
    return null;
  }
  const message = typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message
    : null;
  if (!message) {
    return null;
  }
  const code = typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;
  return { message, code };
}

export function formatBatchInsertError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'unknown insert failure';
  }

  const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : null;
  const constraint =
    typeof (error as { constraint?: unknown }).constraint === 'string'
      ? (error as { constraint: string }).constraint
      : null;
  const message =
    typeof (error as { message?: unknown }).message === 'string'
      ? normalizeErrorMessage((error as { message: string }).message)
      : 'insert failed';
  const hint = indexTupleOverflowHint(code, message);

  if (code && constraint && hint) {
    return `${message} (code=${code}, constraint=${constraint}, hint=${hint})`;
  }
  if (code && constraint) {
    return `${message} (code=${code}, constraint=${constraint})`;
  }
  if (code && hint) {
    return `${message} (code=${code}, hint=${hint})`;
  }
  if (code) {
    return `${message} (code=${code})`;
  }
  return message;
}

function indexTupleOverflowHint(code: string | null, message: string): string | null {
  if (code !== '54000') {
    return null;
  }
  if (!message.includes('index row requires')) {
    return null;
  }
  return 'oversized index tuple; audit INCLUDE columns for wide text/json fields';
}

function normalizeErrorMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, 240);
}
