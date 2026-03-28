/**
 * Structural and unit tests for the Models page.
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

const dashboardSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readComponent(relPath: string): string {
  return fs.readFileSync(path.join(dashboardSrc, relPath), 'utf-8');
}

function readLlmProvidersSource(): string {
  return [
    'pages/llm-providers/llm-providers-page.tsx',
    'pages/llm-providers/llm-providers-page.support.ts',
  ]
    .map((pathName) => readComponent(pathName))
    .join('\n');
}

/* ─── Structural: three sections ────────────────────────────────────────── */

describe('LlmProvidersPage renders three sections', () => {
  const source = readLlmProvidersSource();

  it('renders the Providers section with heading and Add Provider button', () => {
    expect(source).toContain('Models');
    expect(source).toContain(
      'Manage model providers, the model catalog, and specialist model assignments.',
    );
    expect(source).not.toContain('<h1 className="text-2xl font-semibold">Routing</h1>');
    expect(source).toContain('Add Provider');
    expect(source).toContain('ProviderCard');
    expect(source).toContain('max-h-[85vh] max-w-2xl overflow-y-auto');
    expect(source).toContain('Choose the provider type first.');
    expect(source).toContain('Provider setup');
    expect(source).toContain(
      'Selecting a provider type auto-fills the recommended name and base URL.',
    );
    expect(source).toContain('Restore recommended endpoint');
    expect(source).toContain('Recommended operator label for this provider type');
    expect(source).toContain('existingNames={providers.map((provider) => provider.name)}');
    expect(source).toContain(
      'Use your existing subscription',
    );
    expect(source).toContain('ChatGPT Plus/Pro');
    expect(source).toContain('separate API billing.');
    expect(source).not.toContain('Use your ChatGPT subscription to access OpenAI models.');
  });

  it('keeps oauth disconnect as a no-content-safe action and explains disconnected impact clearly', () => {
    const apiSource = readComponent('lib/api.ts');

    expect(apiSource).toContain(
      'requestJson(`/api/v1/config/oauth/providers/${providerId}/disconnect`, {',
    );
    expect(apiSource).toContain('allowNoContent: true');
    expect(source).toContain(
      'OAuth disconnected. Models and specialist assignments stay configured, but this provider cannot serve',
    );
    expect(source).toContain(
      'Models and specialist assignments stay configured, but this provider cannot serve requests',
    );
    expect(source).toContain('until OAuth is reconnected.');
    expect(source).toContain('window.location.assign(result.authorizeUrl)');
    expect(source).not.toContain(
      "window.open(result.authorizeUrl, '_blank', 'noopener,noreferrer')",
    );
  });

  it('uses a confirmed destructive flow for provider deletion and labeled responsive actions', () => {
    expect(source).toContain('DeleteProviderDialog');
    expect(source).toContain('Delete provider?');
    expect(source).toContain('Delete Provider');
    expect(source).toContain('variant="destructive"');
    expect(source).toContain('requestProviderDelete');
    expect(source).toContain('sm:flex-row sm:flex-wrap sm:justify-end');
    expect(source).toContain('Deleting this provider removes its {modelCount} discovered');
    expect(source).toContain('clears any saved model');
    expect(source).not.toContain('onDelete={(id) => deleteMutation.mutate(id)}');
  });

  it('treats provider api keys as write-only', () => {
    expect(source).toContain('Stored write-only. Existing keys are never shown again.');
    expect(source).toContain('credentials_configured');
  });

  it('uses elevated provider surfaces so cards stay legible in dark theme', () => {
    expect(source).toContain(
      "const ELEVATED_SURFACE_CLASS_NAME = 'border-border/80 bg-surface shadow-sm';",
    );
    expect(source).toContain(
      "const SUBDUED_SURFACE_CLASS_NAME = 'rounded-xl border border-border/70 bg-surface p-4 shadow-sm';",
    );
    expect(source).not.toContain('bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/80');
    expect(source).not.toContain('bg-white/95 p-4 dark:border-slate-800 dark:bg-slate-900/80');
  });

  it('renders the Model Catalog section with endpoint column', () => {
    expect(source).toContain('Model Catalog');
    expect(source).toContain('Subscription Models');
    expect(source).toContain('SubsectionPanel');
    expect(source).toContain('formatContextWindow');
    expect(source).toContain('endpoint_type');
    expect(source).toContain('title={group.providerName}');
    expect(source).toContain('discovered models.');
    expect(source).not.toContain('<DashboardSectionCard\n        key={providerId}');
    expect(source).not.toContain('className="border rounded-md"');
    expect(source).not.toContain('hover:bg-muted/50 transition-colors');
  });

  it('shows the no-model empty state copy only once', () => {
    expect(
      source.split('No API-key provider models. Add a provider and run discovery.').length - 1,
    ).toBe(1);
  });

  it('renders the Model Assignments section', () => {
    expect(source).toContain('Model Assignments');
    expect(source).toContain(
      'Specialists may inherit this model when they do not need an explicit override.',
    );
    expect(source).toContain('RoleAssignmentsSection');
    expect(source).toContain('SubsectionPanel');
    expect(source).toContain('<SubsectionPanel');
    expect(source).toContain('DEFAULT_LIST_PAGE_SIZE');
    expect(source).toContain('paginateListItems');
    expect(source).toContain('ListPagination');
    expect(source).toContain('const [page, setPage] = useState(1);');
    expect(source).toContain(
      'const [pageSize, setPageSize] = useState<number>(DEFAULT_LIST_PAGE_SIZE);',
    );
    expect(source).toContain('const pagination = paginateListItems(roleRows, page, pageSize);');
    expect(source).toContain('listRoleDefinitions');
    expect(source).toContain('buildAssignmentRoleRows');
    expect(source).toContain('validateAssignmentSetup');
    expect(source).toContain('summarizeAssignmentSurface');
    expect(source).toContain('Orchestrator and specialist agent model overrides');
    expect(source).not.toContain('1 orchestrator');
    expect(source).toContain(
      'Add a shared default or choose explicit models for the affected roles below.',
    );
    expect(source).not.toContain('Affected roles');
    expect(source).not.toContain('assignmentValidation.missingRoleNames.map((roleName) => (');
    expect(source).not.toContain(
      'No system default is configured. Assign explicit models below or restore a default model before saving.',
    );
    expect(source).not.toContain('Select a model for this role or restore a system default.');
    expect(source).not.toContain('Needs model source');
    expect(source).toContain('Assignment coverage needs attention');
    expect(source).toContain('Assignments are blocked');
    expect(source).toContain('Unsaved assignment changes');
    expect(source).toContain(
      'Review the updated default and role overrides, then save when ready.',
    );
    expect(source).toContain('const shouldShowAssignmentGuidance =');
    expect(source).toContain('assignmentValidation.blockingIssues.length > 0 || hasUnsavedChanges');
    expect(source).not.toContain('Assignments are ready to save');
    expect(source).toContain('Review providers');
    expect(source).toContain('Review model catalog');
    expect(source).toContain('Default route');
    expect(source).toContain('Explicit overrides');
    expect(source).toContain('Catalog posture');
    expect(source).toContain('Choose explicit models only where the default is not enough.');
    expect(source).not.toContain('Older assignment rows stay visible until they are cleaned up.');
    expect(source).toContain('id="llm-model-assignments"');
    expect(source).toContain('id="llm-providers-library"');
    expect(source).toContain('id="llm-model-catalog"');
    expect(source).toContain('md:hidden');
    expect(source).toContain('hidden md:block');
    expect(source).toContain('Provider Selection');
    expect(source).toContain('Status');
    expect(source).toContain(
      'Use the shared system default unless the orchestrator or a specific role needs a',
    );
    expect(source).toContain('renderOverridesSummaryChip(');
    expect(source).toContain('aria-expanded={isOverridesExpanded}');
    expect(source).toContain('Show overrides');
    expect(source).toContain('Hide overrides');
    expect(source).toContain('title="System Default"');
    expect(source).toContain('title="Orchestrator and specialist agent model overrides"');
    expect(source).not.toContain('<DashboardSectionCard\n        title="System Default"');
    expect(source).not.toContain('title="Override Matrix"');
    expect(source).not.toContain('className="space-y-4 border-t px-4 py-4"');
    expect(source).toContain(
      'const [isOverridesExpanded, setIsOverridesExpanded] = useState(false);',
    );
    expect(source).not.toContain('() => explicitOverrideCount > 0');
    expect(source).toContain('pagination.items.map((role) => {');
    expect(source).toContain('itemLabel="overrides"');
    expect(source).toContain('onPageChange={setPage}');
    expect(source).toContain('setPageSize(value);');
    expect(source).toContain('setPage(1);');
    expect(source).toContain(
      'disabled={saveMutation.isPending || !assignmentValidation.isValid || !hasUnsavedChanges}',
    );
    expect(source).not.toContain('const ROLE_NAMES');
  });

  it('places the assignment summary cards between Subscription Models and Model Assignments', () => {
    const pageSource = readComponent('pages/llm-providers/llm-providers-page.tsx');

    expect(pageSource).toContain('<AssignmentSummaryCards cards={assignmentSurfaceCards} />');
    expect(pageSource.indexOf('title="Subscription Models"')).toBeLessThan(
      pageSource.indexOf('<AssignmentSummaryCards cards={assignmentSurfaceCards} />'),
    );
    expect(
      pageSource.indexOf('<AssignmentSummaryCards cards={assignmentSurfaceCards} />'),
    ).toBeLessThan(pageSource.indexOf('<RoleAssignmentsSection'));
  });

  it('declares assignment summary hooks before the loading and error early returns', () => {
    const pageSource = readComponent('pages/llm-providers/llm-providers-page.tsx');
    const loadingIndex = pageSource.indexOf('const isLoading =');
    const errorIndex = pageSource.indexOf('const hasError =');
    const summaryMemoIndex = pageSource.indexOf('const initialAssignmentSummaryCards = useMemo');
    const summaryStateIndex = pageSource.indexOf(
      'const [assignmentSurfaceCards, setAssignmentSurfaceCards] = useState',
    );
    const summarySyncEffectIndex = pageSource.indexOf(
      'setAssignmentSurfaceCards(initialAssignmentSummaryCards);',
    );

    expect(loadingIndex).toBeGreaterThan(-1);
    expect(errorIndex).toBeGreaterThan(loadingIndex);
    expect(summaryMemoIndex).toBeGreaterThan(-1);
    expect(summaryStateIndex).toBeGreaterThan(-1);
    expect(summarySyncEffectIndex).toBeGreaterThan(-1);
    expect(summaryMemoIndex).toBeLessThan(loadingIndex);
    expect(summaryStateIndex).toBeLessThan(loadingIndex);
    expect(summarySyncEffectIndex).toBeLessThan(loadingIndex);
  });

  it('uses a truncated description column in the desktop assignment table for scanability', () => {
    expect(source).toContain('const TABLE_ROLE_DESCRIPTION_LIMIT = 56;');
    expect(source).toContain(
      'function summarizeRoleDescription(role: AssignmentRoleRow): string {',
    );
    expect(source).toContain('function truncateRoleDescription(description: string): string {');
    expect(source).toContain('function summarizeStaleRoleBadgeLabel(input: {');
    expect(source).toContain('<TableHead className="w-1/5">Description</TableHead>');
    expect(source).toContain('<TableCell className="align-middle text-sm text-foreground">');
    expect(source).toContain(
      '<span className="block truncate" title={summarizeRoleDescription(role)}>',
    );
  });

  it('does not frame inactive roles as cleanup debt in the summary surfaces', () => {
    expect(source).toContain('const staleRoleCount = missingAssignmentCount;');
    expect(source).toContain(
      "return `${input.missingAssignmentCount} missing assignment${input.missingAssignmentCount === 1 ? '' : 's'}`;",
    );
    expect(source).not.toContain('inactive role still need cleanup');
  });

  it('renders desktop assignment rows as role, description, status, provider selection, and reasoning columns', () => {
    expect(source).toContain('<Table className="table-fixed">');
    expect(source).toContain('<TableHead className="w-1/5">Role</TableHead>');
    expect(source).toContain('<TableHead className="w-1/5">Description</TableHead>');
    expect(source).toContain('<TableHead className="w-1/5 text-center">Status</TableHead>');
    expect(source).toContain(
      '<TableHead className="w-1/5 text-center">Provider Selection</TableHead>',
    );
    expect(source).toContain('<TableHead className="w-1/5 text-center">Reasoning</TableHead>');
    expect(source).toContain('<TableRow key={role.name} className="align-middle [&>td]:py-4">');
    expect(source).toContain(
      '<TableCell className="align-middle text-sm font-medium whitespace-nowrap">',
    );
    expect(source).toContain('<TableCell className="align-middle whitespace-nowrap">');
    expect(source).toContain('<div className="flex justify-center">');
    expect(source).toContain("const selectClassName = 'h-11 w-full max-w-[180px]';");
    expect(source).toContain(
      "? 'h-11 w-full max-w-[260px] border-red-300 focus-visible:ring-red-500'",
    );
    expect(source).toContain("? 'h-11 w-full max-w-[260px]'");
    expect(source).toContain('className="h-11 w-[120px]"');
  });

  it('renders dynamic ReasoningControl based on model schema', () => {
    expect(source).toContain('ReasoningControl');
    expect(source).toContain('reasoning_config');
    expect(source).toContain('buildReasoningValue');
  });

  it('uses neutral alert surfaces for provider validation feedback', () => {
    expect(source).toContain(
      "const DIALOG_ALERT_CLASS_NAME = 'rounded-xl border px-4 py-3 text-sm shadow-sm';",
    );
    expect(source).toContain(
      "backgroundColor: 'color-mix(in srgb, var(--color-surface) 90%, var(--color-warning) 10%)'",
    );
    expect(source).toContain(
      "backgroundColor: 'color-mix(in srgb, var(--color-surface) 90%, var(--color-destructive) 10%)'",
    );
    expect(source).toContain("const FIELD_ERROR_CLASS_NAME = 'text-xs font-medium';");
    expect(source).not.toContain('dark:text-red-300');
    expect(source).not.toContain('dark:bg-slate-950/80');
  });

  it('keeps add-provider submit enabled while surfacing field validation only after save is attempted', () => {
    expect(source).toContain('const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);');
    expect(source).toContain('Required provider details are highlighted under each field after you try to save.');
    expect(source).toContain('type="submit" disabled={mutation.isPending}');
    expect(source).not.toContain('This provider is ready to save with the current settings.');
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
    expect(defaults.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
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
