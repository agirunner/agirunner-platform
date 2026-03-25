import { DASHBOARD_BADGE_TOKENS } from '../../lib/dashboard-badge-palette.js';

export interface ToolTag {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  owner?: 'runtime' | 'task';
  access_scope?: 'specialist_and_orchestrator' | 'orchestrator_only';
  usage_surface?: 'runtime' | 'task_sandbox' | 'provider_capability';
  is_callable?: boolean;
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
  badgeClassName?: string;
}

export interface ToolAccessScopeDescriptor {
  label: string;
  badgeVariant: 'default' | 'secondary' | 'outline' | 'warning';
  badgeClassName?: string;
}

export interface ToolSummaryCard {
  label: string;
  value: string;
  detail: string;
}

const neutralBadgeClassName =
  DASHBOARD_BADGE_TOKENS.informationNeutral.className;

const warmBadgeClassName =
  DASHBOARD_BADGE_TOKENS.warning.className;

const providerBadgeClassName =
  DASHBOARD_BADGE_TOKENS.informationPrimary.className;

const TOOL_ACCESS_SCOPE_DESCRIPTORS = {
  specialist_and_orchestrator: {
    label: 'Specialist + orchestrator',
    badgeVariant: 'outline',
    badgeClassName: neutralBadgeClassName,
  },
  orchestrator_only: {
    label: 'Orchestrator only',
    badgeVariant: 'outline',
    badgeClassName: warmBadgeClassName,
  },
  provider_capability: {
    label: 'Provider capability',
    badgeVariant: 'outline',
    badgeClassName: providerBadgeClassName,
  },
} satisfies Record<string, ToolAccessScopeDescriptor>;

const CATEGORY_DESCRIPTORS: Record<ToolCategory, ToolCategoryDescriptor> = {
  files: {
    label: 'Files',
    detail: 'Read, write, edit, and list files in the workspace.',
    badgeVariant: 'outline',
    badgeClassName: neutralBadgeClassName,
  },
  search: {
    label: 'Search',
    detail: 'Find files and search content with grep, glob, and tool discovery.',
    badgeVariant: 'outline',
    badgeClassName: neutralBadgeClassName,
  },
  execution: {
    label: 'Execution',
    detail: 'Shell command execution with output truncation.',
    badgeVariant: 'outline',
    badgeClassName: neutralBadgeClassName,
  },
  git: {
    label: 'Git',
    detail: 'Version control operations.',
    badgeVariant: 'outline',
    badgeClassName: neutralBadgeClassName,
  },
  artifacts: {
    label: 'Artifacts',
    detail: 'Upload, list, and read workflow artifacts.',
    badgeVariant: 'outline',
    badgeClassName: neutralBadgeClassName,
  },
  memory: {
    label: 'Memory',
    detail: 'Read and write workspace memory.',
    badgeVariant: 'outline',
    badgeClassName: neutralBadgeClassName,
  },
  web: {
    label: 'Web',
    detail: 'Fetch content from URLs.',
    badgeVariant: 'outline',
    badgeClassName: neutralBadgeClassName,
  },
  workflow: {
    label: 'Workflow',
    detail: 'Orchestrator-only workflow management tools.',
    badgeVariant: 'outline',
    badgeClassName: warmBadgeClassName,
  },
  control: {
    label: 'Control',
    detail: 'Escalation and agent control flow.',
    badgeVariant: 'outline',
    badgeClassName: neutralBadgeClassName,
  },
};

export function describeToolCategory(category: string | null | undefined): ToolCategoryDescriptor {
  if (!category) {
    return {
      label: 'Uncategorized',
      detail: 'No category.',
      badgeVariant: 'outline',
      badgeClassName: neutralBadgeClassName,
    };
  }
  return CATEGORY_DESCRIPTORS[category as ToolCategory] ?? {
    label: category,
    detail: '',
    badgeVariant: 'outline',
    badgeClassName: neutralBadgeClassName,
  };
}

export function describeToolAccessScope(tool: ToolTag): ToolAccessScopeDescriptor {
  if (tool.usage_surface === 'provider_capability' || tool.is_callable === false) {
    return TOOL_ACCESS_SCOPE_DESCRIPTORS.provider_capability;
  }
  if (tool.access_scope === 'orchestrator_only') {
    return TOOL_ACCESS_SCOPE_DESCRIPTORS.orchestrator_only;
  }
  return TOOL_ACCESS_SCOPE_DESCRIPTORS.specialist_and_orchestrator;
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
    {
      label: 'Agentic runtime owned',
      value: `${runtimeCount}`,
      detail: 'Run directly in the runtime loop',
    },
    {
      label: 'Task execution owned',
      value: `${taskCount}`,
      detail: 'Require a specialist task sandbox',
    },
  ];
}
