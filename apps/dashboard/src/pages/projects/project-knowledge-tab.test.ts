import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-knowledge-tab.tsx'), 'utf8');
}

describe('project knowledge tab source', () => {
  it('disables save when local validation errors are present, matching settings-tab gating', () => {
    const source = readSource();

    expect(source).toContain('const validationError = readKnowledgeValidationError(knowledgeDrafts);');
    expect(source).toContain('const saveErrorMessage = validationError ?? readMutationError(saveMutation.error);');
    expect(source).toContain('disabled={saveMutation.isPending || Boolean(validationError)}');
    expect(source).toContain('saveErrorMessage={saveErrorMessage}');
  });
});
