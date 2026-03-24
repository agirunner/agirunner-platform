import { ForbiddenError } from '../errors/domain-errors.js';

export type ApiKeyScope = 'agent' | 'worker' | 'admin' | 'service';

const ALLOWED_SCOPES: Record<ApiKeyScope, ApiKeyScope[]> = {
  agent: ['agent', 'worker', 'admin', 'service'],
  worker: ['worker', 'admin', 'service'],
  admin: ['admin', 'service'],
  service: ['service'],
};

export function hasRequiredScope(actual: ApiKeyScope, required: ApiKeyScope): boolean {
  return ALLOWED_SCOPES[required].includes(actual);
}

export function isOperatorScope(scope: ApiKeyScope): boolean {
  return scope === 'admin' || scope === 'service';
}

export function enforceScope(actual: ApiKeyScope, required: ApiKeyScope): void {
  if (!hasRequiredScope(actual, required)) {
    throw new ForbiddenError(`Scope '${actual}' cannot access '${required}' endpoint`);
  }
}
