export interface OperatorSurfaceContext {
  isOrchestratorTask?: boolean | null;
}

export type ExecutionBackend = 'runtime_only' | 'runtime_plus_task' | null | undefined;
export type ToolOwner = 'runtime' | 'task' | null | undefined;

export function describeAgentSurface(context: OperatorSurfaceContext = {}): string {
  return context.isOrchestratorTask ? 'Orchestrator agent' : 'Specialist Agent';
}

export function describeExecutionSurface(context: OperatorSurfaceContext = {}): string {
  return context.isOrchestratorTask ? 'Orchestrator execution' : 'Specialist Execution';
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
    return 'Agent only';
  }
  return 'Agent + Execution';
}

export function describeGenericToolOwnerSurface(owner: ToolOwner): string | null {
  if (owner === 'runtime') {
    return 'Agent';
  }
  if (owner === 'task') {
    return 'Execution';
  }
  return null;
}
