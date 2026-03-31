import { parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import { asRecord } from './shared.js';
import { buildOrchestratorSections, buildSpecialistSections } from './sections.js';
import { hasRepositoryBinding, isRepositoryBacked } from './orchestrator-context.js';
import type { WorkflowInstructionLayerInput } from './types.js';

interface InstructionLayerDocument {
  content: string;
  format: 'markdown';
}

export type { WorkflowContextLike, WorkflowInstructionLayerInput } from './types.js';

export function buildWorkflowInstructionLayer(
  input: WorkflowInstructionLayerInput,
): InstructionLayerDocument | null {
  const workflow = asRecord(input.workflow);
  const playbook = asRecord(workflow.playbook);
  const definitionValue = playbook.definition ?? workflow.playbook_definition;
  if (!definitionValue) {
    return null;
  }

  let definition;
  try {
    definition = parsePlaybookDefinition(definitionValue);
  } catch {
    return null;
  }

  const lifecycle = workflow.lifecycle === 'ongoing' ? 'ongoing' : 'planned';
  const repoBacked = input.isOrchestratorTask
    ? hasRepositoryBinding(input.workspace, workflow, input.taskInput)
    : isRepositoryBacked(input.workspace, workflow, input.taskInput, input.roleConfig);
  const sections = input.isOrchestratorTask
    ? buildOrchestratorSections({
        input,
        workflow,
        definition,
        repoBacked,
      })
    : buildSpecialistSections({
        lifecycle,
        definition,
        repoBacked,
      });

  if (sections.length === 0) {
    return null;
  }

  return {
    format: 'markdown',
    content: sections.join('\n\n'),
  };
}
