import type { DatabasePool } from '../../db/database.js';
import {
  buildFilterSql,
  buildOrderBySql,
  buildPageQuery,
  buildSummaryQuery,
} from './workspace-artifact-explorer-sql.js';
import {
  mapArtifactRow,
  readInteger,
  readStringArray,
  readTaskOptions,
  readWorkflowOptions,
  readWorkItemOptions,
} from './workspace-artifact-explorer-records.js';
import type {
  WorkspaceArtifactExplorerListInput,
  WorkspaceArtifactExplorerListResult,
  WorkspaceArtifactExplorerRow,
  WorkspaceArtifactExplorerSummaryRow,
} from './workspace-artifact-explorer-types.js';
export type {
  WorkspaceArtifactExplorerListInput,
  WorkspaceArtifactExplorerListResult,
  WorkspaceArtifactExplorerRecord,
  WorkspaceArtifactExplorerSort,
} from './workspace-artifact-explorer-types.js';

const MAX_FILTER_OPTIONS = 100;

export class WorkspaceArtifactExplorerService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly previewMaxBytes = 1024 * 1024,
  ) {}

  async listWorkspaceArtifacts(
    tenantId: string,
    workspaceId: string,
    input: WorkspaceArtifactExplorerListInput,
  ): Promise<WorkspaceArtifactExplorerListResult> {
    const usesPreviewFilter = input.preview_mode === 'inline' || input.preview_mode === 'download';
    const summaryFilters = buildFilterSql(input, {
      firstFilterParameterIndex: 4,
      previewMaxBytesIndex: 3,
    });
    const pageFilters = buildFilterSql(input, {
      firstFilterParameterIndex: usesPreviewFilter ? 4 : 3,
      ...(usesPreviewFilter ? { previewMaxBytesIndex: 3 } : {}),
    });
    const summaryParams = [
      tenantId,
      workspaceId,
      this.previewMaxBytes,
      ...summaryFilters.values,
      MAX_FILTER_OPTIONS,
    ];
    const pageParams = usesPreviewFilter
      ? [
          tenantId,
          workspaceId,
          this.previewMaxBytes,
          ...pageFilters.values,
          input.per_page,
          (input.page - 1) * input.per_page,
        ]
      : [
          tenantId,
          workspaceId,
          ...pageFilters.values,
          input.per_page,
          (input.page - 1) * input.per_page,
        ];

    const [summaryResult, pageResult] = await Promise.all([
      this.pool.query<WorkspaceArtifactExplorerSummaryRow>(
        buildSummaryQuery(summaryFilters.sql, summaryParams.length),
        summaryParams,
      ),
      this.pool.query<WorkspaceArtifactExplorerRow>(
        buildPageQuery(
          pageFilters.sql,
          buildOrderBySql(input.sort ?? 'newest'),
          pageParams.length - 1,
          pageParams.length,
        ),
        pageParams,
      ),
    ]);

    const summaryRow = summaryResult.rows[0];
    const summary = {
      total_artifacts: readInteger(summaryRow?.total_artifacts),
      previewable_artifacts: readInteger(summaryRow?.previewable_artifacts),
      total_bytes: readInteger(summaryRow?.total_bytes),
      workflow_count: readInteger(summaryRow?.workflow_count),
      work_item_count: readInteger(summaryRow?.work_item_count),
      task_count: readInteger(summaryRow?.task_count),
      role_count: readInteger(summaryRow?.role_count),
    };
    const totalPages = summary.total_artifacts === 0
      ? 1
      : Math.ceil(summary.total_artifacts / input.per_page);

    return {
      data: pageResult.rows.map((row) => mapArtifactRow(row, this.previewMaxBytes)),
      meta: {
        page: input.page,
        per_page: input.per_page,
        total: summary.total_artifacts,
        total_pages: totalPages,
        has_more: input.page < totalPages,
        summary,
        filters: {
          workflows: readWorkflowOptions(summaryRow?.workflows),
          work_items: readWorkItemOptions(summaryRow?.work_items),
          tasks: readTaskOptions(summaryRow?.tasks),
          stages: readStringArray(summaryRow?.stages),
          roles: readStringArray(summaryRow?.roles),
          content_types: readStringArray(summaryRow?.content_types),
        },
      },
    };
  }
}
