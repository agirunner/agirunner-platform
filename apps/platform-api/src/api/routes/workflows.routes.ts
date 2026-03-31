import type { FastifyPluginAsync } from 'fastify';

import { workflowOperatorRecordRoutes } from './workflow-operator-record-routes.js';
import { registerWorkflowBaseRoutes } from './workflows/register-base-routes.js';
import { registerWorkflowDocumentAndControlRoutes } from './workflows/register-document-and-control-routes.js';
import { createWorkflowRoutesContext } from './workflows/shared.js';
import { registerWorkflowWorkItemTaskRoutes } from './workflows/register-work-item-task-routes.js';
import { registerWorkflowWorkItemRoutes } from './workflows/register-work-item-routes.js';

export const workflowRoutes: FastifyPluginAsync = async (app) => {
  const context = createWorkflowRoutesContext(app);

  await app.register(workflowOperatorRecordRoutes);
  registerWorkflowBaseRoutes(context);
  registerWorkflowWorkItemRoutes(context);
  registerWorkflowWorkItemTaskRoutes(context);
  registerWorkflowDocumentAndControlRoutes(context);
};
