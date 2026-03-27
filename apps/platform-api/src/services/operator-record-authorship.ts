import type { ApiKeyIdentity } from '../auth/api-key.js';

export function resolveOperatorRecordActorId(identity: ApiKeyIdentity): string {
  if (identity.ownerId && identity.ownerId.trim().length > 0) {
    return identity.ownerId;
  }

  if (identity.userId && identity.userId.trim().length > 0) {
    return identity.userId;
  }

  if (identity.keyPrefix.trim().length > 0) {
    return identity.keyPrefix;
  }

  return identity.id;
}
