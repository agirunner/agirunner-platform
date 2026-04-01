export class DomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', 400, message, details);
  }
}

export class CycleDetectedError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CYCLE_DETECTED', 400, message, details);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', 401, message);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Forbidden', details?: Record<string, unknown>) {
    super('FORBIDDEN', 403, message, details);
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Not found') {
    super('NOT_FOUND', 404, message);
  }
}

export class ConflictError extends DomainError {
  constructor(message = 'Conflict', details?: Record<string, unknown>) {
    super('CONFLICT', 409, message, details);
  }
}

export class AgentBusyError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('AGENT_BUSY', 409, message, details);
  }
}

export class InvalidStateTransitionError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('INVALID_STATE_TRANSITION', 409, message, details);
  }
}

export class SchemaValidationFailedError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    const summarizedMessage = summarizeSchemaValidationMessage(message, details);
    super('SCHEMA_VALIDATION_FAILED', 422, summarizedMessage, details);
  }
}

function summarizeSchemaValidationMessage(
  message: string,
  details?: Record<string, unknown>,
): string {
  const issues = details?.issues;
  if (!issues || typeof issues !== 'object') {
    return message;
  }

  const fieldErrors = readStringArrayRecord((issues as Record<string, unknown>).fieldErrors);
  const formErrors = readStringArray((issues as Record<string, unknown>).formErrors);
  const firstDetail = [...formErrors, ...Object.values(fieldErrors).flat()].find(
    (value) => value.trim().length > 0,
  );
  if (!firstDetail) {
    return message;
  }

  return `${message}: ${firstDetail}`;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function readStringArrayRecord(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, readStringArray(entry)]),
  );
}

export class RateLimitedError extends DomainError {
  constructor(message = 'Too many requests', details?: Record<string, unknown>) {
    super('RATE_LIMITED', 429, message, details);
  }
}

export class ServiceUnavailableError extends DomainError {
  constructor(message = 'Service unavailable', details?: Record<string, unknown>) {
    super('SERVICE_UNAVAILABLE', 503, message, details);
  }
}
