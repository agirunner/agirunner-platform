import { normalizeInstructionDocument } from '../platform-config/instruction-policy.js';
import {
  buildRemoteMcpAvailabilitySection,
  buildSpecialistSkillInstructionSection,
  type SpecialistRoleCapabilities,
} from '../specialist/specialist-capability-service.js';
import { buildWorkflowInstructionLayer } from '../workflow-instruction-layer/workflow-instruction-layer.js';
import { TASK_CONTEXT_LOG_VERSION } from './task-context-constants.js';
import {
  asOptionalNumber,
  asOptionalString,
  asRecord,
  hashCanonicalJson,
  readAgentProfileInstructions,
} from './task-context-utils.js';

export function buildInstructionLayers(params: {
  platformInstructions?: Record<string, unknown>;
  orchestratorPrompt?: string;
  isOrchestratorTask: boolean;
  workspaceInstructions?: Record<string, unknown>;
  roleConfig: Record<string, unknown>;
  specialistCapabilities?: SpecialistRoleCapabilities;
  taskInput: Record<string, unknown>;
  taskId: string;
  workspaceId?: string;
  workspaceSpecVersion?: number;
  role?: string;
  suppressLayers: string[];
  workflowContext?: Record<string, unknown> | null;
  workspace?: Record<string, unknown>;
  workItem?: Record<string, unknown> | null;
  predecessorHandoff?: Record<string, unknown> | null;
  orchestratorContext?: Record<string, unknown>;
}) {
  const suppressed = new Set(params.suppressLayers);
  const layers: Record<string, unknown> = {};

  const platformDocument = normalizeInstructionDocument(
    params.platformInstructions
      ? {
          content: params.platformInstructions.content,
          format: params.platformInstructions.format,
        }
      : undefined,
    'platform instructions',
  );
  if (platformDocument && !suppressed.has('platform')) {
    layers.platform = {
      ...platformDocument,
      source: {
        tenant_id: params.platformInstructions?.tenant_id ?? null,
        version: params.platformInstructions?.version ?? 0,
      },
    };
  }

  if (params.isOrchestratorTask && params.orchestratorPrompt && !suppressed.has('orchestrator')) {
    const orchestratorDocument = normalizeInstructionDocument(
      params.orchestratorPrompt,
      'orchestrator prompt',
    );
    if (orchestratorDocument) {
      layers.orchestrator = {
        ...orchestratorDocument,
        source: { type: 'orchestrator_config' },
      };
    }
  }

  const workspaceDocument = normalizeInstructionDocument(
    params.workspaceInstructions?.instructions,
    'workspace instructions',
  );
  if (workspaceDocument && !suppressed.has('workspace')) {
    layers.workspace = {
      ...workspaceDocument,
      source: {
        workspace_id: params.workspaceId ?? null,
        version: params.workspaceSpecVersion ?? 0,
      },
    };
  }

  if (!params.isOrchestratorTask) {
    const roleDocument = normalizeInstructionDocument(
      buildRoleInstructionContent(params.roleConfig, params.specialistCapabilities),
      'role instructions',
    );
    if (roleDocument && !suppressed.has('role')) {
      layers.role = {
        ...roleDocument,
        source: {
          role: params.role ?? null,
          task_id: params.taskId,
        },
      };
    }
  }

  const workflowDocument = buildWorkflowInstructionLayer({
    isOrchestratorTask: params.isOrchestratorTask,
    role: params.role,
    roleConfig: params.roleConfig,
    workflow: params.workflowContext ?? null,
    workspace: params.workspace ?? null,
    taskInput: params.taskInput,
    workItem: params.workItem ?? null,
    predecessorHandoff: params.predecessorHandoff ?? null,
    orchestratorContext: params.orchestratorContext ?? null,
  });
  if (workflowDocument && !suppressed.has('workflow')) {
    layers.workflow = {
      ...workflowDocument,
      source: {
        workflow_id: params.workflowContext?.id ?? null,
      },
    };
  }

  const taskDocument = normalizeInstructionDocument(
    params.taskInput.instructions,
    'task instructions',
  );
  if (taskDocument && !suppressed.has('task')) {
    layers.task = {
      ...taskDocument,
      source: {
        task_id: params.taskId,
      },
    };
  }

  return layers;
}

export function flattenInstructionLayers(layers: Record<string, unknown>): string {
  const layerOrder =
    'orchestrator' in layers
      ? ['platform', 'orchestrator', 'workflow', 'workspace']
      : ['platform', 'role', 'workflow', 'workspace'];
  const sections: string[] = [];
  for (const name of layerOrder) {
    const layer = layers[name] as { content?: string } | undefined;
    if (!layer?.content) continue;
    sections.push(`${LAYER_HEADERS[name]}\n${layer.content}`);
  }
  return sections.join('\n\n');
}

export function summarizeTaskContextAttachments(
  context: Record<string, unknown>,
): Record<string, unknown> {
  const agent = asRecord(context.agent);
  const task = asRecord(context.task);
  const workspace = asRecord(context.workspace);
  const instructionLayers = asRecord(context.instruction_layers);
  const agentProfile = asRecord(asRecord(agent.metadata).profile);
  const predecessorHandoff = asRecord(task.predecessor_handoff);
  const predecessorResolution = asRecord(task.predecessor_handoff_resolution);
  const contextAnchor = asRecord(task.context_anchor);
  const recentHandoffs = Array.isArray(task.recent_handoffs)
    ? (task.recent_handoffs as unknown[])
    : [];
  const workItem = asRecord(task.work_item);
  const memoryIndex = asRecord(workspace.memory_index);
  const artifactIndex = asRecord(workspace.artifact_index);
  const memoryKeys = Array.isArray(memoryIndex.keys) ? (memoryIndex.keys as unknown[]) : [];
  const artifactItems = Array.isArray(artifactIndex.items)
    ? (artifactIndex.items as unknown[])
    : [];
  const documents = Array.isArray(context.documents) ? (context.documents as unknown[]) : [];
  const orchestrator = asRecord(context.orchestrator);
  const executionBrief = asRecord(context.execution_brief);
  const lastActivationCheckpoint = asRecord(orchestrator.last_activation_checkpoint);
  const flattenedSystemPrompt = flattenInstructionLayers(instructionLayers);
  const agentProfileInstructions = readAgentProfileInstructions(agent.metadata);

  return {
    agent_profile_present: Object.keys(agentProfile).length > 0,
    agent_profile_hash:
      Object.keys(agentProfile).length > 0 ? hashCanonicalJson(agentProfile) : null,
    agent_profile_instructions_present: agentProfileInstructions.length > 0,
    agent_profile_instructions_hash:
      agentProfileInstructions.length > 0 ? hashCanonicalJson(agentProfileInstructions) : null,
    predecessor_handoff_present: Object.keys(predecessorHandoff).length > 0,
    predecessor_handoff_resolution_present: Object.keys(predecessorResolution).length > 0,
    predecessor_handoff_source: asOptionalString(predecessorResolution.source) ?? null,
    context_anchor_source: asOptionalString(contextAnchor.source) ?? null,
    context_anchor_event_type: asOptionalString(contextAnchor.event_type) ?? null,
    context_anchor_work_item_id: asOptionalString(contextAnchor.work_item_id) ?? null,
    context_anchor_stage_name: asOptionalString(contextAnchor.stage_name) ?? null,
    context_anchor_triggering_task_id: asOptionalString(contextAnchor.triggering_task_id) ?? null,
    recent_handoff_count: recentHandoffs.length,
    work_item_continuity_present: Object.keys(workItem).length > 0,
    orchestrator_checkpoint_present: Object.keys(lastActivationCheckpoint).length > 0,
    workspace_memory_index_present: Object.keys(memoryIndex).length > 0,
    workspace_memory_index_count: memoryKeys.length,
    workspace_memory_more_available: memoryIndex.more_available === true,
    workspace_artifact_index_present: Object.keys(artifactIndex).length > 0,
    workspace_artifact_index_count: artifactItems.length,
    workspace_artifact_more_available: artifactIndex.more_available === true,
    execution_brief_present: Object.keys(executionBrief).length > 0,
    execution_brief_hash:
      Object.keys(executionBrief).length > 0 ? hashCanonicalJson(executionBrief) : null,
    document_count: documents.length,
    instruction_context_version: TASK_CONTEXT_LOG_VERSION,
    instruction_layers_hash: hashCanonicalJson(instructionLayers),
    flattened_system_prompt_hash: hashCanonicalJson(flattenedSystemPrompt),
    instruction_layer_hashes: buildInstructionLayerHashes(instructionLayers),
    instruction_layer_versions: buildInstructionLayerVersions(instructionLayers),
  };
}

function buildRoleInstructionContent(
  roleConfig: Record<string, unknown>,
  specialistCapabilities?: SpecialistRoleCapabilities,
): string | undefined {
  const instructions =
    asOptionalString(roleConfig.system_prompt) ?? asOptionalString(roleConfig.instructions) ?? null;
  const description =
    asOptionalString(roleConfig.description) ?? specialistCapabilities?.description ?? null;
  const sections: string[] = [];
  if (description) {
    sections.push(`Role description: ${description}`);
  }
  if (instructions) {
    sections.push(instructions);
  }
  const skillSection = buildSpecialistSkillInstructionSection(specialistCapabilities?.skills ?? []);
  if (skillSection) {
    sections.push(skillSection);
  }
  const remoteMcpSection = buildRemoteMcpAvailabilitySection(
    specialistCapabilities?.remoteMcpServers ?? [],
  );
  if (remoteMcpSection) {
    sections.push(remoteMcpSection);
  }
  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

function buildInstructionLayerHashes(layers: Record<string, unknown>): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const name of ['platform', 'orchestrator', 'workflow', 'workspace', 'role', 'task']) {
    const layer = asRecord(layers[name]);
    if (Object.keys(layer).length === 0) {
      continue;
    }
    hashes[name] = hashCanonicalJson(layer);
  }
  return hashes;
}

function buildInstructionLayerVersions(layers: Record<string, unknown>): Record<string, unknown> {
  const versions: Record<string, unknown> = {};
  for (const name of ['platform', 'orchestrator', 'workflow', 'workspace', 'role', 'task']) {
    const layer = asRecord(layers[name]);
    if (Object.keys(layer).length === 0) {
      continue;
    }
    const source = asRecord(layer.source);
    versions[name] = readLayerVersion(name, source);
  }
  return versions;
}

function readLayerVersion(layerName: string, source: Record<string, unknown>): unknown {
  if (layerName === 'platform' || layerName === 'workspace') {
    return asOptionalNumber(source.version) ?? null;
  }
  if (layerName === 'orchestrator') {
    return asOptionalString(source.type) ?? null;
  }
  if (layerName === 'workflow') {
    return asOptionalString(source.workflow_id) ?? null;
  }
  if (layerName === 'role') {
    return asOptionalString(source.role) ?? null;
  }
  if (layerName === 'task') {
    return asOptionalString(source.task_id) ?? null;
  }
  return null;
}

const LAYER_HEADERS: Record<string, string> = {
  platform: '=== Platform Instructions ===',
  orchestrator: '=== Orchestrator Prompt ===',
  workflow: '=== Workflow Context ===',
  workspace: '=== Workspace Instructions ===',
  role: '=== Role Instructions ===',
};
