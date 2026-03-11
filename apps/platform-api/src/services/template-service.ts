import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import type { CreateTemplateInput, ListTemplateQuery, UpdateTemplateInput } from './template-service.types.js';
import { TemplateWriteService } from './template-write-service.js';

export class TemplateService {
  private readonly writeService: TemplateWriteService;

  constructor(private readonly pool: DatabasePool, eventService: EventService) {
    this.writeService = new TemplateWriteService({
      pool,
      eventService,
      getTemplateOrThrow: this.getTemplateOrThrow.bind(this),
      toTemplateResponse: this.toTemplateResponse.bind(this),
    });
  }

  private toTemplateResponse(row: Record<string, unknown>) {
    return { ...row, deleted_at: row.deleted_at ?? null };
  }

  private async getTemplateOrThrow(tenantId: string, templateId: string) {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    // Use findAll with deleted_at IS NULL condition since findById doesn't support extra conditions
    const rows = await repo.findAll<Record<string, unknown> & { tenant_id: string }>(
      'templates',
      '*',
      ['id = $2', 'deleted_at IS NULL'],
      [templateId],
    );
    if (rows.length === 0) throw new NotFoundError('Template not found');
    return rows[0] as Record<string, unknown>;
  }

  createTemplate(identity: ApiKeyIdentity, input: CreateTemplateInput) {
    return this.writeService.createTemplate(identity, input);
  }

  async listTemplates(tenantId: string, query: ListTemplateQuery) {
    if (query.latest_only) {
      return this.listLatestTemplates(tenantId, query);
    }

    const repo = new TenantScopedRepository(this.pool, tenantId);

    // Extra conditions beyond tenant_id (always prepended).
    // Placeholder numbering starts at $2.
    const conditions: string[] = ['deleted_at IS NULL'];
    const values: unknown[] = [];

    if (query.slug) {
      values.push(query.slug);
      conditions.push(`slug = $${values.length + 1}`);
    }
    if (query.q) {
      values.push(`%${query.q}%`);
      conditions.push(`(name ILIKE $${values.length + 1} OR slug ILIKE $${values.length + 1})`);
    }
    if (query.is_built_in !== undefined) {
      values.push(query.is_built_in);
      conditions.push(`is_built_in = $${values.length + 1}`);
    }

    const offset = (query.page - 1) * query.per_page;

    const [total, rows] = await Promise.all([
      repo.count('templates', conditions, values),
      repo.findAllPaginated<Record<string, unknown> & { tenant_id: string }>(
        'templates',
        '*',
        conditions,
        values,
        'created_at DESC',
        query.per_page,
        offset,
      ),
    ]);

    return {
      data: rows.map((row) => this.toTemplateResponse(row as Record<string, unknown>)),
      meta: { total, page: query.page, per_page: query.per_page, pages: Math.ceil(total / query.per_page) || 1 },
    };
  }

  /**
   * Returns only the latest version of each template (by slug), using
   * DISTINCT ON to efficiently pick the highest-versioned row per slug.
   */
  private async listLatestTemplates(tenantId: string, query: ListTemplateQuery) {
    const conditions: string[] = ['t.tenant_id = $1', 't.deleted_at IS NULL'];
    const values: unknown[] = [tenantId];

    if (query.slug) {
      values.push(query.slug);
      conditions.push(`t.slug = $${values.length}`);
    }
    if (query.q) {
      values.push(`%${query.q}%`);
      conditions.push(`(t.name ILIKE $${values.length} OR t.slug ILIKE $${values.length})`);
    }
    if (query.is_built_in !== undefined) {
      values.push(query.is_built_in);
      conditions.push(`t.is_built_in = $${values.length}`);
    }

    const where = conditions.join(' AND ');
    const offset = (query.page - 1) * query.per_page;

    // Use a CTE with DISTINCT ON to get one row per slug (latest version).
    const cte = `
      WITH latest AS (
        SELECT DISTINCT ON (t.slug) t.*
        FROM templates t
        WHERE ${where}
        ORDER BY t.slug, t.version DESC
      )`;

    const countQuery = `${cte} SELECT COUNT(*)::int AS total FROM latest`;
    const dataQuery = `${cte} SELECT * FROM latest ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;

    const dataValues = [...values, query.per_page, offset];

    const [countResult, dataResult] = await Promise.all([
      this.pool.query<{ total: number }>(countQuery, values),
      this.pool.query<Record<string, unknown>>(dataQuery, dataValues),
    ]);

    const total = Number(countResult.rows[0].total);
    return {
      data: dataResult.rows.map((row) => this.toTemplateResponse(row)),
      meta: { total, page: query.page, per_page: query.per_page, pages: Math.ceil(total / query.per_page) || 1 },
    };
  }

  async getTemplate(tenantId: string, templateId: string) {
    return this.toTemplateResponse(await this.getTemplateOrThrow(tenantId, templateId));
  }

  updateTemplate(identity: ApiKeyIdentity, templateId: string, patch: UpdateTemplateInput) {
    return this.writeService.updateTemplate(identity, templateId, patch);
  }

  softDeleteTemplate(identity: ApiKeyIdentity, templateId: string) {
    return this.writeService.softDeleteTemplate(identity, templateId);
  }
}
