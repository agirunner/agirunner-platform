export interface PaletteAction {
  id: string;
  label: string;
  description?: string;
  category: 'navigate' | 'mutate' | 'create';
  workflowName?: string;
  action: () => void;
}

export interface FuzzyMatchResult {
  matches: boolean;
  score: number;
}

export function fuzzyMatch(query: string, text: string): FuzzyMatchResult {
  if (query === '') {
    return { matches: true, score: 1 };
  }

  const normalQuery = query.toLowerCase();
  const normalText = text.toLowerCase();

  if (!normalText.includes(normalQuery)) {
    return { matches: false, score: 0 };
  }

  const isExact = normalText === normalQuery;
  const isPrefix = normalText.startsWith(normalQuery);
  const lengthRatio = normalQuery.length / normalText.length;

  let score = lengthRatio;
  if (isExact) score = 1;
  else if (isPrefix) score = 0.8 + lengthRatio * 0.2;

  return { matches: true, score };
}

interface WorkflowEntry {
  id: string;
  name: string;
  state: string;
  gateWaiting?: boolean;
}

const WORKFLOW_MUTATE_ACTIONS: Record<string, string[]> = {
  active: ['pause', 'cancel'],
  paused: ['resume', 'cancel'],
};

function buildWorkflowMutateActions(
  workflow: WorkflowEntry,
  onMutate: (workflowId: string, action: string) => void,
): PaletteAction[] {
  const availableActions = WORKFLOW_MUTATE_ACTIONS[workflow.state] ?? [];

  return availableActions.map(actionName => ({
    id: `mutate-${workflow.id}-${actionName}`,
    label: `${actionName.charAt(0).toUpperCase() + actionName.slice(1)} "${workflow.name}"`,
    description: `${actionName} workflow`,
    category: 'mutate' as const,
    workflowName: workflow.name,
    action: () => onMutate(workflow.id, actionName),
  }));
}

function buildNavigateAction(
  workflow: WorkflowEntry,
  onNavigate: (workflowId: string) => void,
): PaletteAction {
  return {
    id: `navigate-${workflow.id}`,
    label: `Go to "${workflow.name}"`,
    description: `Open workflow details`,
    category: 'navigate',
    workflowName: workflow.name,
    action: () => onNavigate(workflow.id),
  };
}

function buildCreateAction(onCreate: () => void): PaletteAction {
  return {
    id: 'create-workflow',
    label: 'Create new workflow',
    description: 'Launch the workflow creation wizard',
    category: 'create',
    action: onCreate,
  };
}

export function buildActionRegistry(
  workflows: WorkflowEntry[],
  onNavigate: (workflowId: string) => void,
  onMutate: (workflowId: string, action: string) => void,
  onCreate: () => void,
): PaletteAction[] {
  const actions: PaletteAction[] = [buildCreateAction(onCreate)];

  for (const workflow of workflows) {
    actions.push(buildNavigateAction(workflow, onNavigate));
    actions.push(...buildWorkflowMutateActions(workflow, onMutate));
  }

  return actions;
}
