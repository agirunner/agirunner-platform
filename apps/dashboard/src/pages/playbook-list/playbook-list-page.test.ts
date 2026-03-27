import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './playbook-list-page.tsx',
    './playbook-list-page.library.tsx',
    './playbook-list-page.support.ts',
    '../../components/list-pagination.tsx',
    '../../components/ui/icon-action-button.tsx',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

function readLibrarySource() {
  return readFileSync(resolve(import.meta.dirname, './playbook-list-page.library.tsx'), 'utf8');
}

describe('playbook list page source', () => {
  it('uses a full-page authoring workspace instead of a long modal', () => {
    const source = readSource();
    expect(source).toContain('PlaybookAuthoringForm');
    expect(source).toContain('playbook-create-workspace');
    expect(source).toContain('Full-page authoring workspace');
    expect(source).toContain('className="space-y-6 p-4 sm:p-6"');
    expect(source).not.toContain('mx-auto max-w-[88rem]');
    expect(source).toContain('sticky bottom-4');
    expect(source).toContain('xl:sticky xl:top-6');
    expect(source).not.toContain('Definition JSON');
    expect(source).toContain('buildPlaybookDefinition(');
    expect(source).toContain('label={`Open ${family.name}`}');
    expect(source).toContain('aria-label={`Toggle ${family.name} active`}');
    expect(source).toContain('Pencil className="h-4 w-4"');
    expect(source).toContain("import { IconActionButton } from '../../components/ui/icon-action-button.js'");
    expect(source).toContain('<IconActionButton');
    expect(source).toContain('label={`Launch ${family.name}`}');
    expect(source).toContain('size="icon"');
    expect(source).toContain('This playbook is inactive. Use the row toggle to reactivate the family before');
    expect(source).toContain('Back to playbook library');
    expect(source).toContain('PlaybookLibraryToolbar');
    expect(source).toContain('PlaybookLibraryTable');
    expect(source).toContain('dashboardApi.archivePlaybook');
    expect(source).toContain('dashboardApi.restorePlaybook');
    expect(source).toContain('Create and manage playbooks that define workflow guidance, team structure, and workflow goals.');
    expect(source).toContain('Page size');
    expect(source).toContain('Showing');
    expect(source).toContain('Previous');
    expect(source).toContain('Next');
    expect(source).toContain('buildPlaybookFamilies');
    expect(source).toContain('filterPlaybookFamilies');
    expect(source).toContain('summarizePlaybookProcess');
    expect(source).toContain('Process');
    expect(source).toContain('roles');
    expect(source).toContain('stages');
    expect(source).toContain('goals');
    expect(source).toContain('Playbook details');
    expect(source).toContain('Most revisions');
    expect(source).toContain('families ·');
    expect(source).toContain('statusFilter');
    expect(source).toContain('lifecycleFilter');
    expect(source).toContain('sort');
    expect(source).toContain('aria-label="Playbook status"');
    expect(source).toContain('aria-label="Playbook lifecycle"');
    expect(source).not.toContain('SegmentedFilter');
    expect(source).toContain('validatePlaybookCreateDraft');
    expect(source).toContain('Resolve these blockers before creating the playbook.');
    expect(source).toContain('Slug preview:');
    expect(source).toContain('reconcileValidationIssues(currentIssues, nextIssues)');
    expect(source).toContain('Define the playbook identity first, then author the process, specialists,');
    expect(source).not.toContain('col-span-2 w-full');
    expect(source).not.toContain('Description</span>');
    expect(source).not.toContain('PlaybookLibrarySummaryCards');
    expect(source).not.toContain('dashboardApi.deletePlaybook');
    expect(source).not.toContain('Delete Playbook Revision');
    expect(source).not.toContain('PlaybookFamilyCard');
    expect(source).not.toContain('Settings2 className="h-4 w-4"');
    expect(source).not.toContain('className="h-8 w-8"');
  });

  it('keeps fresh playbook drafts blank instead of backfilling active roles', () => {
    const source = readSource();
    expect(source).not.toContain('dashboardApi.listRoleDefinitions');
    expect(source).not.toContain('activeRoleNames');
    expect(source).not.toContain('roles: activeRoleNames.map');
  });

  it('uses plain lifecycle text, shows process before outcome, and drops the expanded process metric chips', () => {
    const source = readLibrarySource();
    expect(source).toContain("from '../../lib/dashboard-badge-palette.js'");
    expect(source).toContain('playbookLifecycleBadgeClassName');
    expect(source).toContain('<TableHead>Lifecycle</TableHead>');
    expect(source).toContain('className="font-medium text-foreground underline-offset-4 hover:underline"');
    expect(source).toContain('<p className="text-sm text-foreground">{family.slug}</p>');
    expect(source).toContain('DASHBOARD_BADGE_TOKENS.success.className');
    expect(source).toContain('DASHBOARD_BADGE_TOKENS.informationSecondary.className');
    expect((source.match(/<TableCell className="text-sm text-foreground">/g) ?? []).length).toBe(3);
    expect(source).toContain('{describePlaybookLifecycle(family.lifecycle)}');
    expect(source).toContain('<div className="mt-2 text-foreground">{processSummary}</div>');
    expect(source).toContain('<div className="mt-2 text-foreground">{family.outcome}</div>');
    expect(source).not.toContain('<Button asChild size="sm" variant="outline"');
    expect(source).not.toContain('Users className="h-3.5 w-3.5"');
    expect(source).not.toContain('CheckCheck className="h-3.5 w-3.5"');
    expect(source).not.toContain('inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/20 px-3 py-1');
    expect(source).not.toContain('<p className="text-sm text-muted">{family.slug}</p>');
    expect(source).not.toContain('<div className="mt-2 text-muted">{processSummary}</div>');
    expect(source).not.toContain('<div className="mt-2 text-muted">{family.outcome}</div>');
    expect(source).not.toContain('<TableCell className="text-sm text-foreground">{describePlaybookLifecycle(family.lifecycle)}</TableCell>');

    const processIndex = source.indexOf('<div className="font-medium">Process</div>');
    const outcomeIndex = source.indexOf('<div className="font-medium">Outcome</div>');

    expect(processIndex).toBeGreaterThan(-1);
    expect(outcomeIndex).toBeGreaterThan(-1);
    expect(processIndex).toBeLessThan(outcomeIndex);
    expect(source).not.toContain('Manage');
  });

  it('renders a first-run playbook empty state with an icon and create action', () => {
    const source = readLibrarySource();

    expect(source).toContain("import { Card, CardContent } from '../../components/ui/card.js';");
    expect(source).toContain('No playbooks yet');
    expect(source).toContain('Create first playbook');
    expect(source).toContain(
      'Create the first playbook, then shape workflow guidance, specialist coordination, and',
    );
    expect(source).toContain('launch behavior from one place.');
    expect(source).toContain('<Rocket className="h-12 w-12 text-muted" />');
    expect(source).toContain('props.familyCount === 0');
    expect(source).toContain('onCreatePlaybook(): void;');
  });
});
