import { type SpecialistRoleCapabilities } from '../specialist-capability-service.js';
import { roleConfigOwnsRepositorySurface } from '../tool-tag-service.js';

interface ExecutionBriefRef {
  reason: string;
}

export interface MemoryRef extends ExecutionBriefRef {
  key: string;
  summary: string | null;
}

export interface ArtifactRef extends ExecutionBriefRef {
  artifact_id: string;
  logical_path: string;
  title: string | null;
}

export function summarizeRemoteMcpServers(capabilities: SpecialistRoleCapabilities | null) {
  if (!capabilities) {
    return [];
  }
  return capabilities.remoteMcpServers.map((server) => ({
    name: server.name,
    description: server.description,
    capability_summary: {
      tool_count: readNonNegativeInteger(server.verifiedCapabilitySummary.tool_count),
      resource_count: readNonNegativeInteger(server.verifiedCapabilitySummary.resource_count),
      prompt_count: readNonNegativeInteger(server.verifiedCapabilitySummary.prompt_count),
    },
  }));
}

export function selectLikelyRelevantFiles(predecessorHandoff: Record<string, unknown>) {
  const changes = Array.isArray(predecessorHandoff.changes) ? predecessorHandoff.changes : [];
  return [
    ...new Set(
      changes
        .map((entry) => readString(asRecord(entry).path))
        .filter((entry): entry is string => Boolean(entry)),
    ),
  ].sort();
}

export function selectRelevantMemoryRefs(
  workspace: Record<string, unknown>,
  hints: Array<string | null | undefined>,
): MemoryRef[] {
  const memory = asRecord(workspace.memory);
  const keys = readStringArray(asRecord(workspace.memory_index).keys);
  const tokens = buildHintTokens(hints);
  return keys
    .map((key) => ({
      key,
      score: scoreMatch([key, summarizeValue(memory[key])], tokens),
      summary: summarizeValue(memory[key]),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key))
    .slice(0, 5)
    .map(({ key, summary }) => ({
      key,
      summary,
      reason: `Matched current task context on "${bestReasonToken([key, summary], tokens)}".`,
    }));
}

export function selectRelevantArtifactRefs(
  workspace: Record<string, unknown>,
  hints: Array<string | null | undefined>,
): ArtifactRef[] {
  const artifactIndex = asRecord(workspace.artifact_index);
  const items = Array.isArray(artifactIndex.items) ? artifactIndex.items : [];
  const tokens = buildHintTokens(hints);
  return items
    .map(
      (entry): { artifact_id: string; logical_path: string; title: string | null; score: number } => {
        const record = asRecord(entry);
        const logicalPath = readString(record.logical_path) ?? '';
        return {
          artifact_id: readString(record.artifact_id) ?? '',
          logical_path: logicalPath,
          title: logicalPath || null,
          score: scoreMatch([logicalPath], tokens),
        };
      },
    )
    .filter((entry) => entry.artifact_id.length > 0 && entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.logical_path.localeCompare(right.logical_path),
    )
    .slice(0, 5)
    .map(
      (entry): ArtifactRef => ({
        artifact_id: entry.artifact_id,
        logical_path: entry.logical_path,
        title: entry.title,
        reason: `Matched current task context on "${bestReasonToken([entry.logical_path], tokens)}".`,
      }),
    );
}

export function compactWorkflowBriefVariables(variables: Record<string, unknown>) {
  const preferredGoalKeys = new Set(['goal', 'objective', 'outcome', 'brief', 'deliverable']);
  const visibleEntries = Object.entries(variables)
    .filter(([key, value]) => shouldExposeWorkflowVariable(key, value))
    .map(([key, value]) => ({ key, value: formatWorkflowVariable(value) }))
    .filter((entry): entry is { key: string; value: string } => entry.value !== null);
  const goalEntry = visibleEntries.find((entry) => preferredGoalKeys.has(entry.key));
  const nonGoalEntries = visibleEntries.filter((entry) => !preferredGoalKeys.has(entry.key));
  return {
    goal: goalEntry?.value ?? null,
    launch_inputs: nonGoalEntries.slice(0, 8),
    omitted_input_count: Math.max(nonGoalEntries.length - 8, 0),
  };
}

export function readNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

export function readGateField(workItem: Record<string, unknown>, key: string) {
  const direct = readString(workItem[key]);
  if (direct) {
    return direct;
  }
  const metadata = asRecord(workItem.metadata);
  const stageGate = asRecord(metadata.stage_gate);
  return readString(metadata[key]) ?? readString(stageGate[key]);
}

export function buildHintTokens(hints: Array<string | null | undefined>) {
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'with',
    'that',
    'this',
    'from',
    'into',
    'before',
    'after',
    'should',
    'current',
    'task',
    'work',
    'note',
    'notes',
    'docs',
    'doc',
    'src',
  ]);
  return [
    ...new Set(
      hints
        .flatMap((value) =>
          String(value ?? '')
            .toLowerCase()
            .split(/[^a-z0-9]+/),
        )
        .filter((token) => token.length >= 4 && !stopWords.has(token)),
    ),
  ];
}

export function scoreMatch(values: Array<string | null>, tokens: string[]) {
  const haystack = values.filter(Boolean).join(' ').toLowerCase();
  return tokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0);
}

export function bestReasonToken(values: Array<string | null>, tokens: string[]) {
  const haystack = values.filter(Boolean).join(' ').toLowerCase();
  return tokens.find((token) => haystack.includes(token)) ?? 'task';
}

export function shouldExposeWorkflowVariable(key: string, value: unknown) {
  if (isSecretLikeKey(key) || isSecretLikeValue(value)) return false;
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return typeof value === 'number' || typeof value === 'boolean';
}

export function isRepositoryBacked(
  workspace: Record<string, unknown>,
  workflow: Record<string, unknown>,
  taskInput: Record<string, unknown>,
  roleConfig: Record<string, unknown>,
) {
  if (!roleConfigOwnsRepositorySurface(roleConfig)) {
    return false;
  }
  const repository = asRecord(taskInput.repository);
  return Boolean(
    readString(workspace.repository_url) ??
      readString(asRecord(workflow.variables).repository_url) ??
      readString(repository.repository_url),
  );
}

export function formatWorkflowVariable(value: unknown) {
  if (typeof value === 'string') return truncateInlineValue(value.trim(), 240);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function normalizeStrings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

export function summarizeValue(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) return truncateInlineValue(value.trim(), 160);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function isSecretLikeKey(key: string) {
  return /(secret|token|password|api[_-]?key|credential|authorization|private[_-]?key|known_hosts|webhook_url)/i.test(
    key,
  );
}

export function isSecretLikeValue(value: unknown) {
  if (typeof value !== 'string') return false;
  return /(?:^enc:v\d+:|^secret:|^redacted:\/\/|^Bearer\s+\S+|^sk-[A-Za-z0-9_-]+|^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$)/i.test(
    value.trim(),
  );
}

export function truncateInlineValue(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

export function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
