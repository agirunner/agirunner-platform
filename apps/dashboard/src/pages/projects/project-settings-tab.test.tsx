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
    expect(tabSource).toContain('Resolve before saving');
    expect(tabSource).toContain('Project basics');
    expect(tabSource).toContain('Repository & git defaults');
    expect(tabSource).toContain('Repository optional');
    expect(tabSource).toContain('Credentials posture');
    expect(tabSource).toContain('Models');
    expect(tabSource).toContain('Planning brief');
    expect(tabSource).toContain('Open credentials');
    expect(tabSource).toContain('ProjectModelOverridesTab');
    expect(tabSource).toContain('buildProjectSettingsSurfaceSummary');
    expect(tabSource).toContain('ToggleCard');
    expect(tabSource).toContain('SelectTrigger');
    expect(tabSource).toContain('aria-invalid');
    expect(tabSource).toContain('max-w-3xl text-sm leading-5 text-muted');
    expect(tabSource).toContain('<Badge variant="secondary">{surfaceSummary.stagedSecretChangeLabel}</Badge>');
    expect(tabSource).not.toContain('Settings overview');
    expect(tabSource).not.toContain('General');
    expect(tabSource).not.toContain('Repository defaults');
    expect(tabSource).not.toContain('Git identity');
    expect(tabSource).not.toContain('Save readiness');
    expect(tabSource).not.toContain('Jump to section');
    expect(tabSource).not.toContain('Project model overrides must be valid JSON');
    expect(tabSource).not.toContain('uppercase tracking-[0.16em] text-muted');
  });

  it('gives operators explicit secret posture choices instead of silent secret loss', () => {
    const source = readSource('./project-settings-tab.tsx');
    const supportSource = readSource('./project-settings-support.ts');

    expect(source).toContain('Open the posture only when a secret needs work.');
    expect(source).toContain('Edit secret');
    expect(source).toContain('Preserve existing');
    expect(source).toContain('Replace on save');
    expect(source).toContain('Clear on save');
    expect(source).toContain('Secret posture');
    expect(source).toContain('buildProjectSecretPostureSummary');
    expect(supportSource).toContain('Configured');
    expect(supportSource).toContain('Not configured');
  });

  it('keeps project model overrides behind a second disclosure layer with quieter save feedback', () => {
    const tabSource = readSource('./project-model-overrides-tab.tsx');
    const sectionSource = readSource('./project-model-overrides-sections.tsx');

    expect(tabSource).toContain('Override posture');
    expect(tabSource).toContain('Edit overrides');
    expect(tabSource).toContain('Review effective models');
    expect(tabSource).not.toContain('Project model overrides saved.');
    expect(sectionSource).toContain('No project-specific overrides configured yet.');
    expect(sectionSource).toContain('Reasoning config');
  });

  it('collapses the planning brief behind a preview-first disclosure', () => {
    const source = readSource('./project-settings-tab.tsx');

    expect(source).toContain('summarizeProjectBrief');
    expect(source).toContain('No project brief saved yet.');
    expect(source).toContain('Open brief');
    expect(source).toContain('Keep long-form project context tucked away');
  });
});
