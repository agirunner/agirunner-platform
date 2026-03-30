import type { FastifyPluginAsync } from 'fastify';

import { buildOrchestratorControlRouteContext } from './orchestrator-control/route-context.js';
import { registerOrchestratorControlManagedTaskRoutes } from './orchestrator-control/register-managed-task-routes.js';
import { registerOrchestratorControlWorkflowRoutes } from './orchestrator-control/register-workflow-routes.js';
import { registerOrchestratorControlWorkItemRoutes } from './orchestrator-control/register-work-item-routes.js';

export { normalizeOrchestratorChildWorkflowLinkage } from './orchestrator-control/child-workflows.js';
export { normalizeExplicitAssessmentSubjectTaskLinkage } from './orchestrator-control/task-normalization.js';

export const orchestratorControlRoutes: FastifyPluginAsync = async (app) => {
  const context = buildOrchestratorControlRouteContext(app);

  registerOrchestratorControlWorkItemRoutes(context);
  registerOrchestratorControlManagedTaskRoutes(context);
  registerOrchestratorControlWorkflowRoutes(context);
};
