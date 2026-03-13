import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readTypesSource() {
  return readFileSync(resolve(import.meta.dirname, './types.ts'), 'utf8');
}

function readInterfaceBlock(source: string, interfaceName: string) {
  const start = source.indexOf(`export interface ${interfaceName} {`);
  if (start < 0) {
    throw new Error(`Interface ${interfaceName} not found`);
  }
  const end = source.indexOf('\n}\n', start);
  if (end < 0) {
    throw new Error(`Interface ${interfaceName} end not found`);
  }
  return source.slice(start, end);
}

describe('sdk shared state contracts', () => {
  it('keeps workflow-facing DTOs on the canonical workflow state union', () => {
    const source = readTypesSource();
    const workflowBlock = readInterfaceBlock(source, 'Workflow');
    const relationBlock = readInterfaceBlock(source, 'WorkflowRelationRef');
    const timelineBlock = readInterfaceBlock(source, 'ProjectTimelineEntry');

    expect(source).toContain('export type WorkflowState =');
    expect(workflowBlock).toContain('state: WorkflowState;');
    expect(relationBlock).toContain('state: WorkflowState;');
    expect(timelineBlock).toContain('state: WorkflowState;');
  });

  it('keeps approval task DTOs on the canonical task state union', () => {
    const source = readTypesSource();
    const approvalTaskBlock = readInterfaceBlock(source, 'ApprovalTaskRecord');

    expect(approvalTaskBlock).toContain('state: TaskState;');
  });
});
