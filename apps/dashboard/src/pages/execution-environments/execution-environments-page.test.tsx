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
    expect(markup).toContain('aria-label="Edit environment"');
    expect(markup).toContain('title="Edit environment"');
    expect(markup).toContain('aria-label="Verify environment"');
    expect(markup).toContain('title="Verify environment"');
    expect(markup).toContain('aria-label="Set default environment"');
    expect(markup).toContain('title="Set default environment"');
    expect(markup).toContain('aria-label="Archive environment"');
    expect(markup).toContain('title="Archive environment"');
    expect(markup).not.toContain('>Copy<');
    expect(markup).not.toContain('>Edit<');
    expect(markup).not.toContain('>Verify<');
    expect(markup).not.toContain('>Default<');
    expect(markup).not.toContain('>Archive<');
  });

  it('uses a copy mode that reopens the create dialog with a cleared name', () => {
    const pageSource = readSource('./execution-environments-page.tsx');

    expect(pageSource).toContain("mode: 'copy'");
    expect(pageSource).toContain('createCopiedExecutionEnvironmentForm');
    expect(pageSource).toContain("title={dialogState.mode === 'edit' ? 'Edit Environment' : dialogState.mode === 'copy' ? 'Copy Environment' : 'Create Custom Environment'}");
    expect(pageSource).toContain("submitLabel={dialogState.mode === 'edit' ? 'Save Environment' : 'Create Environment'}");
  });
});
