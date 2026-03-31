import type { ApiKeyIdentity } from '../../auth/api-key.js';

export interface ActorContext {
  type: 'user' | 'agent' | 'worker' | 'api_key' | 'system';
  id: string;
  name: string;
}

export interface ActorContextHints {
  role?: string | null;
  isOrchestratorTask?: boolean | null;
}

const SYSTEM_ACTOR: ActorContext = { type: 'system', id: 'system', name: 'System' };

export function actorFromAuth(
  auth: ApiKeyIdentity | undefined,
  hints: ActorContextHints = {},
): ActorContext {
  if (!auth) return SYSTEM_ACTOR;

  const isOrchestratorOwned =
    hints.isOrchestratorTask === true || hints.role?.trim().toLowerCase() === 'orchestrator';

  switch (auth.scope) {
    case 'admin':
    case 'service':
      return auth.userId
        ? { type: 'user', id: auth.userId, name: 'Admin' }
        : { type: 'api_key', id: auth.id, name: auth.scope === 'service' ? 'Service API' : 'Admin API' };
    case 'worker':
      return {
        type: 'worker',
        id: auth.ownerId ?? auth.id,
        name: isOrchestratorOwned ? 'Orchestrator agent' : 'Specialist Agent',
      };
    case 'agent':
      return {
        type: 'agent',
        id: auth.ownerId ?? auth.id,
        name: isOrchestratorOwned ? 'Orchestrator execution' : 'Specialist Execution',
      };
    default:
      return SYSTEM_ACTOR;
  }
}
