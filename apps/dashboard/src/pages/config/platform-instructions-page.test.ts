import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './platform-instructions-page.tsx'), 'utf8');
}

function readSectionSource() {
  return [
    './platform-instructions-sections.tsx',
    './platform-instructions-page.content.tsx',
    './platform-instructions-support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('platform instructions page source', () => {
  it('uses persisted dashboard api endpoints instead of page-local history', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.getPlatformInstructions()');
    expect(source).toContain('dashboardApi.listPlatformInstructionVersions()');
    expect(source).toContain('dashboardApi.updatePlatformInstructions');
    expect(source).toContain('dashboardApi.clearPlatformInstructions()');
    expect(source).not.toContain('previousVersions');
  });

  it('exposes real compare, restore, clear, and diff UX', () => {
    const source = `${readSource()}\n${readSectionSource()}`;
    expect(source).toContain('Version History');
    expect(source).toContain('Restore Selected Version');
    expect(source).toContain('Clear Current');
    expect(source).toContain('Saved Version Diff');
    expect(source).toContain('DiffViewer');
    expect(source).toContain('renderPlatformInstructionSnapshot');
    expect(source).toContain('PlatformInstructionSummaryCards');
    expect(source).toContain('Draft controls');
    expect(source).toContain('Selected compare version');
    expect(source).toContain('Draft posture');
  });
});
