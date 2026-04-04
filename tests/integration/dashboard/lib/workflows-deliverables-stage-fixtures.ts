export interface DeliverableRouteArtifactRecord {
  id: string;
  taskId: string;
  fileName: string;
  logicalPath: string;
  contentType: string;
  contentText: string;
  sizeBytes: number;
}

export function buildStageRetainedScopeMapFixtures(
  workflowId: string | null,
  workItemId: string | null,
): {
  deliverables: Array<Record<string, unknown>>;
  workingHandoffs: Array<Record<string, unknown>>;
  artifacts: DeliverableRouteArtifactRecord[];
} {
  const taskId = 'seeded-scope-map-task';
  const briefId = 'seeded-scope-map-brief';
  const createdAt = '2026-04-04T18:52:00.229Z';
  const finalCreatedAt = '2026-04-04T18:58:00.229Z';
  const artifactId = 'seeded-scope-map-artifact';
  const fileName = 'finance-workspace-scope-map.md';
  const logicalPath = `artifact:${workflowId ?? 'workflow-1'}/deliverables/${fileName}`;

  return {
    deliverables: [
      {
        descriptor_id: 'seeded-scope-map-interim',
        workflow_id: workflowId,
        work_item_id: workItemId,
        descriptor_kind: 'inline_summary',
        delivery_stage: 'in_progress',
        title: 'Initial scope map',
        state: 'approved',
        summary_brief: 'Initial scoped framing while the artifact packet is still in progress.',
        preview_capabilities: {
          can_inline_preview: true,
          can_download: false,
        },
        primary_target: {
          target_kind: 'inline_summary',
          label: fileName,
          url: '',
          path: `deliverables/${fileName}`,
        },
        secondary_targets: [],
        content_preview: {
          summary: `Path: deliverables/${fileName}`,
        },
        source_brief_id: briefId,
        created_at: createdAt,
        updated_at: createdAt,
      },
      {
        descriptor_id: 'seeded-scope-map-final',
        workflow_id: workflowId,
        work_item_id: workItemId,
        descriptor_kind: 'deliverable_packet',
        delivery_stage: 'final',
        title: 'Map review scope for finance workspace access review and audit export handling completion packet',
        state: 'final',
        summary_brief: 'Final scoped packet ready for operator review.',
        preview_capabilities: {
          can_inline_preview: true,
          can_download: true,
        },
        primary_target: {
          target_kind: 'artifact',
          label: 'Open artifact',
          url: `/api/v1/tasks/${taskId}/artifacts/${artifactId}/preview`,
          path: logicalPath,
          artifact_id: artifactId,
          size_bytes: 104,
        },
        secondary_targets: [],
        content_preview: {
          summary: 'Final scoped packet.',
          source_role_name: 'Policy Analyst',
        },
        source_brief_id: null,
        created_at: finalCreatedAt,
        updated_at: finalCreatedAt,
      },
    ],
    workingHandoffs: [
      {
        id: briefId,
        workflow_id: workflowId,
        work_item_id: workItemId,
        task_id: taskId,
        request_id: 'seeded-scope-map-request',
        execution_context_id: 'seeded-scope-map-execution',
        brief_kind: 'specialist_handoff',
        brief_scope: 'work_item',
        source_kind: 'task_handoff',
        source_role_name: 'Policy Analyst',
        status_kind: 'in_progress',
        short_brief: {},
        detailed_brief_json: {},
        linked_target_ids: [],
        sequence_number: 1,
        related_artifact_ids: [],
        related_output_descriptor_ids: ['seeded-scope-map-interim'],
        related_intervention_ids: [],
        canonical_workflow_brief_id: null,
        created_by_type: 'task',
        created_by_id: taskId,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ],
    artifacts: [
      {
        id: artifactId,
        taskId,
        fileName,
        logicalPath,
        contentType: 'text/markdown',
        contentText: '# Finance workspace scope map\n\nThis final packet captures the finance workspace review scope.',
        sizeBytes: 89,
      },
    ],
  };
}
