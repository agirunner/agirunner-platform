import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(
    resolve(import.meta.dirname, './project-content-browser-presentation.tsx'),
    'utf8',
  );
}

describe('project content browser presentation source', () => {
  it('leads with an operator-focus packet and explicit next-step actions', () => {
    const source = readSource();
    expect(source).toContain('buildOperatorFocusAction');
    expect(source).toContain('Open workflow documents');
    expect(source).toContain('Open task artifacts');
    expect(source).toContain('Open work item flow');
    expect(source).toContain('Review the latest workflow reference first');
    expect(source).toContain('Inspect the selected task output first');
  });

  it('keeps supporting packets for workflow, document, and artifact posture', () => {
    const source = readSource();
    expect(source).toContain('Workflow context');
    expect(source).toContain('Document coverage');
    expect(source).toContain('Artifact coverage');
    expect(source).toContain('Open workflow');
    expect(source).toContain('Open task');
  });
});
