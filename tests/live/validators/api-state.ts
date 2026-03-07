interface ApiWorkflow {
  id: string;
  state: string;
}

interface ApiTask {
  id: string;
  state: string;
  title: string;
}

const VALID_TASK_TRANSITIONS = new Set([
  'pending->ready',
  'ready->claimed',
  'claimed->running',
  'running->awaiting_approval',
  'awaiting_approval->running',
  'running->output_pending_review',
  'output_pending_review->completed',
  'output_pending_review->failed',
  'running->completed',
  'running->failed',
  'failed->ready',
  'pending->cancelled',
  'ready->cancelled',
  'claimed->cancelled',
  'running->cancelled',
  'awaiting_approval->cancelled',
  'output_pending_review->cancelled',
]);

async function fetchJson<T>(url: string, key: string): Promise<T> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${key}` } });
  const body = await response.text();
  const payload = body ? JSON.parse(body) : {};

  if (!response.ok) {
    throw new Error(`API ${url} failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return payload as T;
}

export async function waitForWorkflowState(
  apiBaseUrl: string,
  apiKey: string,
  workflowId: string,
  expected: string[],
  timeoutMs = 90_000,
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const payload = await fetchJson<{ data: ApiWorkflow }>(
      `${apiBaseUrl}/api/v1/workflows/${workflowId}`,
      apiKey,
    );
    if (expected.includes(payload.data.state)) {
      return payload.data.state;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(
    `Workflow ${workflowId} did not reach states [${expected.join(', ')}] within ${timeoutMs}ms`,
  );
}

export async function waitForTaskState(
  apiBaseUrl: string,
  apiKey: string,
  taskId: string,
  expected: string[],
  timeoutMs = 90_000,
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const payload = await fetchJson<{ data: ApiTask }>(`${apiBaseUrl}/api/v1/tasks/${taskId}`, apiKey);
    if (expected.includes(payload.data.state)) {
      return payload.data.state;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Task ${taskId} did not reach states [${expected.join(', ')}] within ${timeoutMs}ms`);
}

export function validateTaskTransitionPath(taskStates: string[]): string[] {
  if (taskStates.length < 2) {
    throw new Error('Task transition validation requires at least 2 states');
  }

  const validations: string[] = [];
  for (let i = 0; i < taskStates.length - 1; i += 1) {
    const edge = `${taskStates[i]}->${taskStates[i + 1]}`;
    if (!VALID_TASK_TRANSITIONS.has(edge)) {
      throw new Error(`Invalid task transition detected: ${edge}`);
    }
    validations.push(`task_transition:${edge}`);
  }

  const terminal = taskStates[taskStates.length - 1];
  if (!['completed', 'failed', 'cancelled'].includes(terminal)) {
    throw new Error(`Task terminal state must be completed|failed|cancelled, got ${terminal}`);
  }
  validations.push(`task_terminal:${terminal}`);

  return validations;
}

export function validateWorkflowDerivedState(taskStates: string[]): string[] {
  if (taskStates.length === 0) {
    throw new Error('Workflow derived-state validation needs at least one task state');
  }

  const hasRunning = taskStates.includes('running');
  const allCompleted = taskStates.every((state) => state === 'completed');
  const hasFailed = taskStates.includes('failed');
  const hasCancelled = taskStates.includes('cancelled');

  const validations: string[] = [];

  if (allCompleted) {
    validations.push('workflow_state:completed');
    return validations;
  }

  if (hasFailed) {
    validations.push('workflow_state:failed');
    return validations;
  }

  if (hasCancelled) {
    validations.push('workflow_state:cancelled');
    return validations;
  }

  if (hasRunning) {
    validations.push('workflow_state:running');
    return validations;
  }

  validations.push('workflow_state:active_non_terminal');
  return validations;
}
