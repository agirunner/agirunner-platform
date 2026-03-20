import type { RoleDefinition } from './role-definitions-page.support.js';

const PROMPT_PREVIEW_LIMIT = 120;

export function buildRoleDetailSummary(role: RoleDefinition, modelLabel: string) {
  return {
    model: { title: 'Model', label: modelLabel || 'System default' },
    tools: {
      title: 'Tools',
      label: `${role.allowed_tools?.length ?? 0} tool${role.allowed_tools?.length === 1 ? '' : 's'} enabled`,
    },
    capabilities: {
      title: 'Capabilities',
      label: role.capabilities?.length ? role.capabilities.join(', ') : 'No explicit capabilities',
    },
    executionContainer: {
      title: 'Execution container',
      label: summarizeExecutionContainer(role),
    },
    governance: {
      title: 'Verification and escalation',
      label: summarizeGovernance(role),
    },
    metadata: {
      title: 'Metadata',
      label: summarizeMetadata(role),
    },
    promptPreview: truncatePromptPreview(role.system_prompt ?? ''),
  };
}

function summarizeExecutionContainer(role: RoleDefinition): string {
  const config = role.execution_container_config;
  if (!config) {
    return 'Inherit runtime defaults';
  }

  const parts = [
    config.image?.trim(),
    config.cpu?.trim() ? `CPU ${config.cpu.trim()}` : null,
    config.memory?.trim() ? `Memory ${config.memory.trim()}` : null,
    config.pull_policy?.trim() ? `Pull ${config.pull_policy.trim()}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' | ') : 'Inherit runtime defaults';
}

function summarizeGovernance(role: RoleDefinition): string {
  const parts = [
    role.verification_strategy?.trim() || null,
    role.escalation_target?.trim()
      ? `Escalates to ${role.escalation_target.trim()}${role.max_escalation_depth ? ` (max ${role.max_escalation_depth})` : ''}`
      : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' | ') : 'No explicit verification or escalation override';
}

function summarizeMetadata(role: RoleDefinition): string {
  const parts = [
    typeof role.version === 'number' ? `Version ${role.version}` : null,
    role.updated_at?.trim() ? `Updated ${role.updated_at.trim()}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' | ') : 'No version metadata';
}

function truncatePromptPreview(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'No system prompt configured.';
  }
  if (trimmed.length <= PROMPT_PREVIEW_LIMIT) {
    return trimmed;
  }
  return `${trimmed.slice(0, PROMPT_PREVIEW_LIMIT - 1).trimEnd()}…`;
}
