import type { OrchestratorControlRouteContext } from './route-context.js';
import { registerOrchestratorManagedTaskControlRoutes } from './register-managed-task-control-routes.js';
import { registerOrchestratorManagedTaskCreationRoutes } from './register-managed-task-creation-routes.js';

export function registerOrchestratorControlManagedTaskRoutes(
  context: OrchestratorControlRouteContext,
): void {
  registerOrchestratorManagedTaskControlRoutes(context);
  registerOrchestratorManagedTaskCreationRoutes(context);
}
