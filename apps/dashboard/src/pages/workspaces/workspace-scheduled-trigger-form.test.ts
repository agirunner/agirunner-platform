import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workspace-scheduled-trigger-form.tsx'), 'utf8');
}

describe('workspace scheduled trigger form source', () => {
  it('surfaces save-readiness guidance and inline validation instead of silently blocking save', () => {
    const source = readSource();
    expect(source).toContain('validateScheduledTriggerForm');
    expect(source).toContain('Finish these items before saving:');
    expect(source).toContain('Workflow target and timing');
    expect(source).toContain('Work item template');
    expect(source).toContain(
      'Save once the target workflow, schedule, and work-item template all look correct.',
    );
    expect(source).toContain('error={validation.fieldErrors.workflowId}');
    expect(source).toContain('error={validation.fieldErrors.title}');
    expect(source).not.toContain('Save readiness');
    expect(source).not.toContain('label="Notes"');
  });

  it('keeps structured controls for workflow, schedule type, and routing without exposing source or owner role', () => {
    const source = readSource();
    expect(source).toContain('label="Target workflow"');
    expect(source).toContain('label="Schedule type"');
    expect(source).toContain('label="Every (minutes)"');
    expect(source).toContain('label="Time of day"');
    expect(source).toContain('label="Timezone"');
    expect(source).toContain('Routing overrides');
    expect(source).toContain('Open routing overrides');
    expect(source).toContain('Hide routing overrides');
    expect(source).toContain('label="Stage"');
    expect(source).toContain('label="Target board column"');
    expect(source).toContain('label="Priority"');
    expect(source).not.toContain('label="Source"');
    expect(source).not.toContain('label="Owner role"');
    expect(source).not.toContain('label="First run (optional)"');
    expect(source).not.toContain('<select');
  });
});
