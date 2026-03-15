import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(filename: string) {
  return readFileSync(resolve(import.meta.dirname, filename), 'utf8');
}

describe('project settings tab source', () => {
  it('turns settings into a calmer control plane with compact save status and stronger disclosures', () => {
    const tabSource = readSource('./project-settings-tab.tsx');
    const shellSource = readSource('./project-settings-shell.tsx');

    expect(shellSource).toContain('className="sr-only"');
    expect(shellSource).toContain('props.overview.summary');
    expect(tabSource).toContain('Open only the section you need.');
    expect(tabSource).toContain('Resolve Before Saving');
    expect(tabSource).toContain('Project Lifecycle');
    expect(tabSource).toContain('Project Basics');
    expect(tabSource).toContain('Repository & Git Defaults');
    expect(tabSource).toContain('Repository optional');
    expect(tabSource).toContain('Git token');
    expect(tabSource).toContain('Active projects can receive new work.');
    expect(tabSource).toContain('Danger');
    expect(tabSource).toContain('Delete project');
    expect(tabSource).toContain('Open danger');
    expect(tabSource).toContain('buildProjectSettingsSurfaceSummary');
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
    expect(tabSource).not.toContain('Project model overrides must be valid JSON');
    expect(tabSource).not.toContain('uppercase tracking-[0.16em] text-muted');
    expect(tabSource).not.toContain('Credentials posture');
    expect(tabSource).not.toContain('Planning brief');
    expect(tabSource).not.toContain('ProjectModelOverridesTab');
    expect(tabSource).not.toContain('title="Models"');
    expect(tabSource).not.toContain('Project Context');
    expect(tabSource).not.toContain('Playbooks can map this field into workflow inputs');
  });

  it('gives operators explicit secret posture choices instead of silent secret loss', () => {
    const source = readSource('./project-settings-tab.tsx');
    const supportSource = readSource('./project-settings-support.ts');

    expect(source).toContain('Git token');
    expect(source).toContain('Edit secret');
    expect(source).toContain('Preserve existing');
    expect(source).toContain('Replace on save');
    expect(source).toContain('Clear on save');
    expect(source).toContain('Secret posture');
    expect(source).toContain('buildProjectSecretPostureSummary');
    expect(source).not.toContain('SSH private key');
    expect(source).not.toContain('SSH known_hosts');
    expect(source).not.toContain('Webhook secret');
    expect(supportSource).toContain('Configured');
    expect(supportSource).toContain('Not configured');
  });

  it('keeps project settings limited to operator-facing basics and repository defaults', () => {
    const source = readSource('./project-settings-tab.tsx');

    expect(source).toContain('Name and slug.');
    expect(source).not.toContain('summarizeProjectContext');
    expect(source).not.toContain('No project context saved yet.');
    expect(source).not.toContain('Project Context');
    expect(source).not.toContain('Planning brief');
    expect(source).not.toContain('label="Description"');
  });
});
