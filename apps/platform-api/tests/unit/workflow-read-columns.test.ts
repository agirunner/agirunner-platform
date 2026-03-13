import { describe, expect, it } from 'vitest';

import { buildWorkflowReadColumns } from '../../src/services/workflow-read-columns.js';

describe('buildWorkflowReadColumns', () => {
  it('contains only v2 workflow columns and no template or phase compatibility fields', () => {
    const unqualified = buildWorkflowReadColumns();
    const withoutCurrentStage = buildWorkflowReadColumns(undefined, { includeCurrentStage: false });
    const qualified = buildWorkflowReadColumns('w');
    const qualifiedWithoutCurrentStage = buildWorkflowReadColumns('w', { includeCurrentStage: false });

    expect(unqualified).toContain('playbook_id');
    expect(unqualified).toContain('current_stage');
    expect(withoutCurrentStage).not.toContain('current_stage');
    expect(unqualified).not.toContain('*');
    expect(unqualified).not.toContain('template_id');
    expect(unqualified).not.toContain('template_name');
    expect(unqualified).not.toContain('template_version');
    expect(unqualified).not.toContain('current_phase');
    expect(unqualified).not.toContain('workflow_phase');
    expect(unqualified).not.toContain('phases');
    expect(unqualified).not.toContain('phase_summary');
    expect(qualified).toContain('w.playbook_id');
    expect(qualified).toContain('w.current_stage');
    expect(qualifiedWithoutCurrentStage).not.toContain('w.current_stage');
    expect(qualified).not.toContain('w.template_id');
    expect(qualified).not.toContain('w.workflow_phase');
  });
});
