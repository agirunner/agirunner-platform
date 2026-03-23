import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './task-detail-page.tsx',
    './task-detail-artifacts-panel.tsx',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('secondary task detail page source', () => {
  it('uses current V2 step-state handling and work-item-first operator flow', () => {
    const source = readSource();
    expect(source).toContain('normalizeTaskStatus');
    expect(source).toContain('usesWorkItemOperatorFlow');
    expect(source).toContain('in_progress');
    expect(source).toContain('escalated');
    expect(source).toContain('Open Work Item Flow');
  });

  it('uses current operator wording for the step action panel', () => {
    const source = readSource();
    expect(source).toContain('Approve Step');
    expect(source).toContain('Approve Output');
    expect(source).toContain('Retry Step');
    expect(source).toContain('Escalated specialist step');
  });

  it('renders the artifacts tab as a review packet instead of a raw file list', () => {
    const source = readSource();
    expect(source).toContain('TaskDetailArtifactsPanel');
    expect(source).toContain('Artifact evidence packet');
    expect(source).toContain('Open preview workspace');
    expect(source).toContain('Download-first files');
  });
});
