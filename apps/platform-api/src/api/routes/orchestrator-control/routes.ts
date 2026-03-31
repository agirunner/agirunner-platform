import type { FastifyPluginAsync } from 'fastify';

import { buildOrchestratorControlRouteContext } from './route-context.js';
import { registerOrchestratorControlManagedTaskRoutes } from './register-managed-task-routes.js';
import { registerOrchestratorControlWorkflowRoutes } from './register-workflow-routes.js';
import { registerOrchestratorControlWorkItemRoutes } from './register-work-item-routes.js';

export { normalizeOrchestratorChildWorkflowLinkage } from './child-workflows.js';
export { normalizeExplicitAssessmentSubjectTaskLinkage } from './task-normalization.js';

export const orchestratorControlRoutes: FastifyPluginAsync = async (app) => {
  const context = buildOrchestratorControlRouteContext(app);

  registerOrchestratorControlWorkItemRoutes(context);
  registerOrchestratorControlManagedTaskRoutes(context);
  registerOrchestratorControlWorkflowRoutes(context);
};
