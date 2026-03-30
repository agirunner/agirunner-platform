import type {
  DashboardWorkflowDeliverableRecord,
  DashboardWorkflowDeliverableTarget,
  DashboardWorkflowDeliverablesPacket,
  DashboardWorkflowInputPacketFileRecord,
  DashboardWorkflowInputPacketRecord,
  DashboardWorkflowInterventionRecord,
  DashboardWorkflowOperatorBriefRecord,
} from '../../../lib/api.js';

export interface DeliverableTargetAction {
  action_kind: 'inline_reference' | 'external_link';
  href?: string;
}

const DASHBOARD_ORIGIN = 'http://dashboard.local';
const IN_PLACE_TARGET_PATH_PATTERNS = [
  /^\/artifacts\/tasks\/[^/]+\/[^/]+$/,
  /^\/api\/v1\/tasks\/[^/]+\/artifacts\/[^/]+(?:\/preview|\/permalink|\/download)?$/,
  /^\/api\/v1\/workflows\/[^/]+\/input-packets\/[^/]+\/files\/[^/]+\/content$/,
  /^\/api\/v1\/workflows\/[^/]+\/interventions\/[^/]+\/files\/[^/]+\/content$/,
];
const DEPRECATED_WORKSPACE_TARGET_PATH_PATTERNS = [/^\/workflows\/[^/]+\/deliverables\/[^/]+$/];
const DEPRECATED_NAVIGATION_PARAM_NAMES = ['return_to', 'return_source'];
const DOWNLOADABLE_TARGET_KINDS = new Set(['artifact', 'input_packet_file', 'intervention_file']);

export function normalizeDeliverablesPacket(
  packet: Partial<DashboardWorkflowDeliverablesPacket> | null | undefined,
): DashboardWorkflowDeliverablesPacket {
  const inputs = asRecord(packet?.inputs_and_provenance);
  return {
    final_deliverables: normalizeDeliverableRecords(packet?.final_deliverables),
    in_progress_deliverables: normalizeDeliverableRecords(packet?.in_progress_deliverables),
    working_handoffs: normalizeBriefRecords(packet?.working_handoffs),
    inputs_and_provenance: {
      launch_packet: normalizeInputPacket(inputs.launch_packet),
      supplemental_packets: normalizeInputPackets(inputs.supplemental_packets),
      intervention_attachments: normalizeInterventions(inputs.intervention_attachments),
      redrive_packet: normalizeInputPacket(inputs.redrive_packet),
    },
    next_cursor: readOptionalTargetText(packet?.next_cursor),
  };
}

export function sanitizeDeliverableTarget(
  target: Partial<DashboardWorkflowDeliverableTarget> | null | undefined,
): DashboardWorkflowDeliverableTarget {
  return {
    target_kind: readTargetText(target?.target_kind),
    label: readTargetText(target?.label),
    url: readTargetText(target?.url),
    path: readOptionalTargetText(target?.path),
    repo_ref: readOptionalTargetText(target?.repo_ref),
    artifact_id: readOptionalTargetText(target?.artifact_id),
    size_bytes: readOptionalTargetNumber(target?.size_bytes),
  };
}

export function sanitizeDeliverableTargets(value: unknown): DashboardWorkflowDeliverableTarget[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) =>
      sanitizeDeliverableTarget(
        entry && typeof entry === 'object'
          ? (entry as Partial<DashboardWorkflowDeliverableTarget>)
          : null,
      ),
    )
    .filter(hasMeaningfulDeliverableTarget);
}

export function hasMeaningfulDeliverableTarget(
  target: DashboardWorkflowDeliverableTarget,
): boolean {
  return (
    target.target_kind.length > 0 ||
    target.label.length > 0 ||
    target.url.length > 0 ||
    Boolean(target.path) ||
    Boolean(target.repo_ref) ||
    Boolean(target.artifact_id)
  );
}

export function isDownloadableDeliverableTarget(
  target: DashboardWorkflowDeliverableTarget,
): boolean {
  return DOWNLOADABLE_TARGET_KINDS.has(target.target_kind);
}

export function resolveDeliverableTargetHref(
  target: DashboardWorkflowDeliverableTarget,
): string | null {
  const href = normalizeDeliverableTargetUrl(target.url);
  return href.trim().length > 0 ? href : null;
}

export function readDeliverableTargetDisplayLabel(
  target: DashboardWorkflowDeliverableTarget,
  fallbackLabel: string,
): string {
  const label = target.label.trim();
  if (label.length > 0 && !isGenericDeliverableTargetLabel(label)) {
    return label;
  }

  const pathLabel =
    readDeliverableTargetLocationLabel(target.path) ??
    readDeliverableTargetLocationLabel(target.repo_ref);
  if (pathLabel) {
    return pathLabel;
  }

  return label.length > 0 ? label : fallbackLabel;
}

export function formatDeliverableTargetKind(kind: string): string {
  const normalized = kind.trim().toLowerCase();
  if (normalized === 'repo_reference' || normalized === 'repository') {
    return 'Repository';
  }
  if (normalized === 'external_url') {
    return 'External URL';
  }
  if (normalized === 'workflow_document') {
    return 'Workflow document';
  }
  if (normalized === 'host_directory') {
    return 'Host directory';
  }
  if (normalized === 'inline_summary') {
    return 'Inline summary';
  }
  return kind.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

export function isBrowserDeliverableTarget(target: DashboardWorkflowDeliverableTarget): boolean {
  const href = resolveDeliverableTargetHref(target);
  if (href === null || !isInPlaceArtifactPreviewTarget(href)) {
    return false;
  }
  return isDownloadableDeliverableTarget(target) || target.artifact_id !== null;
}

export function resolveDeliverableTargetAction(
  target: DashboardWorkflowDeliverableTarget,
): DeliverableTargetAction {
  const href = resolveDeliverableTargetHref(target) ?? target.url;
  if (!hasActionableDeliverableHref(target, href)) {
    return {
      action_kind: 'inline_reference',
    };
  }
  return {
    action_kind: 'external_link',
    href,
  };
}

export function isInPlaceArtifactPreviewTarget(url: string): boolean {
  const normalizedPath = readNormalizedPath(url);
  return (
    normalizedPath !== null &&
    IN_PLACE_TARGET_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath))
  );
}

function readNormalizedPath(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = new URL(trimmed, DASHBOARD_ORIGIN);
    return parsed.pathname;
  } catch {
    return null;
  }
}

function normalizeDeliverableTargetUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return url;
  }

  try {
    const parsed = new URL(trimmed, DASHBOARD_ORIGIN);
    rewriteDeprecatedArtifactPreviewPath(parsed);
    if (isInPlaceArtifactPreviewTarget(parsed.toString())) {
      stripDeprecatedNavigationParams(parsed);
    }
    return serializeTargetUrl(parsed);
  } catch {
    return url;
  }
}

function hasActionableDeliverableHref(
  target: DashboardWorkflowDeliverableTarget,
  href: string,
): boolean {
  if (href.trim().length === 0) {
    return false;
  }
  if (
    target.target_kind === 'workflow' ||
    target.target_kind === 'work_item' ||
    target.target_kind === 'task' ||
    target.target_kind === 'inline_summary'
  ) {
    return false;
  }

  const normalizedPath = readNormalizedPath(href);
  if (normalizedPath === null) {
    return true;
  }
  return !DEPRECATED_WORKSPACE_TARGET_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath));
}

function rewriteDeprecatedArtifactPreviewPath(parsed: URL): void {
  const match = parsed.pathname.match(
    /^\/artifacts\/tasks\/([^/]+)\/([^/]+)(?:\/(download|permalink|preview))?$/,
  );
  if (!match) {
    return;
  }

  const [, taskId, artifactId, suffix] = match;
  parsed.pathname = `/api/v1/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/${suffix ?? 'preview'}`;
}

function stripDeprecatedNavigationParams(parsed: URL): void {
  for (const paramName of DEPRECATED_NAVIGATION_PARAM_NAMES) {
    parsed.searchParams.delete(paramName);
  }
}

function serializeTargetUrl(parsed: URL): string {
  return parsed.origin === DASHBOARD_ORIGIN
    ? `${parsed.pathname}${parsed.search}${parsed.hash}`
    : parsed.toString();
}

function isGenericDeliverableTargetLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return (
    normalized === 'artifact' ||
    normalized === 'open artifact' ||
    normalized === 'download artifact' ||
    normalized === 'preview artifact' ||
    normalized === 'preview inline' ||
    normalized === 'file' ||
    normalized === 'open file' ||
    normalized === 'download file' ||
    normalized === 'open' ||
    normalized === 'download'
  );
}

function readDeliverableTargetLocationLabel(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed.replace(/^artifact:[^/]+\//, '');
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  return segments.at(-1) ?? trimmed;
}

function normalizeDeliverableRecords(value: unknown): DashboardWorkflowDeliverableRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry, index) => normalizeDeliverableRecord(entry, index));
}

function normalizeDeliverableRecord(
  value: unknown,
  index: number,
): DashboardWorkflowDeliverableRecord {
  const record = asRecord(value);
  const descriptorId = readTargetText(record.descriptor_id) || `deliverable-${index + 1}`;
  return {
    descriptor_id: descriptorId,
    workflow_id: readTargetText(record.workflow_id),
    work_item_id: readOptionalTargetText(record.work_item_id),
    descriptor_kind: readTargetText(record.descriptor_kind),
    delivery_stage: readTargetText(record.delivery_stage) || 'unknown',
    title: readTargetText(record.title) || descriptorId,
    state: readTargetText(record.state) || 'unknown',
    summary_brief: readOptionalTargetText(record.summary_brief),
    preview_capabilities: asRecord(record.preview_capabilities),
    primary_target: sanitizeDeliverableTarget(asPartialTarget(record.primary_target)),
    secondary_targets: sanitizeDeliverableTargets(record.secondary_targets),
    content_preview: normalizeDeliverableContentPreview(record.content_preview),
    source_brief_id: readOptionalTargetText(record.source_brief_id),
    created_at: readTargetText(record.created_at),
    updated_at: readTargetText(record.updated_at),
  };
}

function normalizeDeliverableContentPreview(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? { text: trimmed } : {};
  }
  return asRecord(value);
}

function normalizeBriefRecords(value: unknown): DashboardWorkflowOperatorBriefRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry, index) => normalizeBriefRecord(entry, index));
}

function normalizeBriefRecord(value: unknown, index: number): DashboardWorkflowOperatorBriefRecord {
  const record = asRecord(value);
  return {
    id: readTargetText(record.id) || `brief-${index + 1}`,
    workflow_id: readTargetText(record.workflow_id),
    work_item_id: readOptionalTargetText(record.work_item_id),
    task_id: readOptionalTargetText(record.task_id),
    request_id: readTargetText(record.request_id),
    execution_context_id: readTargetText(record.execution_context_id),
    brief_kind: readTargetText(record.brief_kind),
    brief_scope: readTargetText(record.brief_scope),
    source_kind: readTargetText(record.source_kind),
    source_role_name: readOptionalTargetText(record.source_role_name),
    status_kind: readTargetText(record.status_kind) || 'unknown',
    short_brief: asRecord(record.short_brief),
    detailed_brief_json: asRecord(record.detailed_brief_json),
    linked_target_ids: readStringArray(record.linked_target_ids),
    sequence_number: readNumber(record.sequence_number),
    related_artifact_ids: readStringArray(record.related_artifact_ids),
    related_output_descriptor_ids: readStringArray(record.related_output_descriptor_ids),
    related_intervention_ids: readStringArray(record.related_intervention_ids),
    canonical_workflow_brief_id: readOptionalTargetText(record.canonical_workflow_brief_id),
    created_by_type: readTargetText(record.created_by_type),
    created_by_id: readTargetText(record.created_by_id),
    created_at: readTargetText(record.created_at),
    updated_at: readTargetText(record.updated_at),
  };
}

function normalizeInputPackets(value: unknown): DashboardWorkflowInputPacketRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry, index) => normalizeInputPacket(entry, index))
    .filter((packet): packet is DashboardWorkflowInputPacketRecord => packet !== null);
}

function normalizeInputPacket(
  value: unknown,
  index = 0,
): DashboardWorkflowInputPacketRecord | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return null;
  }
  const packetId = readTargetText(record.id) || `packet-${index + 1}`;
  return {
    id: packetId,
    workflow_id: readTargetText(record.workflow_id),
    work_item_id: readOptionalTargetText(record.work_item_id),
    packet_kind: readTargetText(record.packet_kind) || 'unknown',
    source: readTargetText(record.source),
    summary: readOptionalTargetText(record.summary),
    structured_inputs: asRecord(record.structured_inputs),
    metadata: asRecord(record.metadata),
    created_by_type: readTargetText(record.created_by_type),
    created_by_id: readTargetText(record.created_by_id),
    created_at: readTargetText(record.created_at),
    updated_at: readTargetText(record.updated_at),
    files: normalizePacketFiles(record.files),
  };
}

function normalizePacketFiles(value: unknown): DashboardWorkflowInputPacketFileRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry, index) => normalizePacketFile(entry, index));
}

function normalizePacketFile(
  value: unknown,
  index: number,
): DashboardWorkflowInputPacketFileRecord {
  const record = asRecord(value);
  const fileId = readTargetText(record.id) || `file-${index + 1}`;
  return {
    id: fileId,
    file_name: readTargetText(record.file_name) || fileId,
    description: readOptionalTargetText(record.description),
    content_type: readTargetText(record.content_type) || 'unknown',
    size_bytes: readNumber(record.size_bytes),
    created_at: readTargetText(record.created_at),
    download_url: readTargetText(record.download_url),
  };
}

function normalizeInterventions(value: unknown): DashboardWorkflowInterventionRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry, index) => normalizeIntervention(entry, index));
}

function normalizeIntervention(value: unknown, index: number): DashboardWorkflowInterventionRecord {
  const record = asRecord(value);
  const interventionId = readTargetText(record.id) || `intervention-${index + 1}`;
  return {
    id: interventionId,
    workflow_id: readTargetText(record.workflow_id),
    work_item_id: readOptionalTargetText(record.work_item_id),
    task_id: readOptionalTargetText(record.task_id),
    kind: readTargetText(record.kind) || 'unknown',
    origin: readTargetText(record.origin),
    status: readTargetText(record.status),
    summary: readTargetText(record.summary) || interventionId,
    note: readOptionalTargetText(record.note),
    structured_action: asRecord(record.structured_action),
    metadata: asRecord(record.metadata),
    created_by_type: readTargetText(record.created_by_type),
    created_by_id: readTargetText(record.created_by_id),
    created_at: readTargetText(record.created_at),
    updated_at: readTargetText(record.updated_at),
    files: normalizePacketFiles(record.files),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asPartialTarget(value: unknown): Partial<DashboardWorkflowDeliverableTarget> | null {
  return Object.keys(asRecord(value)).length > 0
    ? (asRecord(value) as Partial<DashboardWorkflowDeliverableTarget>)
    : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readOptionalTargetNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readTargetText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readOptionalTargetText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
