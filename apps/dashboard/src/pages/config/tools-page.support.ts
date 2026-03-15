export interface ToolTag {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  is_built_in?: boolean;
}

export const TOOL_CATEGORIES = [
  'runtime',
  'orchestrator',
  'web',
] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export interface ToolCategoryDescriptor {
  label: string;
  detail: string;
  badgeVariant: 'default' | 'secondary' | 'outline' | 'warning' | 'success';
}

export interface ToolSummaryCard {
  label: string;
  value: string;
  detail: string;
}

const CATEGORY_DESCRIPTORS: Record<ToolCategory, ToolCategoryDescriptor> = {
  runtime: {
    label: 'Runtime',
    detail: 'Filesystem, shell, git, memory, and artifact tools available to all agents.',
    badgeVariant: 'default',
  },
  orchestrator: {
    label: 'Orchestrator',
    detail: 'Workflow management tools — only available to the orchestrator agent.',
    badgeVariant: 'secondary',
  },
  web: {
    label: 'Web',
    detail: 'Search and fetch tools for external references.',
    badgeVariant: 'outline',
  },
};

export function describeToolCategory(category: string | null | undefined): ToolCategoryDescriptor {
  if (!category) {
    return {
      label: 'Uncategorized',
      detail: 'No category recorded for this tool.',
      badgeVariant: 'outline',
    };
  }
  return CATEGORY_DESCRIPTORS[category as ToolCategory] ?? {
    label: category,
    detail: 'Custom tool category.',
    badgeVariant: 'outline',
  };
}

export function summarizeTools(tools: ToolTag[]): ToolSummaryCard[] {
  const runtimeCount = tools.filter((t) => t.category === 'runtime').length;
  const orchestratorCount = tools.filter((t) => t.category === 'orchestrator').length;
  const webCount = tools.filter((t) => t.category === 'web').length;
  return [
    {
      label: 'Runtime',
      value: `${runtimeCount}`,
      detail: 'Filesystem, shell, git, memory, artifacts, escalation.',
    },
    {
      label: 'Orchestrator',
      value: `${orchestratorCount}`,
      detail: 'Work items, tasks, stages, gates, workflows.',
    },
    {
      label: 'Web',
      value: `${webCount}`,
      detail: 'Search and fetch.',
    },
  ];
}
