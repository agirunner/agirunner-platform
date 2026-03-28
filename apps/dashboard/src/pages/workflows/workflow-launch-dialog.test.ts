import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('WorkflowLaunchDialog source', () => {
  it('removes budget guardrail fields from the workflow launch modal', () => {
    const source = readFileSync(new URL('./workflow-launch-dialog.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('Token budget');
    expect(source).not.toContain('Cost cap (USD)');
    expect(source).not.toContain('Max duration (minutes)');
  });

  it('keeps operator-authored strings in compact textareas and flattens launch inputs', () => {
    const source = readFileSync(new URL('./workflow-launch-dialog.tsx', import.meta.url), 'utf8');

    expect(source.match(/rows=\{2\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(source).not.toContain('ChainParameterField');
    expect(source).not.toContain('Launch input groups');
    expect(source).not.toContain('rounded-full border border-border');
  });

  it('persists launch files through workflow creation instead of a second packet request', () => {
    const source = readFileSync(new URL('./workflow-launch-dialog.tsx', import.meta.url), 'utf8');

    expect(source).toContain('initial_input_packet');
    expect(source).not.toContain('createWorkflowInputPacket(workflow.id');
  });
});
