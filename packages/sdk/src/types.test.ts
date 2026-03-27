import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readTypesSource() {
  return readFileSync(resolve(import.meta.dirname, './types.ts'), 'utf8');
}

function readInterfaceBlock(source: string, interfaceName: string) {
  const start =
    source.indexOf(`export interface ${interfaceName} {`) >= 0
      ? source.indexOf(`export interface ${interfaceName} {`)
      : source.indexOf(`interface ${interfaceName} {`);
  if (start < 0) {
    throw new Error(`Interface ${interfaceName} not found`);
  }
  const end = source.indexOf('\n}\n', start);
  if (end < 0) {
    throw new Error(`Interface ${interfaceName} end not found`);
  }
  return source.slice(start, end);
}

function readExportBlock(source: string, name: string) {
  const interfaceStart = source.indexOf(`export interface ${name} {`);
  if (interfaceStart >= 0) {
    const end = source.indexOf('\n}\n', interfaceStart);
    if (end < 0) {
      throw new Error(`Interface ${name} end not found`);
    }
    return source.slice(interfaceStart, end);
  }

  const typeStart = source.indexOf(`export type ${name} =`);
  if (typeStart < 0) {
    throw new Error(`Export ${name} not found`);
  }
  let depth = 0;
  let seenEquals = false;
  for (let index = typeStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '=') {
      seenEquals = true;
    }
    if (!seenEquals) {
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (char === ';' && depth === 0) {
      return source.slice(typeStart, index);
    }
  }
  throw new Error(`Type ${name} end not found`);
}

describe('sdk shared state contracts', () => {
  it('keeps workflow-facing DTOs on the canonical workflow state union', () => {
    const source = readTypesSource();
    const workflowBaseBlock = readInterfaceBlock(source, 'WorkflowBase');
    const workflowBlock = readExportBlock(source, 'Workflow');
    const relationBlock = readInterfaceBlock(source, 'WorkflowRelationRef');
    const timelineBlock = readInterfaceBlock(source, 'WorkspaceTimelineEntry');

    expect(source).toContain('export type WorkflowState =');
    expect(workflowBaseBlock).toContain('state: WorkflowState;');
    expect(workflowBlock).toContain("lifecycle: 'ongoing';");
    expect(workflowBlock).toContain('current_stage?: never;');
    expect(workflowBlock).toContain("lifecycle?: 'planned' | null;");
    expect(workflowBlock).toContain('current_stage?: string | null;');
    expect(relationBlock).toContain('state: WorkflowState;');
    expect(timelineBlock).toContain('state: WorkflowState;');
  });

  it('keeps approval task DTOs on the canonical task state union', () => {
    const source = readTypesSource();
    const approvalTaskBlock = readInterfaceBlock(source, 'ApprovalTaskRecord');

    expect(approvalTaskBlock).toContain('state: TaskState;');
  });

  it('keeps worker and agent dto surfaces free of legacy capability arrays', () => {
    const source = readTypesSource();
    const agentBlock = readInterfaceBlock(source, 'Agent');
    const workerBlock = readInterfaceBlock(source, 'Worker');

    expect(agentBlock).not.toContain('capabilities:');
    expect(workerBlock).not.toContain('capabilities:');
  });
});
