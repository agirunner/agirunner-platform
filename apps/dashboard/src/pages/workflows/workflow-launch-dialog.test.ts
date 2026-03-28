import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(fileName: string) {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

describe('workflow launch dialog source', () => {
  it('keeps create enabled while surfacing field validation after submit is attempted', () => {
    const dialogSource = readSource('./workflow-launch-dialog.tsx');
    const parameterSource = readSource('../../components/chain-workflow/chain-workflow-parameters.tsx');

    expect(dialogSource).toContain('const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);');
    expect(dialogSource).toContain('setHasAttemptedSubmit(true);');
    expect(dialogSource).toContain('const playbookError = hasAttemptedSubmit ? validation.fieldErrors.playbook : undefined;');
    expect(dialogSource).not.toContain('validation.blockingIssues[0]');
    expect(parameterSource).toContain('error?: string;');
    expect(parameterSource).toContain('aria-invalid={Boolean(props.error)}');
  });
});
