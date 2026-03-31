export interface WorkflowContextLike {
  lifecycle?: unknown;
  active_stages?: unknown;
  current_stage?: unknown;
  live_visibility?: unknown;
  variables?: unknown;
  playbook?: unknown;
  playbook_definition?: unknown;
}

export interface WorkflowInstructionLayerInput {
  isOrchestratorTask: boolean;
  role?: string;
  roleConfig?: Record<string, unknown> | null;
  workflow?: WorkflowContextLike | null;
  workspace?: Record<string, unknown> | null;
  taskInput?: Record<string, unknown> | null;
  workItem?: Record<string, unknown> | null;
  predecessorHandoff?: Record<string, unknown> | null;
  orchestratorContext?: Record<string, unknown> | null;
}
