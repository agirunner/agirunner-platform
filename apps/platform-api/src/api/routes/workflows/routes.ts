import type { FastifyPluginAsync } from 'fastify';

import { workflowOperatorRecordRoutes } from './operator-record.routes.js';
import { registerWorkflowBaseRoutes } from './register-base-routes.js';
import { registerWorkflowDocumentAndControlRoutes } from './register-document-and-control-routes.js';
import { createWorkflowRoutesContext } from './shared.js';
import { registerWorkflowWorkItemTaskRoutes } from './register-work-item-task-routes.js';
import { registerWorkflowWorkItemRoutes } from './register-work-item-routes.js';

export const workflowRoutes: FastifyPluginAsync = async (app) => {
  const context = createWorkflowRoutesContext(app);

  await app.register(workflowOperatorRecordRoutes);
  registerWorkflowBaseRoutes(context);
  registerWorkflowWorkItemRoutes(context);
  registerWorkflowWorkItemTaskRoutes(context);
  registerWorkflowDocumentAndControlRoutes(context);
};
