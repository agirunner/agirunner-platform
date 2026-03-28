export interface OperatorSurfaceContext {
  isOrchestratorTask?: boolean | null;
  is_orchestrator_task?: boolean | null;
}

export type ExecutionBackend = 'runtime_only' | 'runtime_plus_task' | null | undefined;
export type ToolOwner = 'runtime' | 'task' | null | undefined;

export function describeAgentSurface(context: OperatorSurfaceContext = {}): string {
  return isOrchestratorTask(context) ? 'Orchestrator agent' : 'Specialist Agent';
}

export function describeExecutionSurface(context: OperatorSurfaceContext = {}): string {
  return isOrchestratorTask(context) ? 'Orchestrator execution' : 'Specialist Execution';
}

export function describeExecutionBackendSurface(
  backend: ExecutionBackend,
  context: OperatorSurfaceContext = {},
): string {
  const agent = describeAgentSurface(context);
  if (backend === 'runtime_only') {
    return `${agent} only`;
  }
  return `${agent} + ${describeExecutionSurface(context)}`;
}

export function describeExecutionUsageSurface(
  backend: ExecutionBackend,
  usedExecution: boolean | undefined,
  context: OperatorSurfaceContext = {},
): string {
  const execution = describeExecutionSurface(context);
  if (backend === 'runtime_only') {
    return `No ${execution}`;
  }
  return usedExecution ? `Used ${execution}` : `No ${execution} used`;
}

export function describeGenericExecutionBackendSurface(backend: ExecutionBackend): string {
  if (backend === 'runtime_only') {
    return 'Specialist agent only';
  }
  return 'Specialist agent + Specialist execution';
}

export function describeGenericToolOwnerSurface(owner: ToolOwner): string | null {
  if (owner === 'runtime') {
    return 'Specialist Agent';
  }
  if (owner === 'task') {
    return 'Specialist Execution';
  }
  return null;
}

function isOrchestratorTask(context: OperatorSurfaceContext): boolean {
  return context.isOrchestratorTask === true || context.is_orchestrator_task === true;
}
