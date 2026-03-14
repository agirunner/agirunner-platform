/**
 * Structural and unit tests for the LLM Providers page.
 *
 * Tests cover:
 *  - Page renders the three sections (Providers, Model Catalog, Role Assignments)
 *  - Provider type auto-fill mapping function
 *  - Context window formatting function
 *  - Reasoning config badge and label helpers
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildAssignmentRoleRows,
  formatContextWindow,
  reasoningLabel,
  reasoningBadgeVariant,
  getProviderTypeDefaults,
} from './llm-providers-page.js';

const dashboardSrc = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

function readComponent(relPath: string): string {
  return fs.readFileSync(path.join(dashboardSrc, relPath), 'utf-8');
}

function readLlmProvidersSource(): string {
  return [
    'pages/config/llm-providers-page.tsx',
    'pages/config/llm-providers-page.support.ts',
  ]
    .map((pathName) => readComponent(pathName))
    .join('\n');
}

/* ─── Structural: three sections ────────────────────────────────────────── */

describe('LlmProvidersPage renders three sections', () => {
  const source = readLlmProvidersSource();

  it('renders the Providers section with heading and Add Provider button', () => {
    expect(source).toContain('LLM Providers');
    expect(source).toContain('Add Provider');
    expect(source).toContain('ProviderCard');
    expect(source).toContain('max-h-[85vh] max-w-2xl overflow-y-auto');
    expect(source).toContain('Choose the provider type first.');
    expect(source).toContain('Provider setup');
    expect(source).toContain('Selecting a provider type auto-fills the recommended name and base URL.');
    expect(source).toContain('Restore recommended endpoint');
    expect(source).toContain('Recommended operator label for this provider type');
    expect(source).toContain('existingNames={providers.map((provider) => provider.name)}');
  });

  it('uses a confirmed destructive flow for provider deletion and labeled responsive actions', () => {
    expect(source).toContain('DeleteProviderDialog');
    expect(source).toContain('Delete provider?');
    expect(source).toContain('Delete Provider');
    expect(source).toContain('variant="destructive"');
    expect(source).toContain('requestProviderDelete');
    expect(source).toContain('sm:flex-row sm:flex-wrap sm:justify-end');
    expect(source).toContain("Deleting this provider removes its {modelCount} discovered {modelCount === 1 ? 'model' : 'models'} from the catalog and clears any saved model assignments that point at them.");
    expect(source).not.toContain('onDelete={(id) => deleteMutation.mutate(id)}');
  });

  it('treats provider api keys as write-only', () => {
    expect(source).toContain('Stored write-only. Existing keys are never shown again.');
    expect(source).toContain('credentials_configured');
  });

  it('uses elevated provider surfaces so cards stay legible in dark theme', () => {
    expect(source).toContain("const ELEVATED_SURFACE_CLASS_NAME = 'border-border/80 bg-surface shadow-sm';");
    expect(source).toContain("const SUBDUED_SURFACE_CLASS_NAME = 'rounded-xl border border-border/70 bg-surface p-4 shadow-sm';");
    expect(source).not.toContain('bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/80');
    expect(source).not.toContain('bg-white/95 p-4 dark:border-slate-800 dark:bg-slate-900/80');
  });

  it('renders the Model Catalog section with endpoint column', () => {
    expect(source).toContain('Model Catalog');
    expect(source).toContain('formatContextWindow');
    expect(source).toContain('endpoint_type');
  });

  it('renders the Model Assignments section', () => {
    expect(source).toContain('Model Assignments');
    expect(source).toContain('RoleAssignmentsSection');
    expect(source).toContain('listRoleDefinitions');
    expect(source).toContain('buildAssignmentRoleRows');
    expect(source).toContain('validateAssignmentSetup');
    expect(source).toContain('summarizeAssignmentSurface');
    expect(source).toContain('Orchestrator and Role Overrides');
    expect(source).toContain('1 orchestrator');
    expect(source).toContain('Add a shared default or choose explicit models for the affected roles below.');
    expect(source).toContain('Affected roles');
    expect(source).toContain('assignmentValidation.missingRoleNames.map((roleName) => (');
    expect(source).not.toContain('No system default is configured. Assign explicit models below or restore a default model before saving.');
    expect(source).not.toContain('Select a model for this role or restore a system default.');
    expect(source).not.toContain('Needs model source');
    expect(source).toContain('Assignment coverage needs attention');
    expect(source).toContain('Assignments are blocked');
    expect(source).toContain('Assignments are ready to save');
    expect(source).toContain('Review providers');
    expect(source).toContain('Review model catalog');
    expect(source).toContain('Default route');
    expect(source).toContain('Explicit overrides');
    expect(source).toContain('Catalog posture');
    expect(source).toContain('id="llm-model-assignments"');
    expect(source).toContain('id="llm-providers-library"');
    expect(source).toContain('id="llm-model-catalog"');
    expect(source).toContain('md:hidden');
    expect(source).toContain('hidden md:block');
    expect(source).toContain('Provider Selection');
    expect(source).toContain('Status');
    expect(source).toContain('Use the shared system default unless the orchestrator or a specific role needs a');
    expect(source).toContain("Badge variant={explicitOverrideCount > 0 ? 'default' : 'outline'}");
    expect(source).toContain("aria-expanded={isOverridesExpanded}");
    expect(source).toContain("Show overrides");
    expect(source).toContain("Hide overrides");
    expect(source).toContain("() => explicitOverrideCount > 0");
    expect(source).not.toContain('const ROLE_NAMES');
  });

  it('uses a truncated description column in the desktop assignment table for scanability', () => {
    expect(source).toContain('const TABLE_ROLE_DESCRIPTION_LIMIT = 56;');
    expect(source).toContain('function summarizeRoleDescription(role: AssignmentRoleRow): string {');
    expect(source).toContain('function truncateRoleDescription(description: string): string {');
    expect(source).toContain('function summarizeStaleRoleBadgeLabel(input: {');
    expect(source).toContain('<TableHead className="w-1/5">Description</TableHead>');
    expect(source).toContain('<TableCell className="align-middle text-sm text-muted">');
    expect(source).toContain('<span className="block truncate" title={summarizeRoleDescription(role)}>');
  });

  it('renders desktop assignment rows as role, description, status, provider selection, and reasoning columns', () => {
    expect(source).toContain('<Table className="table-fixed">');
    expect(source).toContain('<TableHead className="w-1/5">Role</TableHead>');
    expect(source).toContain('<TableHead className="w-1/5">Description</TableHead>');
    expect(source).toContain('<TableHead className="w-1/5 text-center">Status</TableHead>');
    expect(source).toContain('<TableHead className="w-1/5 text-center">Provider Selection</TableHead>');
    expect(source).toContain('<TableHead className="w-1/5 text-center">Reasoning</TableHead>');
    expect(source).toContain('<TableRow key={role.name} className="align-middle [&>td]:py-4">');
    expect(source).toContain('<TableCell className="align-middle text-sm font-medium whitespace-nowrap">');
    expect(source).toContain('<TableCell className="align-middle whitespace-nowrap">');
    expect(source).toContain('<div className="flex justify-center">');
    expect(source).toContain("const selectClassName = 'h-11 w-full max-w-[180px]';");
    expect(source).toContain("? 'h-11 w-full max-w-[260px] border-red-300 focus-visible:ring-red-500'");
    expect(source).toContain("? 'h-11 w-full max-w-[260px]'");
    expect(source).toContain('className="h-11 w-[120px]"');
  });

  it('renders dynamic ReasoningControl based on model schema', () => {
    expect(source).toContain('ReasoningControl');
    expect(source).toContain('reasoning_config');
    expect(source).toContain('buildReasoningValue');
  });

  it('uses neutral alert surfaces for provider validation feedback', () => {
    expect(source).toContain('const DIALOG_ALERT_CLASS_NAME = \'rounded-xl border px-4 py-3 text-sm shadow-sm\';');
    expect(source).toContain('backgroundColor: \'color-mix(in srgb, var(--color-surface) 90%, var(--color-warning) 10%)\'');
    expect(source).toContain('backgroundColor: \'color-mix(in srgb, var(--color-surface) 90%, var(--color-destructive) 10%)\'');
    expect(source).toContain('const FIELD_ERROR_CLASS_NAME = \'text-xs font-medium\';');
    expect(source).not.toContain('dark:text-red-300');
    expect(source).not.toContain('dark:bg-slate-950/80');
  });
});

/* ─── Provider type auto-fill mapping ───────────────────────────────────── */

describe('getProviderTypeDefaults auto-fill mapping', () => {
  it('returns correct defaults for openai', () => {
    const defaults = getProviderTypeDefaults('openai');
    expect(defaults.name).toBe('OpenAI');
    expect(defaults.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('returns correct defaults for anthropic', () => {
    const defaults = getProviderTypeDefaults('anthropic');
    expect(defaults.name).toBe('Anthropic');
    expect(defaults.baseUrl).toBe('https://api.anthropic.com/v1');
  });

  it('returns correct defaults for google', () => {
    const defaults = getProviderTypeDefaults('google');
    expect(defaults.name).toBe('Google');
    expect(defaults.baseUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta',
    );
  });
});

/* ─── Context window formatting ─────────────────────────────────────────── */

describe('formatContextWindow', () => {
  it('formats undefined as dash', () => {
    expect(formatContextWindow(undefined)).toBe('-');
  });

  it('formats small numbers as-is', () => {
    expect(formatContextWindow(512)).toBe('512');
  });

  it('formats thousands as K', () => {
    expect(formatContextWindow(200000)).toBe('200K');
  });

  it('formats non-round thousands with decimal', () => {
    expect(formatContextWindow(128500)).toBe('128.5K');
  });

  it('formats millions as M', () => {
    expect(formatContextWindow(1000000)).toBe('1M');
  });

  it('formats 1048576 as M with decimal', () => {
    expect(formatContextWindow(1048576)).toBe('1.0M');
  });

  it('formats 2000000 as 2M', () => {
    expect(formatContextWindow(2000000)).toBe('2M');
  });
});

/* ─── Reasoning config helpers ─────────────────────────────────────────── */

describe('reasoningLabel', () => {
  it('returns none for null config', () => {
    expect(reasoningLabel(null)).toBe('none');
  });

  it('returns none for undefined config', () => {
    expect(reasoningLabel(undefined)).toBe('none');
  });

  it('returns label with type and default for discrete options', () => {
    const config = { type: 'effort' as const, options: ['low', 'medium', 'high'], default: 'high' };
    expect(reasoningLabel(config)).toContain('effort');
    expect(reasoningLabel(config)).toContain('high');
  });

  it('returns label with type and default for numeric config', () => {
    const config = { type: 'thinking_budget' as const, min: 0, max: 24576, default: 0 };
    expect(reasoningLabel(config)).toContain('thinking_budget');
  });
});

describe('reasoningBadgeVariant', () => {
  it('returns secondary for null config', () => {
    expect(reasoningBadgeVariant(null)).toBe('secondary');
  });

  it('returns secondary for undefined config', () => {
    expect(reasoningBadgeVariant(undefined)).toBe('secondary');
  });

  it('returns default for models with reasoning support', () => {
    const config = { type: 'effort' as const, options: ['low', 'medium', 'high'], default: 'high' };
    expect(reasoningBadgeVariant(config)).toBe('default');
  });
});

describe('buildAssignmentRoleRows', () => {
  it('always includes the orchestrator row first so orchestrator model selection is explicit', () => {
    const rows = buildAssignmentRoleRows([], []);

    expect(rows[0]).toEqual({
      name: 'orchestrator',
      description:
        'Workflow orchestrator model used for activation planning, delegation, review, and recovery.',
      isActive: true,
      source: 'system',
    });
  });

  it('prefers active catalog roles and sorts them alphabetically', () => {
    const rows = buildAssignmentRoleRows(
      [
        { id: '2', name: 'reviewer', description: 'Reviews output', is_active: true },
        { id: '1', name: 'architect', description: 'Shapes the system', is_active: true },
      ],
      [],
    );

    expect(rows).toEqual([
      {
        name: 'orchestrator',
        description:
          'Workflow orchestrator model used for activation planning, delegation, review, and recovery.',
        isActive: true,
        source: 'system',
      },
      {
        name: 'architect',
        description: 'Shapes the system',
        isActive: true,
        source: 'catalog',
      },
      {
        name: 'reviewer',
        description: 'Reviews output',
        isActive: true,
        source: 'catalog',
      },
    ]);
  });

  it('keeps stale assignment rows visible after active catalog roles', () => {
    const rows = buildAssignmentRoleRows(
      [
        { id: '1', name: 'developer', description: 'Builds features', is_active: true },
        { id: '2', name: 'qa', description: 'Validates releases', is_active: false },
      ],
      [
        { role_name: 'developer', primary_model_id: 'model-1' },
        { role_name: 'qa', primary_model_id: 'model-2' },
        { role_name: 'orchestrator', primary_model_id: 'model-3' },
      ],
    );

    expect(rows).toEqual([
      {
        name: 'orchestrator',
        description:
          'Workflow orchestrator model used for activation planning, delegation, review, and recovery.',
        isActive: true,
        source: 'system',
      },
      {
        name: 'developer',
        description: 'Builds features',
        isActive: true,
        source: 'catalog',
      },
      {
        name: 'qa',
        description: 'Validates releases',
        isActive: false,
        source: 'catalog',
      },
    ]);
  });
});
