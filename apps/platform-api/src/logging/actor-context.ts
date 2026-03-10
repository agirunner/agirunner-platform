import type { ApiKeyIdentity } from '../auth/api-key.js';

export interface ActorContext {
  type: 'user' | 'agent' | 'worker' | 'api_key' | 'system';
  id: string;
  name: string;
}

const SYSTEM_ACTOR: ActorContext = { type: 'system', id: 'system', name: 'System' };

export function actorFromAuth(auth: ApiKeyIdentity | undefined): ActorContext {
  if (!auth) return SYSTEM_ACTOR;

  switch (auth.scope) {
    case 'admin':
      return auth.userId
        ? { type: 'user', id: auth.userId, name: `User ${auth.keyPrefix}` }
        : { type: 'api_key', id: auth.id, name: `Key ${auth.keyPrefix}` };
    case 'worker':
      return { type: 'worker', id: auth.ownerId ?? auth.id, name: `Worker ${auth.keyPrefix}` };
    case 'agent':
      return { type: 'agent', id: auth.ownerId ?? auth.id, name: `Agent ${auth.keyPrefix}` };
    default:
      return SYSTEM_ACTOR;
  }
}
