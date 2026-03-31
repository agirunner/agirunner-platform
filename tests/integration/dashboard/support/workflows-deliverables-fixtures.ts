import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

import {
  DEFAULT_TENANT_ID,
  PLATFORM_API_CONTAINER_NAME,
  POSTGRES_CONTAINER_NAME,
  POSTGRES_DB,
  POSTGRES_USER,
} from './platform-env.js';
import {
  type SeededWorkflowsScenario,
  seedWorkflowsScenario,
} from './workflows-fixtures.js';

interface SeededArtifactInput {
  workflowId: string;
  workspaceId: string;
  taskId: string;
  fileName: string;
  logicalPath: string;
  content: string;
  contentType: string;
}

export async function seedWorkflowDeliverablesScenario(): Promise<SeededWorkflowsScenario> {
  const scenario = await seedWorkflowsScenario();
  const workflowId = scenario.needsActionWorkflow.id;
  const workItemId = scenario.needsActionWorkItem.id;
  const taskId = scenario.needsActionEscalationTask.id;

  const primaryArtifact = createWorkflowArtifact({
    workflowId,
    workspaceId: scenario.workspace.id,
    taskId,
    fileName: 'architecture-brief.md',
    logicalPath: 'artifact:deliverables/architecture-brief.md',
    content: '# Architecture brief\n\nThis packet captures the release architecture.',
    contentType: 'text/markdown',
  });
  const secondaryArtifact = createWorkflowArtifact({
    workflowId,
    workspaceId: scenario.workspace.id,
    taskId,
    fileName: 'release-checklist.json',
    logicalPath: 'artifact:deliverables/release-checklist.json',
    content: JSON.stringify({ ready: true, owner: 'release' }, null, 2),
    contentType: 'application/json',
  });

  insertWorkflowOutputDescriptor({
    id: randomUUID(),
    workflowId,
    workItemId,
    descriptorKind: 'artifact_bundle',
    deliveryStage: 'final',
    title: 'Architecture bundle',
    state: 'final',
    summaryBrief: 'Two stored artifacts are available for operator review and download.',
    previewCapabilities: {
      can_inline_preview: true,
      can_download: true,
    },
    primaryTarget: {
      target_kind: 'artifact',
      label: 'architecture-brief.md',
      url: `/api/v1/tasks/${taskId}/artifacts/${primaryArtifact.id}/preview`,
      path: primaryArtifact.logicalPath,
      artifact_id: primaryArtifact.id,
      size_bytes: primaryArtifact.sizeBytes,
    },
    secondaryTargets: [
      {
        target_kind: 'artifact',
        label: 'release-checklist.json',
        url: `/api/v1/tasks/${taskId}/artifacts/${secondaryArtifact.id}/preview`,
        path: secondaryArtifact.logicalPath,
        artifact_id: secondaryArtifact.id,
        size_bytes: secondaryArtifact.sizeBytes,
      },
    ],
    contentPreview: {
      summary: 'Architecture packet with markdown brief and JSON checklist.',
    },
    createdAtOffsetHours: 0,
  });

  insertWorkflowOutputDescriptor({
    id: randomUUID(),
    workflowId,
    workItemId: null,
    descriptorKind: 'repository_output',
    deliveryStage: 'final',
    title: 'Release repository output',
    state: 'final',
    summaryBrief: 'Repository-backed implementation output ready for review.',
    previewCapabilities: {
      can_inline_preview: false,
      can_download: false,
    },
    primaryTarget: {
      target_kind: 'repository',
      label: 'Release repository output',
      url: 'https://github.com/example/release-audit/pull/42',
      repo_ref: 'release/main',
    },
    secondaryTargets: [],
    contentPreview: {
      summary: 'release/main\n\nhttps://github.com/example/release-audit/pull/42',
    },
    createdAtOffsetHours: -1,
  });

  insertWorkflowOutputDescriptor({
    id: randomUUID(),
    workflowId,
    workItemId,
    descriptorKind: 'workflow_document',
    deliveryStage: 'final',
    title: 'Signed workflow packet',
    state: 'final',
    summaryBrief: 'Canonical workflow packet recorded in the document registry.',
    previewCapabilities: {
      can_inline_preview: false,
      can_download: false,
    },
    primaryTarget: {
      target_kind: 'workflow_document',
      label: 'Signed workflow packet',
      url: 'https://docs.example.com/workflows/release-packet',
      path: 'release-packet',
    },
    secondaryTargets: [],
    contentPreview: {
      summary: 'Signed release packet reference.',
    },
    createdAtOffsetHours: -2,
  });

  insertWorkflowOutputDescriptor({
    id: randomUUID(),
    workflowId,
    workItemId: null,
    descriptorKind: 'external_reference',
    deliveryStage: 'in_progress',
    title: 'Stakeholder share link',
    state: 'approved',
    summaryBrief: 'Temporary stakeholder share link while the packet is in review.',
    previewCapabilities: {
      can_inline_preview: false,
      can_download: false,
    },
    primaryTarget: {
      target_kind: 'external_url',
      label: 'Stakeholder share link',
      url: 'https://example.com/share/release-audit',
    },
    secondaryTargets: [],
    contentPreview: {
      summary: 'Share URL for current operator review.',
    },
    createdAtOffsetHours: -3,
  });

  insertWorkflowOutputDescriptor({
    id: randomUUID(),
    workflowId,
    workItemId,
    descriptorKind: 'host_directory_export',
    deliveryStage: 'in_progress',
    title: 'Export directory',
    state: 'approved',
    summaryBrief: 'Structured host directory output for downstream export tools.',
    previewCapabilities: {
      can_inline_preview: false,
      can_download: false,
    },
    primaryTarget: {
      target_kind: 'host_directory',
      label: 'Export directory',
      url: '',
      path: '/var/tmp/exports/release-audit',
    },
    secondaryTargets: [],
    contentPreview: {
      summary: '/var/tmp/exports/release-audit',
    },
    createdAtOffsetHours: -4,
  });

  insertWorkflowOutputDescriptor({
    id: randomUUID(),
    workflowId,
    workItemId,
    descriptorKind: 'inline_summary',
    deliveryStage: 'in_progress',
    title: 'Inline decision summary',
    state: 'approved',
    summaryBrief: 'Inline summary only; no external artifact is attached.',
    previewCapabilities: {
      can_inline_preview: true,
      can_download: false,
    },
    primaryTarget: {
      target_kind: 'inline_summary',
      label: 'Inline decision summary',
      url: '',
    },
    secondaryTargets: [],
    contentPreview: {
      text: 'Operator summary:\n- rollback note added\n- release checklist verified\n- ready for final approval',
    },
    createdAtOffsetHours: -5,
  });

  return scenario;
}

interface WorkflowOutputDescriptorSeed {
  id: string;
  workflowId: string;
  workItemId: string | null;
  descriptorKind: string;
  deliveryStage: 'in_progress' | 'final';
  title: string;
  state: 'draft' | 'under_review' | 'approved' | 'superseded' | 'final';
  summaryBrief: string | null;
  previewCapabilities: Record<string, unknown>;
  primaryTarget: Record<string, unknown>;
  secondaryTargets: Array<Record<string, unknown>>;
  contentPreview: Record<string, unknown>;
  createdAtOffsetHours: number;
}

function insertWorkflowOutputDescriptor(input: WorkflowOutputDescriptorSeed): void {
  runPsql(`
    INSERT INTO public.workflow_output_descriptors (
      id,
      tenant_id,
      workflow_id,
      work_item_id,
      descriptor_kind,
      delivery_stage,
      title,
      state,
      summary_brief,
      preview_capabilities_json,
      primary_target_json,
      secondary_targets_json,
      content_preview_json,
      source_brief_id,
      created_at,
      updated_at
    )
    VALUES (
      ${sqlUuid(input.id)},
      ${sqlUuid(DEFAULT_TENANT_ID)},
      ${sqlUuid(input.workflowId)},
      ${input.workItemId ? sqlUuid(input.workItemId) : 'NULL'},
      ${sqlText(input.descriptorKind)},
      ${sqlText(input.deliveryStage)},
      ${sqlText(input.title)},
      ${sqlText(input.state)},
      ${input.summaryBrief ? sqlText(input.summaryBrief) : 'NULL'},
      ${sqlJsonValue(input.previewCapabilities)}::jsonb,
      ${sqlJsonValue(input.primaryTarget)}::jsonb,
      ${sqlJsonValue(input.secondaryTargets)}::jsonb,
      ${sqlJsonValue(input.contentPreview)}::jsonb,
      NULL,
      NOW() + ${sqlText(`${input.createdAtOffsetHours} hours`)}::interval,
      NOW() + ${sqlText(`${input.createdAtOffsetHours} hours`)}::interval
    );
  `);
}

function createWorkflowArtifact(input: SeededArtifactInput): {
  id: string;
  logicalPath: string;
  sizeBytes: number;
} {
  const id = randomUUID();
  const payload = Buffer.from(input.content, 'utf8');
  const scopeId = input.workflowId;
  const storageKey = `${DEFAULT_TENANT_ID}/${scopeId}/${id}/${input.fileName}`;
  const checksumSha256 = createHash('sha256').update(payload).digest('hex');

  writeSeededArtifactObject(storageKey, payload, input.contentType);
  runPsql(`
    INSERT INTO public.workflow_artifacts (
      id,
      tenant_id,
      workflow_id,
      workspace_id,
      task_id,
      logical_path,
      storage_backend,
      storage_key,
      content_type,
      size_bytes,
      checksum_sha256,
      metadata,
      retention_policy,
      expires_at,
      created_at
    )
    VALUES (
      ${sqlUuid(id)},
      ${sqlUuid(DEFAULT_TENANT_ID)},
      ${sqlUuid(input.workflowId)},
      ${sqlUuid(input.workspaceId)},
      ${sqlUuid(input.taskId)},
      ${sqlText(input.logicalPath)},
      'local',
      ${sqlText(storageKey)},
      ${sqlText(input.contentType)},
      ${payload.length},
      ${sqlText(checksumSha256)},
      '{}'::jsonb,
      '{"mode":"forever"}'::jsonb,
      NULL,
      NOW()
    );
  `);

  return {
    id,
    logicalPath: input.logicalPath,
    sizeBytes: payload.length,
  };
}

function writeSeededArtifactObject(storageKey: string, payload: Buffer, contentType: string): void {
  const containerPath = `/artifacts/${storageKey}`;
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      PLATFORM_API_CONTAINER_NAME,
      'sh',
      '-lc',
      [
        'set -e',
        `mkdir -p ${shellQuote(containerPath.split('/').slice(0, -1).join('/'))}`,
        `cat > ${shellQuote(containerPath)}`,
        `printf %s ${shellQuote(contentType)} > ${shellQuote(`${containerPath}.content-type`)}`,
      ].join(' && '),
    ],
    { input: payload },
  );
}

function runPsql(sql: string): void {
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      POSTGRES_CONTAINER_NAME,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      POSTGRES_USER,
      '-d',
      POSTGRES_DB,
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  );
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlUuid(value: string): string {
  return `${sqlText(value)}::uuid`;
}

function sqlJsonValue(value: unknown): string {
  return sqlText(JSON.stringify(value));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}
