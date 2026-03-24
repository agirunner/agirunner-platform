export interface ToolTag {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  owner?: 'runtime' | 'task';
  is_built_in?: boolean;
}

export const TOOL_CATEGORIES = [
  'files', 'search', 'execution', 'git', 'artifacts',
  'memory', 'web', 'workflow', 'control',
] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export interface ToolCategoryDescriptor {
  label: string;
  detail: string;
  badgeVariant: 'default' | 'secondary' | 'outline' | 'warning' | 'success';
}

export interface ToolOwnerDescriptor {
  label: string;
  detail: string;
  badgeVariant: 'default' | 'secondary';
}

export interface ToolSummaryCard {
  label: string;
  value: string;
  detail: string;
}

const OWNER_DESCRIPTORS: Record<NonNullable<ToolTag['owner']>, ToolOwnerDescriptor> = {
  runtime: {
    label: 'Runtime',
    detail: 'Runs directly inside the runtime process.',
    badgeVariant: 'secondary',
  },
  task: {
    label: 'Task sandbox',
    detail: 'Runs inside the specialist task sandbox.',
    badgeVariant: 'default',
  },
};

const CATEGORY_DESCRIPTORS: Record<ToolCategory, ToolCategoryDescriptor> = {
  files: {
    label: 'Files',
    detail: 'Read, write, edit, and list files in the workspace.',
    badgeVariant: 'default',
  },
  search: {
    label: 'Search',
    detail: 'Find files and search content with grep, glob, and tool discovery.',
    badgeVariant: 'default',
  },
  execution: {
    label: 'Execution',
    detail: 'Shell command execution with output truncation.',
    badgeVariant: 'default',
  },
  git: {
    label: 'Git',
    detail: 'Version control operations.',
    badgeVariant: 'secondary',
  },
  artifacts: {
    label: 'Artifacts',
    detail: 'Upload, list, and read workflow artifacts.',
    badgeVariant: 'secondary',
  },
  memory: {
    label: 'Memory',
    detail: 'Read and write workspace memory.',
    badgeVariant: 'secondary',
  },
  web: {
    label: 'Web',
    detail: 'Fetch content from URLs.',
    badgeVariant: 'outline',
  },
  workflow: {
    label: 'Workflow',
    detail: 'Orchestrator-only workflow management tools.',
    badgeVariant: 'warning',
  },
  control: {
    label: 'Control',
    detail: 'Escalation and agent control flow.',
    badgeVariant: 'outline',
  },
};

export function describeToolCategory(category: string | null | undefined): ToolCategoryDescriptor {
  if (!category) {
    return {
      label: 'Uncategorized',
      detail: 'No category.',
      badgeVariant: 'outline',
    };
  }
  return CATEGORY_DESCRIPTORS[category as ToolCategory] ?? {
    label: category,
    detail: '',
    badgeVariant: 'outline',
  };
}

export function describeToolOwner(owner: ToolTag['owner']): ToolOwnerDescriptor {
  if (!owner) {
    return {
      label: 'Unassigned',
      detail: 'Ownership is not declared for this tool.',
      badgeVariant: 'secondary',
    };
  }
  return OWNER_DESCRIPTORS[owner];
}

export function summarizeTools(tools: ToolTag[]): ToolSummaryCard[] {
  const byCategory = new Map<string, number>();
  let runtimeCount = 0;
  let taskCount = 0;
  for (const tool of tools) {
    const cat = tool.category ?? 'uncategorized';
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
    if (tool.owner === 'runtime') {
      runtimeCount += 1;
    }
    if (tool.owner === 'task') {
      taskCount += 1;
    }
  }

  return [
    { label: 'Total', value: `${tools.length}`, detail: `${byCategory.size} categories` },
    { label: 'Runtime-owned', value: `${runtimeCount}`, detail: 'Run directly in the runtime loop' },
    { label: 'Task-owned', value: `${taskCount}`, detail: 'Require a specialist task sandbox' },
  ];
}
