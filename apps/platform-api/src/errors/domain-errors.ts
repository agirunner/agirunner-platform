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

export class UnauthorizedError extends DomainError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', 401, message);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', 403, message);
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
    super('SCHEMA_VALIDATION_FAILED', 422, message, details);
  }
}
