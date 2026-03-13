import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-scheduled-trigger-form.tsx'), 'utf8');
}

describe('project scheduled trigger form source', () => {
  it('surfaces save-readiness guidance and inline validation instead of silently blocking save', () => {
    const source = readSource();
    expect(source).toContain('validateScheduledTriggerForm');
    expect(source).toContain('Save readiness');
    expect(source).toContain('Resolve the items below before saving this trigger.');
    expect(source).toContain('Run target and timing');
    expect(source).toContain('Generated work item');
    expect(source).toContain(
      'Save once the target run, cadence, and generated work item copy all look correct.',
    );
    expect(source).toContain('error={validation.fieldErrors.workflowId}');
    expect(source).toContain('error={validation.fieldErrors.cadenceMinutes}');
    expect(source).toContain('error={validation.fieldErrors.title}');
  });

  it('keeps structured select controls for run, stage, column, and owner role selection', () => {
    const source = readSource();
    expect(source).toContain('label="Target run"');
    expect(source).toContain('label="Stage"');
    expect(source).toContain('label="Target board column"');
    expect(source).toContain('label="Owner role"');
    expect(source).not.toContain('<select');
  });
});
