import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ExecutionEnvironmentTable } from './execution-environments-table.js';

function readSource(fileName: string) {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

describe('execution environments page source', () => {
  it('renders icon-only action buttons with hover text and copy support', () => {
    const markup = renderToStaticMarkup(
      <ExecutionEnvironmentTable
        environments={[
          {
            id: 'environment-1',
            name: 'Debian Base',
            description: 'Curated Debian baseline',
            image: 'debian:trixie-slim',
            cpu: '2',
            memory: '1Gi',
            pull_policy: 'if-not-present',
            operator_notes: 'baseline',
            bootstrap_commands: [],
            bootstrap_required_domains: [],
            declared_metadata: {},
            verified_metadata: { distro: 'debian', package_manager: 'apt' },
            tool_capabilities: {},
            compatibility_status: 'compatible',
            compatibility_errors: [],
            is_default: false,
            is_archived: false,
            is_claimable: true,
            usage_count: 1,
            source_kind: 'catalog',
            agent_hint: 'Execution environment: Debian Base',
          },
        ]}
        busyEnvironmentId={null}
        onCopy={() => undefined}
        onEdit={() => undefined}
        onVerify={() => undefined}
        onSetDefault={() => undefined}
        onArchive={() => undefined}
        onRestore={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Copy environment"');
    expect(markup).toContain('title="Copy environment"');
    expect(markup).toContain('type="button"');
    expect(markup).toContain('aria-label="Edit environment"');
    expect(markup).toContain('title="Edit environment"');
    expect(markup).toContain('aria-label="Verify environment"');
    expect(markup).toContain('title="Verify environment"');
    expect(markup).toContain('aria-label="Set default environment"');
    expect(markup).toContain('title="Set default environment"');
    expect(markup).toContain('aria-label="Archive environment"');
    expect(markup).toContain('title="Archive environment"');
    expect(markup).toContain('class="text-xs text-foreground">Curated Debian baseline</div>');
    expect(markup).toContain('class="text-xs text-foreground">OS debian | Pkg apt</div>');
    expect(markup).toContain('class="text-xs text-foreground">Pull if-not-present | Used by 1 role</div>');
    expect(markup).not.toContain('>Copy<');
    expect(markup).not.toContain('>Edit<');
    expect(markup).not.toContain('>Verify<');
    expect(markup).not.toContain('>Default<');
    expect(markup).not.toContain('>Archive<');
    expect(markup).not.toContain('class="text-xs text-muted">Curated Debian baseline</div>');
    expect(markup).not.toContain('class="text-xs text-muted">OS debian | Pkg apt</div>');
    expect(markup).not.toContain('class="text-xs text-muted">Pull if-not-present | Used by 1 role</div>');
  });

  it('uses a copy mode that reopens the create dialog with a cleared name', () => {
    const pageSource = readSource('./execution-environments-page.tsx');

    expect(pageSource).toContain("mode: 'copy'");
    expect(pageSource).toContain('createCopiedExecutionEnvironmentForm');
    expect(pageSource).toContain("title={dialogState.mode === 'edit' ? 'Edit Environment' : dialogState.mode === 'copy' ? 'Copy Environment' : 'Create Custom Environment'}");
    expect(pageSource).toContain("submitLabel={dialogState.mode === 'edit' ? 'Save Environment' : 'Create Environment'}");
  });

  it('keeps environment image editing as a plain text field instead of a suggestion-backed picker', () => {
    const dialogSource = readSource('./execution-environments-dialog.tsx');
    const pageSource = readSource('./execution-environments-page.tsx');

    expect(dialogSource).not.toContain('ImageReferenceField');
    expect(dialogSource).toContain('<Input');
    expect(dialogSource).toContain('value={props.form.image}');
    expect(dialogSource).not.toContain('imageSuggestions: string[];');
    expect(dialogSource).not.toContain('suggestions={props.imageSuggestions}');
    expect(pageSource).not.toContain('const imageSuggestions =');
    expect(pageSource).not.toContain('imageSuggestions={imageSuggestions}');
  });

  it('uses the shared page-level pagination controls for the environments grid', () => {
    const pageSource = readSource('./execution-environments-page.tsx');

    expect(pageSource).toContain('DEFAULT_LIST_PAGE_SIZE');
    expect(pageSource).toContain('paginateListItems');
    expect(pageSource).toContain('ListPagination');
    expect(pageSource).toContain('DashboardSectionCard');
    expect(pageSource).toContain('const [page, setPage] = useState(1);');
    expect(pageSource).toContain(
      'const [pageSize, setPageSize] = useState<number>(DEFAULT_LIST_PAGE_SIZE);',
    );
    expect(pageSource).toContain(
      'const pagination = paginateListItems(environments, page, pageSize);',
    );
    expect(pageSource).toContain('environments={pagination.items}');
    expect(pageSource).toContain('itemLabel="environments"');
    expect(pageSource).toContain('onPageChange={setPage}');
    expect(pageSource).toContain('setPageSize(value);');
    expect(pageSource).toContain('setPage(1);');
  });
});
