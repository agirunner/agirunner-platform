import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('WorkflowRedriveDialog source', () => {
  it('keeps the operator redrive modal reduced to a brief plus optional files', () => {
    const source = readFileSync(new URL('./workflow-redrive-dialog.tsx', import.meta.url), 'utf8');

    expect(source).toContain('Redrive brief');
    expect(source).toContain('Redrive files');
    expect(source).not.toContain('Redrive summary');
    expect(source).not.toContain('Steering instruction');
    expect(source).not.toContain('Parameter overrides');
    expect(source).not.toContain('Structured redrive inputs');
    expect(source).not.toContain('ChainStructuredEntryEditor');
    expect(source).not.toContain('Add parameter override');
    expect(source).not.toContain('workflow-scoped files');
  });

  it('validates the required brief without sending a low-level name override', () => {
    const source = readFileSync(new URL('./workflow-redrive-dialog.tsx', import.meta.url), 'utf8');

    expect(source).toContain('if (!brief.trim())');
    expect(source).not.toContain('name:');
    expect(source).not.toContain('!name.trim()');
  });

  it('clears stale redrive errors when the operator edits the brief or files after a failed submit', () => {
    const source = readFileSync(new URL('./workflow-redrive-dialog.tsx', import.meta.url), 'utf8');

    expect(source).toContain('function clearFormFeedback()');
    expect(source).toContain('clearFormFeedback();');
    expect(source).toContain('setErrorMessage(null);');
  });

  it('reuses a flatter shared file input without dashed dropzone chrome', () => {
    const source = readFileSync(new URL('../workflow-file-input.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('border-dashed');
    expect(source).not.toContain('Upload');
    expect(source).toContain('aria-label={`Remove ${file.name}`}');
  });
});
