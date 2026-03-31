import { isSecretLikeKey, isSecretLikeValue, truncateInlineValue, asRecord } from './shared.js';

export function buildWorkflowBriefSection(workflow: Record<string, unknown>) {
  const brief = compactWorkflowBriefVariables(asRecord(workflow.variables));
  if (!brief.goal && brief.inputs.length === 0) {
    return '';
  }

  const lines: string[] = [];
  if (brief.goal) {
    lines.push(`Goal: ${brief.goal}`);
  }
  if (brief.inputs.length > 0) {
    lines.push('Launch inputs:');
    lines.push(...brief.inputs.map((entry) => `- ${entry.key}: ${entry.value}`));
  }
  if (brief.omittedCount > 0) {
    lines.push(`- ...and ${brief.omittedCount} more launch inputs`);
  }
  return `## Workflow Brief\n${lines.join('\n')}`;
}

function compactWorkflowBriefVariables(variables: Record<string, unknown>) {
  const preferredGoalKeys = new Set(['goal', 'objective', 'outcome', 'brief', 'deliverable']);
  const visibleEntries = Object.entries(variables)
    .filter(([key, value]) => shouldExposeWorkflowVariable(key, value))
    .map(([key, value]) => ({ key, value: formatWorkflowVariable(value) }))
    .filter((entry): entry is { key: string; value: string } => entry.value !== null);

  const goalEntry = visibleEntries.find((entry) => preferredGoalKeys.has(entry.key));
  const nonGoalEntries = visibleEntries.filter((entry) => !preferredGoalKeys.has(entry.key));
  const maxInputs = 8;

  return {
    goal: goalEntry?.value ?? null,
    inputs: nonGoalEntries.slice(0, maxInputs),
    omittedCount: Math.max(nonGoalEntries.length - maxInputs, 0),
  };
}

function shouldExposeWorkflowVariable(key: string, value: unknown) {
  if (isSecretLikeKey(key) || isSecretLikeValue(value)) {
    return false;
  }
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return typeof value === 'number' || typeof value === 'boolean';
}

function formatWorkflowVariable(value: unknown) {
  if (typeof value === 'string') {
    return truncateInlineValue(value.trim(), 240);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}
