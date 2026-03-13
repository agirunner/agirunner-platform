export interface ToolTag {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  created_at?: string;
}

export interface CreateToolForm {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
}

export const TOOL_CATEGORIES = [
  'runtime',
  'vcs',
  'web',
  'language',
  'integration',
] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export interface ToolCategoryDescriptor {
  label: string;
  detail: string;
  badgeVariant: 'default' | 'secondary' | 'outline' | 'warning' | 'success';
}

export interface ToolValidation {
  fieldErrors: {
    name?: string;
    id?: string;
  };
  blockingIssues: string[];
  advisoryIssues: string[];
  isValid: boolean;
}

export interface ToolSummaryCard {
  label: string;
  value: string;
  detail: string;
}

const CATEGORY_DESCRIPTORS: Record<ToolCategory, ToolCategoryDescriptor> = {
  runtime: {
    label: 'Runtime',
    detail: 'Execution and filesystem tooling available inside runtime workers.',
    badgeVariant: 'default',
  },
  vcs: {
    label: 'Version control',
    detail: 'Git and repository operations for review, checkpointing, and delivery.',
    badgeVariant: 'secondary',
  },
  web: {
    label: 'Web',
    detail: 'Search, fetch, and internet access tools for external references.',
    badgeVariant: 'outline',
  },
  language: {
    label: 'Language',
    detail: 'Language-specific helpers for analysis, formatting, and compilation.',
    badgeVariant: 'warning',
  },
  integration: {
    label: 'Integration',
    detail: 'Outbound connectors and system-specific tool bridges.',
    badgeVariant: 'success',
  },
};

export function createToolIdFromName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function describeToolCategory(category: string | null | undefined): ToolCategoryDescriptor {
  if (!category) {
    return {
      label: 'Uncategorized',
      detail: 'No category recorded for this tool yet.',
      badgeVariant: 'outline',
    };
  }
  return CATEGORY_DESCRIPTORS[category as ToolCategory] ?? {
    label: category,
    detail: 'Custom tool category preserved from the stored tool catalog.',
    badgeVariant: 'outline',
  };
}

export function validateCreateToolForm(
  form: CreateToolForm,
  tools: ToolTag[],
): ToolValidation {
  const fieldErrors: ToolValidation['fieldErrors'] = {};
  const trimmedName = form.name.trim();
  const trimmedId = form.id.trim();

  if (!trimmedName) {
    fieldErrors.name = 'Enter a tool name.';
  }
  if (!trimmedId) {
    fieldErrors.id = 'Enter a tool ID.';
  } else if (!/^[a-z][a-z0-9_]*$/.test(trimmedId)) {
    fieldErrors.id = 'Use lowercase letters, numbers, and underscores only.';
  } else if (tools.some((tool) => tool.id.toLowerCase() === trimmedId.toLowerCase())) {
    fieldErrors.id = 'Choose a unique tool ID.';
  }

  return {
    fieldErrors,
    blockingIssues: Object.values(fieldErrors),
    advisoryIssues: buildAdvisoryIssues(form),
    isValid: Object.keys(fieldErrors).length === 0,
  };
}

export function summarizeTools(tools: ToolTag[]): ToolSummaryCard[] {
  const describedCount = tools.filter((tool) => tool.description?.trim()).length;
  const categories = new Set(
    tools.map((tool) => tool.category?.trim()).filter((value): value is string => Boolean(value)),
  );
  const runtimeCount = tools.filter((tool) => tool.category === 'runtime').length;
  return [
    {
      label: 'Catalog size',
      value: tools.length === 0 ? 'No tools' : `${tools.length} tools`,
      detail:
        tools.length === 0
          ? 'Add the first tool to make it available to operators and roles.'
          : `${runtimeCount} runtime tool${runtimeCount === 1 ? '' : 's'} currently registered.`,
    },
    {
      label: 'Category coverage',
      value: categories.size === 0 ? 'Unclassified' : `${categories.size} categories`,
      detail:
        categories.size === 0
          ? 'No categories assigned yet.'
          : `${[...categories].sort().join(', ')} currently represented in the tool catalog.`,
    },
    {
      label: 'Documentation posture',
      value:
        tools.length === 0
          ? 'No descriptions'
          : `${describedCount}/${tools.length} described`,
      detail:
        describedCount === tools.length
          ? 'Every visible tool includes operator-facing guidance.'
          : `${tools.length - describedCount} tool${tools.length - describedCount === 1 ? ' still needs a description.' : 's still need descriptions.'}`,
    },
  ];
}

function buildAdvisoryIssues(form: CreateToolForm): string[] {
  const issues: string[] = [];
  if (!form.description.trim()) {
    issues.push('Add a short description so operators understand when this tool should be granted.');
  }
  return issues;
}
