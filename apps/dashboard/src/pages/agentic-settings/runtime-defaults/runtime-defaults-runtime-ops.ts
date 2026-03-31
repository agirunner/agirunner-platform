import { RUNTIME_OPERATION_CONNECTIVITY_FIELDS } from './runtime-defaults-runtime-ops.connectivity-fields.js';
export { RUNTIME_OPERATION_SECTION_DEFINITIONS } from './runtime-defaults-runtime-ops.sections.js';
import { RUNTIME_OPERATION_TASK_FIELDS } from './runtime-defaults-runtime-ops.task-fields.js';
import { RUNTIME_OPERATION_SUPERVISION_FIELDS } from './runtime-defaults-runtime-ops.supervision-fields.js';
import { RUNTIME_OPERATION_WORKSPACE_FIELDS } from './runtime-defaults-runtime-ops.workspace-fields.js';

export const RUNTIME_OPERATION_FIELD_DEFINITIONS = [
  ...RUNTIME_OPERATION_TASK_FIELDS,
  ...RUNTIME_OPERATION_CONNECTIVITY_FIELDS,
  ...RUNTIME_OPERATION_SUPERVISION_FIELDS,
  ...RUNTIME_OPERATION_WORKSPACE_FIELDS,
];
