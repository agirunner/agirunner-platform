import { ForbiddenError } from '../errors/domain-errors.js';

export type ApiKeyScope = 'agent' | 'worker' | 'admin';

const scopeRank: Record<ApiKeyScope, number> = {
  agent: 1,
  worker: 2,
  admin: 3,
};

export function hasRequiredScope(actual: ApiKeyScope, required: ApiKeyScope): boolean {
  return scopeRank[actual] >= scopeRank[required];
}

export function enforceScope(actual: ApiKeyScope, required: ApiKeyScope): void {
  if (!hasRequiredScope(actual, required)) {
    throw new ForbiddenError(`Scope '${actual}' cannot access '${required}' endpoint`);
  }
}
