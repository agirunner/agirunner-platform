export type ProviderType = 'openai' | 'anthropic' | 'google' | 'openai-compatible' | 'openai-codex';

export interface AddProviderDraft {
  providerType: ProviderType;
  name: string;
  baseUrl: string;
  apiKey: string;
}

export interface AddProviderValidation {
  fieldErrors: {
    name?: string;
    baseUrl?: string;
    apiKey?: string;
  };
  issues: string[];
  isValid: boolean;
}

export interface AddProviderValidationContext {
  existingNames?: string[];
}

export interface AssignmentSetupValidation {
  missingRoleNames: string[];
  blockingIssues: string[];
  isValid: boolean;
}

export interface AssignmentSurfaceSummaryCard {
  label: string;
  value: string;
  detail: string;
}

export interface AssignmentSurfaceGuidance {
  tone: 'success' | 'warning' | 'danger';
  headline: string;
  detail: string;
}

export function describeProviderTypeSetup(providerType: ProviderType): {
  title: string;
  detail: string;
  authLabel: string;
} {
  if (providerType === 'openai-compatible') {
    return {
      title: 'Compatible endpoint',
      detail: 'Best for Ollama, vLLM, or another OpenAI-style gateway that you control.',
      authLabel: 'API key optional',
    };
  }
  if (providerType === 'openai-codex') {
    return {
      title: 'Subscription provider',
      detail: 'Uses the ChatGPT subscription backend and should keep the hosted secure endpoint.',
      authLabel: 'Subscription auth required',
    };
  }
  if (providerType === 'anthropic') {
    return {
      title: 'Anthropic API',
      detail: 'Uses Anthropic-hosted models with a managed HTTPS endpoint.',
      authLabel: 'API key required',
    };
  }
  if (providerType === 'google') {
    return {
      title: 'Google API',
      detail: 'Uses the hosted Gemini endpoint with Google API authentication.',
      authLabel: 'API key required',
    };
  }
  return {
    title: 'OpenAI API',
    detail: 'Uses the hosted OpenAI API endpoint with a standard provider key.',
    authLabel: 'API key required',
  };
}

export function validateAddProviderDraft(
  draft: AddProviderDraft,
  context: AddProviderValidationContext = {},
): AddProviderValidation {
  const fieldErrors: AddProviderValidation['fieldErrors'] = {};
  const normalizedName = draft.name.trim();

  if (!normalizedName) {
    fieldErrors.name = 'Enter a provider name.';
  } else if (hasDuplicateProviderName(normalizedName, context.existingNames ?? [])) {
    fieldErrors.name = 'Choose a distinct provider name. This label is already in use.';
  }

  if (!draft.baseUrl.trim()) {
    fieldErrors.baseUrl = 'Enter the provider base URL.';
  } else if (!isValidProviderUrl(draft.baseUrl.trim(), draft.providerType)) {
    fieldErrors.baseUrl =
      draft.providerType === 'openai-compatible'
        ? 'Enter a valid http:// or https:// endpoint.'
        : 'Enter a valid https:// endpoint.';
  }

  if (draft.providerType !== 'openai-compatible' && !draft.apiKey.trim()) {
    fieldErrors.apiKey = 'Paste the provider API key.';
  }

  const issues = Object.values(fieldErrors);
  return {
    fieldErrors,
    issues,
    isValid: issues.length === 0,
  };
}

export function validateAssignmentSetup(input: {
  defaultModelId: string;
  roleAssignments: Array<{ roleName: string; modelId: string }>;
}): AssignmentSetupValidation {
  if (input.defaultModelId !== '__none__') {
    return {
      missingRoleNames: [],
      blockingIssues: [],
      isValid: true,
    };
  }

  const missingRoleNames = input.roleAssignments
    .filter((assignment) => assignment.modelId === '__none__')
    .map((assignment) => assignment.roleName);

  if (missingRoleNames.length === 0) {
    return {
      missingRoleNames: [],
      blockingIssues: [],
      isValid: true,
    };
  }

  return {
    missingRoleNames,
    blockingIssues: [
      `Choose a system default model or assign explicit models for: ${missingRoleNames.join(', ')}.`,
    ],
    isValid: false,
  };
}

export function summarizeAssignmentSurface(input: {
  enabledModelCount: number;
  defaultModelConfigured: boolean;
  roleCount: number;
  explicitOverrideCount: number;
  staleRoleCount: number;
  inactiveRoleCount: number;
  missingAssignmentCount: number;
  blockingIssues: string[];
}): {
  cards: AssignmentSurfaceSummaryCard[];
  guidance: AssignmentSurfaceGuidance | null;
} {
  const inheritedRoleCount = Math.max(0, input.roleCount - input.explicitOverrideCount);
  const cards: AssignmentSurfaceSummaryCard[] = [
    {
      label: 'Default route',
      value: input.defaultModelConfigured ? 'System default set' : 'No system default',
      detail: input.defaultModelConfigured
        ? 'Roles without overrides inherit the shared model route.'
        : 'Pick a shared default or assign every role explicitly.',
    },
    {
      label: 'Explicit overrides',
      value: `${input.explicitOverrideCount}/${input.roleCount}`,
      detail:
        inheritedRoleCount > 0
          ? `${inheritedRoleCount} role${inheritedRoleCount === 1 ? '' : 's'} inherit the shared default.`
          : 'Every role has an explicit model assignment.',
    },
    {
      label: 'Catalog posture',
      value:
        input.enabledModelCount > 0
          ? `${input.enabledModelCount} enabled models`
          : 'No enabled models',
      detail:
        input.staleRoleCount > 0
          ? summarizeCatalogPostureDetail({
              missingAssignmentCount: input.missingAssignmentCount,
            })
          : 'No stale assignment rows remain.',
    },
  ];

  if (input.enabledModelCount === 0) {
    return {
      cards,
      guidance: {
        tone: 'danger',
        headline: 'Assignments are blocked',
        detail:
          'Add or enable at least one model before configuring the system default or per-role overrides.',
      },
    };
  }

  if (input.blockingIssues.length > 0) {
    return {
      cards,
      guidance: {
        tone: 'warning',
        headline: 'Assignment coverage needs attention',
        detail: input.blockingIssues[0],
      },
    };
  }

  return {
    cards,
    guidance: null,
  };
}

function summarizeCatalogPostureDetail(input: {
  missingAssignmentCount: number;
}): string {
  if (input.missingAssignmentCount > 0) {
    return `${input.missingAssignmentCount} missing assignment${input.missingAssignmentCount === 1 ? '' : 's'} still need cleanup.`;
  }
  return 'No stale assignment rows remain.';
}

function hasDuplicateProviderName(name: string, existingNames: string[]): boolean {
  const normalizedName = normalizeProviderName(name);
  return existingNames.some((value) => normalizeProviderName(value) === normalizedName);
}

function normalizeProviderName(value: string): string {
  return value.trim().toLowerCase();
}

function isValidProviderUrl(value: string, providerType: ProviderType): boolean {
  try {
    const url = new URL(value);
    if (providerType === 'openai-compatible') {
      return url.protocol === 'http:' || url.protocol === 'https:';
    }
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}
