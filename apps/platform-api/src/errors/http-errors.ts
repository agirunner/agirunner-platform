import {
  ConflictError,
  DomainError,
  ForbiddenError,
  InvalidStateTransitionError,
  NotFoundError,
  SchemaValidationFailedError,
  UnauthorizedError,
  ValidationError,
} from './domain-errors.js';

export function mapErrorToHttpStatus(error: unknown): number {
  if (error instanceof ValidationError) return 400;
  if (error instanceof UnauthorizedError) return 401;
  if (error instanceof ForbiddenError) return 403;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof InvalidStateTransitionError || error instanceof ConflictError) return 409;
  if (error instanceof SchemaValidationFailedError) return 422;
  if (error instanceof DomainError) return error.statusCode;

  const code = typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN') return 403;
  if (code === 'NOT_FOUND') return 404;
  if (code === 'INVALID_STATE_TRANSITION' || code === 'CONFLICT') return 409;
  if (code === 'SCHEMA_VALIDATION_FAILED') return 422;
  if (code === 'VALIDATION_ERROR') return 400;

  const statusCode =
    typeof error === 'object' && error !== null ? (error as { statusCode?: unknown }).statusCode : undefined;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600) {
    return statusCode;
  }

  return 500;
}
