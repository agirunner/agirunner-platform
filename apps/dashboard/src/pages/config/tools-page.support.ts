export interface ToolTag {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
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

export interface ToolSummaryCard {
  label: string;
  value: string;
  detail: string;
}

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
    detail: 'Read and write project memory.',
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

export function summarizeTools(tools: ToolTag[]): ToolSummaryCard[] {
  const byCategory = new Map<string, number>();
  for (const tool of tools) {
    const cat = tool.category ?? 'uncategorized';
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
  }

  return [
    { label: 'Total tools', value: `${tools.length}`, detail: `${byCategory.size} categories` },
    { label: 'Agent tools', value: `${(byCategory.get('files') ?? 0) + (byCategory.get('search') ?? 0) + (byCategory.get('execution') ?? 0) + (byCategory.get('git') ?? 0)}`, detail: 'Files, search, execution, git' },
    { label: 'Workflow tools', value: `${byCategory.get('workflow') ?? 0}`, detail: 'Orchestrator-only management tools' },
  ];
}
