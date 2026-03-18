import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(filename: string) {
  return readFileSync(resolve(import.meta.dirname, filename), 'utf8');
}

describe('workspace settings tab source', () => {
  it('turns settings into a calmer control plane with compact save status and stronger disclosures', () => {
    const tabSource = readSource('./workspace-settings-tab.tsx');
    const shellSource = readSource('./workspace-settings-shell.tsx');

    expect(shellSource).toContain('className="sr-only"');
    expect(shellSource).toContain('props.overview.summary');
    expect(tabSource).toContain('Open only the section you need.');
    expect(tabSource).toContain('Resolve Before Saving');
    expect(tabSource).toContain('Workspace Lifecycle');
    expect(tabSource).toContain('Workspace Basics');
    expect(tabSource).toContain('Repository & Git Defaults');
    expect(tabSource).toContain('Repository optional');
    expect(tabSource).toContain('Git token');
    expect(tabSource).toContain('Active workspaces can receive new work.');
    expect(tabSource).toContain('Danger');
    expect(tabSource).toContain('Delete workspace');
    expect(tabSource).toContain('Open danger');
    expect(tabSource).toContain('buildWorkspaceSettingsSurfaceSummary');
    expect(tabSource).toContain('SettingsDisclosureSection');
    expect(tabSource).toContain('SelectTrigger');
    expect(tabSource).toContain('aria-invalid');
    expect(tabSource).toContain('max-w-3xl text-sm leading-5 text-muted');
    expect(tabSource).not.toContain('Settings overview');
    expect(tabSource).not.toContain('General');
    expect(tabSource).not.toContain('Repository defaults');
    expect(tabSource).not.toContain('Git identity');
    expect(tabSource).not.toContain('Save readiness');
    expect(tabSource).not.toContain('Jump to section');
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

  it('keeps workspace settings limited to operator-facing basics and repository defaults', () => {
    const source = readSource('./workspace-settings-tab.tsx');

    expect(source).toContain('Name and slug.');
    expect(source).not.toContain('summarizeWorkspaceContext');
    expect(source).not.toContain('No workspace context saved yet.');
    expect(source).not.toContain('Workspace Context');
    expect(source).not.toContain('Planning brief');
    expect(source).not.toContain('label="Description"');
  });
});
