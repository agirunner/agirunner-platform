import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(filename: string) {
  return readFileSync(resolve(import.meta.dirname, filename), 'utf8');
}

describe('workspace settings tab source', () => {
  it('keeps basics and storage always open while leaving danger as the only collapsible section', () => {
    const tabSource = readSource('./workspace-settings-tab.tsx');
    const shellSource = readSource('./workspace-settings-shell.tsx');

    expect(tabSource).toContain("import { Badge } from '../../components/ui/badge.js';");
    expect(shellSource).toContain('className="sr-only"');
    expect(shellSource).toContain('props.overview.summary');
    expect(shellSource).toContain('>Settings<');
    expect(shellSource).not.toContain('Settings Control Plane');
    expect(tabSource).toContain('Resolve Before Saving');
    expect(tabSource).toContain('aria-label="Workspace active"');
    expect(tabSource).toContain('Workspace Basics');
    expect(tabSource).toContain('Workspace Storage');
    expect(tabSource).toContain('Storage type');
    expect(tabSource).toContain('Git token');
    expect(tabSource).toContain('Host Directory');
    expect(tabSource).toContain('Workspace Artifacts');
    expect(tabSource).toContain('Danger');
    expect(tabSource).toContain('Delete workspace');
    expect(tabSource).toContain('StaticSettingsSection');
    expect(tabSource).toContain('id="workspace-settings-basics"');
    expect(tabSource).toContain('id="workspace-settings-storage"');
    expect(tabSource).toContain("actionLabel={isDangerExpanded ? 'Hide danger' : 'Open danger'}");
    expect(tabSource).toContain('Open danger');
    expect(tabSource).not.toContain('actionLabel={expandedSection === \'basics\' ? \'Hide basics\' : \'Open basics\'}');
    expect(tabSource).not.toContain('actionLabel={expandedSection === \'storage\' ? \'Hide storage\' : \'Open storage\'}');
    expect(tabSource).not.toContain("isExpanded={expandedSection === 'basics'}");
    expect(tabSource).not.toContain("isExpanded={expandedSection === 'storage'}");
    expect(tabSource).toContain('buildWorkspaceSettingsSurfaceSummary');
    expect(tabSource).toContain('SettingsDisclosureSection');
    expect(tabSource).toContain('StaticSettingsSection');
    expect(tabSource).toContain('SelectTrigger');
    expect(tabSource).toContain('aria-invalid');
    expect(tabSource).toContain('text-sm leading-6 text-muted');
    expect(tabSource).not.toContain('Settings overview');
    expect(tabSource).not.toContain('General');
    expect(tabSource).not.toContain('Repository defaults');
    expect(tabSource).not.toContain('Git identity');
    expect(tabSource).not.toContain('Save readiness');
    expect(tabSource).not.toContain('Jump to section');
    expect(tabSource).not.toContain('Basics and storage stay open here');
    expect(tabSource).not.toContain('Workspace Lifecycle');
    expect(tabSource).not.toContain('Active workspaces can receive new work.');
    expect(tabSource).not.toContain('Workspace model overrides must be valid JSON');
    expect(tabSource).not.toContain('uppercase tracking-[0.16em] text-muted');
    expect(tabSource).not.toContain('Credentials posture');
    expect(tabSource).not.toContain('Planning brief');
    expect(tabSource).not.toContain('WorkspaceModelOverridesTab');
    expect(tabSource).not.toContain('title="Models"');
    expect(tabSource).not.toContain('Workspace Context');
    expect(tabSource).not.toContain('Playbooks can map this field into workflow inputs');
  });

  it('gives operators explicit secret posture choices instead of silent secret loss', () => {
    const source = readSource('./workspace-settings-tab.tsx');
    const supportSource = readSource('./workspace-settings-support.ts');

    expect(source).toContain('Git token');
    expect(source).toContain('Edit secret');
    expect(source).toContain('Preserve existing');
    expect(source).toContain('Replace on save');
    expect(source).toContain('Clear on save');
    expect(source).toContain('Secret posture');
    expect(source).toContain('buildWorkspaceSecretPostureSummary');
    expect(source).not.toContain('SSH private key');
    expect(source).not.toContain('SSH known_hosts');
    expect(source).not.toContain('Webhook secret');
    expect(supportSource).toContain('Configured');
    expect(supportSource).toContain('Not configured');
  });

  it('keeps workspace settings limited to operator-facing basics and storage configuration', () => {
    const source = readSource('./workspace-settings-tab.tsx');

    expect(source).toContain('Name and slug.');
    expect(source).not.toContain('summarizeWorkspaceContext');
    expect(source).not.toContain('No workspace context saved yet.');
    expect(source).not.toContain('Workspace Context');
    expect(source).not.toContain('Planning brief');
    expect(source).not.toContain('label="Description"');
  });

  it('points workspace artifact uploads back to the knowledge tab with concise storage guidance', () => {
    const source = readSource('./workspace-settings-tab.tsx');

    expect(source).toContain('Artifacts upload from the Knowledge tab.');
    expect(source).toContain('Stored artifacts appear in task context');
    expect(source).toContain('working directory automatically.');
    expect(source).not.toContain(
      'Workspace persistence happens through uploaded artifacts. Prior artifacts are listed in',
    );
  });
});
